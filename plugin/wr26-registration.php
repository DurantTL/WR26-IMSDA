<?php
/**
 * Plugin Name: WR26 Registration
 * Description: Women's Retreat 2026 registration + waitlist + check-in bridge for Fluent Forms and Google Apps Script.
 * Version: 1.0.0
 * Author: IMSDA
 */

if (!defined('ABSPATH')) {
    exit;
}

define('WR26_VERSION', '1.0.0');

function wr26_default_options() {
    return array(
        'wr26_gas_url' => '',
        'wr26_form_id' => '',
        'wr26_capacity' => 350,
        'wr26_waitlist_enabled' => '1',
        'wr26_registered_count' => 0,
        'wr26_waitlist_count' => 0,
        'wr26_gas_secret' => wp_generate_password(32, false, false),
        'wr26_edit_page_url' => site_url('/wr26-edit/'),
        'wr26_dispatch_queue' => array(),
        'wr26_failed_submissions' => array(),
        'wr26_dispatch_last_run' => '',
        'wr26_event_name' => "Women's Retreat 2026",
        'wr26_event_dates' => 'October 9–11, 2026',
        'wr26_event_location' => 'Des Moines, IA',
        'wr26_payment_default' => 'pay_later',
        'wr26_early_bird_price' => '120',
        'wr26_regular_price' => '140',
        'wr26_early_bird_end_date' => '2026-08-14',
        'wr26_regular_end_date' => '2026-09-17',
        'wr26_worker_registration_url' => '',
        'wr26_childcare_enabled' => '1',
        'wr26_childcare_minimum_children' => '',
        'wr26_square_fee_enabled' => '0',
        'wr26_square_fee_percent' => '',
        'wr26_square_fee_fixed' => '',
        'wr26_seminar_full_behavior' => 'allow_with_review',
        'wr26_seminar_capacity_default' => ''
    );
}

function wr26_value_from_keys($source, $keys, $default = '') {
    foreach ((array) $keys as $key) {
        if (is_array($source) && array_key_exists($key, $source) && $source[$key] !== '' && $source[$key] !== null) {
            return $source[$key];
        }
    }
    return $default;
}

function wr26_normalize_payment_method($method) {
    $payment_method = strtolower(sanitize_text_field($method));
    if (!$payment_method) return 'pay_later';
    if ($payment_method === 'offline') return 'pay_later';
    if ($payment_method === 'square') return 'square';
    if (strpos($payment_method, 'pay later') !== false || strpos($payment_method, 'later') !== false) return 'pay_later';
    if (strpos($payment_method, 'square') !== false || strpos($payment_method, 'card') !== false || strpos($payment_method, 'credit') !== false) return 'square';
    if (strpos($payment_method, 'check') !== false) return 'check';
    if (strpos($payment_method, 'cash') !== false) return 'cash';
    return $payment_method;
}

function wr26_extract_amount($raw, $entry_id, $wpdb) {
    $amount = 0.0;
    $meta = $wpdb->get_var($wpdb->prepare("SELECT value FROM {$wpdb->prefix}fluentform_submission_meta WHERE submission_id=%d AND meta_key='_payment_entries' ORDER BY id DESC LIMIT 1", $entry_id));
    if ($meta) {
        $m = json_decode($meta, true);
        if (is_array($m)) {
            $amt = 0;
            if (isset($m['amount'])) $amt = $m['amount'];
            elseif (!empty($m[0]['amount'])) $amt = $m[0]['amount'];
            $amount = floatval($amt) / 100;
        }
    }
    if ($amount > 0) return $amount;
    foreach (array('total', 'payment_total', 'registration_total', 'amount', 'final_amount', 'calculated_total', 'order_total') as $key) {
        if (!isset($raw[$key])) continue;
        $candidate = is_array($raw[$key]) ? '' : str_replace(array('$', ','), '', (string) $raw[$key]);
        if (is_numeric($candidate) && floatval($candidate) > 0) {
            return floatval($candidate);
        }
    }
    return 0.0;
}


function wr26_activate() {
    foreach (wr26_default_options() as $k => $v) {
        if (get_option($k, null) === null) {
            add_option($k, $v);
        }
    }
    if (!wp_next_scheduled('wr26_dispatch_queue_process')) {
        wp_schedule_event(time() + 60, 'wr26_every_5_minutes', 'wr26_dispatch_queue_process');
    }
}
register_activation_hook(__FILE__, 'wr26_activate');

function wr26_deactivate() {
    wp_clear_scheduled_hook('wr26_dispatch_queue_process');
}
register_deactivation_hook(__FILE__, 'wr26_deactivate');

add_filter('cron_schedules', function($schedules) {
    $schedules['wr26_every_5_minutes'] = array('interval' => 300, 'display' => 'Every 5 Minutes (WR26)');
    return $schedules;
});

function wr26_queue_entry($entry_id, $action) {
    $entry_id = intval($entry_id);
    $action = sanitize_text_field($action);
    $queue = get_option('wr26_dispatch_queue', array());
    foreach ($queue as $item) {
        if (intval($item['entry_id']) === $entry_id && $item['action'] === $action) {
            return;
        }
    }
    $queue[] = array('entry_id' => $entry_id, 'action' => $action, 'queued_at' => current_time('mysql'), 'attempts' => 0);
    update_option('wr26_dispatch_queue', $queue, false);
}

function wr26_parse_ff_entry($entry_id) {
    global $wpdb;
    $sub = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$wpdb->prefix}fluentform_submissions WHERE id=%d", $entry_id), ARRAY_A);
    if (!$sub) return array();
    $raw = json_decode($sub['response'], true);
    $raw = is_array($raw) ? $raw : array();

    $payment_method = wr26_normalize_payment_method($raw['payment_method'] ?? $raw['payment'] ?? $raw['pay_method'] ?? get_option('wr26_payment_default', 'pay_later'));
    $promo = strtoupper(sanitize_text_field($raw['promo_code'] ?? $raw['discount_code'] ?? $raw['coupon_code'] ?? $raw['coupon'] ?? ''));
    $amount = wr26_extract_amount($raw, $entry_id, $wpdb);

    $church_raw = sanitize_text_field($raw['church'] ?? '');
    $church_other = sanitize_text_field($raw['church_other'] ?? '');
    $church = ($church_raw === 'Other' && $church_other !== '') ? $church_other : $church_raw;

    $attendees = array();

    // Attendee 1 — primary registrant + a1_ fields
    $attendees[] = array(
        'attendee_id'        => 'A-' . intval($entry_id) . '-1',
        'first_name'         => sanitize_text_field($raw['first_name'] ?? ''),
        'last_name'          => sanitize_text_field($raw['last_name'] ?? ''),
        'phone'              => sanitize_text_field($raw['phone'] ?? ''),
        'email'              => sanitize_email($raw['email'] ?? ''),
        'church'             => $church,
        'attendee_type'      => 'adult',
        'meal_preference'    => sanitize_text_field($raw['a1_meal_preference'] ?? ''),
        'dietary_needs'      => sanitize_textarea_field($raw['a1_dietary_needs'] ?? ''),
        'childcare_needed'   => sanitize_text_field($raw['a1_childcare_needed'] ?? ''),
        'seminar_preferences' => array(
            'session_1' => array(
                'pref_1' => sanitize_text_field($raw['a1_session1_pref1'] ?? ''),
                'pref_2' => sanitize_text_field($raw['a1_session1_pref2'] ?? '')
            ),
            'session_2' => array(
                'pref_1' => sanitize_text_field($raw['a1_session2_pref1'] ?? ''),
                'pref_2' => sanitize_text_field($raw['a1_session2_pref2'] ?? '')
            ),
            'session_3' => array(
                'pref_1' => sanitize_text_field($raw['a1_session3_pref1'] ?? ''),
                'pref_2' => sanitize_text_field($raw['a1_session3_pref2'] ?? '')
            ),
            'session_4' => array(
                'pref_1' => sanitize_text_field($raw['a1_session4'] ?? '')
            )
        )
    );

    // Attendees 2–5 — flat a{n}_ fields
    $attendee_count = min(5, max(1, intval($raw['attendee_count'] ?? 1)));
    for ($n = 2; $n <= $attendee_count; $n++) {
        if (empty($raw["a{$n}_first_name"])) continue;
        $attendees[] = array(
            'attendee_id'        => 'A-' . intval($entry_id) . '-' . $n,
            'first_name'         => sanitize_text_field($raw["a{$n}_first_name"]),
            'last_name'          => sanitize_text_field($raw["a{$n}_last_name"]),
            'phone'              => sanitize_text_field($raw["a{$n}_phone"]),
            'email'              => '',
            'church'             => '',
            'attendee_type'      => sanitize_text_field($raw["a{$n}_attendee_type"]),
            'meal_preference'    => sanitize_text_field($raw["a{$n}_meal_preference"]),
            'dietary_needs'      => sanitize_textarea_field($raw["a{$n}_dietary_needs"] ?? ''),
            'childcare_needed'   => sanitize_text_field($raw["a{$n}_childcare_needed"] ?? ''),
            'seminar_preferences' => array(
                'session_1' => array(
                    'pref_1' => sanitize_text_field($raw["a{$n}_session1_pref1"] ?? ''),
                    'pref_2' => sanitize_text_field($raw["a{$n}_session1_pref2"] ?? '')
                ),
                'session_2' => array(
                    'pref_1' => sanitize_text_field($raw["a{$n}_session2_pref1"] ?? ''),
                    'pref_2' => sanitize_text_field($raw["a{$n}_session2_pref2"] ?? '')
                ),
                'session_3' => array(
                    'pref_1' => sanitize_text_field($raw["a{$n}_session3_pref1"] ?? ''),
                    'pref_2' => sanitize_text_field($raw["a{$n}_session3_pref2"] ?? '')
                ),
                'session_4' => array(
                    'pref_1' => sanitize_text_field($raw["a{$n}_session4"] ?? '')
                )
            )
        );
    }

    return array(
        'entry_id'               => intval($sub['id']),
        'form_id'                => intval($sub['form_id']),
        'first_name'             => sanitize_text_field($raw['first_name'] ?? ''),
        'last_name'              => sanitize_text_field($raw['last_name'] ?? ''),
        'email'                  => sanitize_email($raw['email'] ?? ''),
        'phone'                  => sanitize_text_field($raw['phone'] ?? ''),
        'church'                 => $church,
        'arrival_date'           => sanitize_text_field($raw['arrival_date'] ?? ''),
        'departure_date'         => sanitize_text_field($raw['departure_date'] ?? ''),
        'emergency_contact_name' => sanitize_text_field($raw['emergency_contact_name'] ?? ''),
        'emergency_contact_phone'=> sanitize_text_field($raw['emergency_contact_phone'] ?? ''),
        'dietary_needs'          => sanitize_textarea_field($raw['a1_dietary_needs'] ?? ''),
        'special_needs'          => sanitize_textarea_field($raw['special_needs'] ?? ''),
        'attendee_notes'         => sanitize_textarea_field($raw['attendee_notes'] ?? ''),
        'promo_code'             => $promo,
        'payment_method'         => $payment_method,
        'amount'                 => floatval($amount),
        'ip_address'             => sanitize_text_field($sub['ip']),
        'submitted_at'           => sanitize_text_field($sub['created_at']),
        'worker_flag'            => sanitize_text_field($raw['worker_registration'] ?? ''),
        'attendee_count'         => count($attendees),
        'attendees'              => $attendees
    );
}


function wr26_allowed_admin_field_keys() {
    return array(
        'firstName',
        'lastName',
        'email',
        'phone',
        'church',
        'arrivalDate',
        'departureDate',
        'dietaryNeeds',
        'emergencyContactName',
        'emergencyContactPhone',
        'specialNeeds',
        'promoCode',
        'discountAmount',
        'originalAmount',
        'finalAmount',
        'paymentMethod',
        'paymentStatus',
        'squarePaymentId',
        'status',
        'transferNotes',
        'adminNotes'
    );
}

function wr26_sanitize_admin_field_value($key, $value) {
    if (is_object($value) || is_array($value)) {
        return '';
    }

    $scalar = is_scalar($value) ? (string) $value : '';

    if ($key === 'email') {
        return sanitize_email($scalar);
    }

    if (in_array($key, array('discountAmount', 'originalAmount', 'finalAmount'), true)) {
        $normalized = str_replace(array('$', ',', ' '), '', $scalar);
        return is_numeric($normalized) ? floatval($normalized) : 0.0;
    }

    if (in_array($key, array('dietaryNeeds', 'specialNeeds', 'transferNotes', 'adminNotes'), true)) {
        return sanitize_textarea_field($scalar);
    }

    return sanitize_text_field($scalar);
}

function wr26_sanitize_admin_fields($value) {
    if (!is_array($value)) {
        return array();
    }

    $safe = array();
    $allowed = array_flip(wr26_allowed_admin_field_keys());

    // GAS expects camelCase field keys, so do not sanitize keys with sanitize_key() here.
    foreach ($value as $key => $child) {
        if (!is_string($key) || !isset($allowed[$key])) {
            continue;
        }
        $safe[$key] = wr26_sanitize_admin_field_value($key, $child);
    }

    return $safe;
}

function wr26_build_and_send($entry_id, $action) {
    $url = esc_url_raw(get_option('wr26_gas_url', ''));
    if (!$url) return 'Missing GAS URL';
    $data = wr26_parse_ff_entry($entry_id);
    if (empty($data)) return 'Fluent Forms entry not found';
    $payload = array_merge($data, array(
        'action' => sanitize_text_field($action), 'secret' => get_option('wr26_gas_secret', ''), 'site' => site_url(), 'version' => WR26_VERSION,
        'edit_page_url' => esc_url_raw(get_option('wr26_edit_page_url', site_url('/wr26-edit/')))
    ));
    $r = wp_remote_post($url, array('timeout' => 45, 'headers' => array('Content-Type' => 'application/json'), 'body' => wp_json_encode($payload)));
    if (is_wp_error($r)) return $r->get_error_message();
    $body = json_decode(wp_remote_retrieve_body($r), true);
    if (empty($body['success'])) {
        if ($action === 'register' && !empty($body['capacityFull'])) {
            $waitlist_payload = array_merge($payload, array('action' => 'waitlist'));
            $waitlist_response = wp_remote_post($url, array('timeout' => 45, 'headers' => array('Content-Type' => 'application/json'), 'body' => wp_json_encode($waitlist_payload)));
            if (is_wp_error($waitlist_response)) return $waitlist_response->get_error_message();
            $waitlist_body = json_decode(wp_remote_retrieve_body($waitlist_response), true);
            if (empty($waitlist_body['success'])) return !empty($waitlist_body['message']) ? $waitlist_body['message'] : 'Waitlist reroute failed';
            if (empty($waitlist_body['duplicate'])) update_option('wr26_waitlist_count', intval(get_option('wr26_waitlist_count', 0)) + 1, false);
            error_log('WR26 entry '.intval($entry_id).' rerouted to waitlist due to full capacity.');
            return true;
        }
        if (!empty($body['capacityCheckFailed'])) return !empty($body['message']) ? $body['message'] : 'Capacity check failed';
        return !empty($body['message']) ? $body['message'] : 'Unknown GAS error';
    }
    if ($action === 'register' && empty($body['duplicate'])) update_option('wr26_registered_count', intval(get_option('wr26_registered_count', 0)) + 1, false);
    if ($action === 'waitlist' && empty($body['duplicate'])) update_option('wr26_waitlist_count', intval(get_option('wr26_waitlist_count', 0)) + 1, false);
    return true;
}

function wr26_process_dispatch_queue() {
    $queue = get_option('wr26_dispatch_queue', array());
    $failed = get_option('wr26_failed_submissions', array());
    $new = array();
    foreach ($queue as $item) {
        $result = wr26_build_and_send($item['entry_id'], $item['action']);
        if ($result === true) continue;
        $item['attempts'] = intval($item['attempts']) + 1;
        $item['error'] = sanitize_text_field($result);
        if ($item['attempts'] >= 5) {
            $item['failed_at'] = current_time('mysql');
            $failed[] = $item;
            wp_mail(get_option('admin_email'), 'WR26 Queue Failure', 'Entry '.$item['entry_id'].' failed: '.$result);
        } else $new[] = $item;
    }
    update_option('wr26_dispatch_queue', $new, false);
    update_option('wr26_failed_submissions', $failed, false);
    update_option('wr26_dispatch_last_run', current_time('mysql'), false);
}
add_action('wr26_dispatch_queue_process', 'wr26_process_dispatch_queue');

add_action('fluentform/submission_inserted', function($entry_id, $form_data, $form) {
    if (intval($form->id ?? 0) !== intval(get_option('wr26_form_id', 0))) return;
    $parsed = wr26_parse_ff_entry($entry_id);
    $pm = $parsed['payment_method'] ?? '';
    $is_online = (strpos($pm, 'square') !== false || strpos($pm, 'card') !== false || strpos($pm, 'credit') !== false);
    $action = intval(get_option('wr26_registered_count', 0)) < intval(get_option('wr26_capacity', 350)) ? 'register' : 'waitlist';
    if ($is_online) {
        update_option('wr26_pending_pay_'.intval($entry_id), $action, false);
        return;
    }
    wr26_queue_entry($entry_id, $action);
}, 10, 3);

add_action('fluentform/payment_paid', function($payment, $submission, $status) {
    $entry_id = intval($submission->id ?? 0);
    if (!$entry_id) return;
    $pending_key = 'wr26_pending_pay_'.$entry_id;
    $action = get_option($pending_key, '');
    if (!$action) return;
    if (!in_array($action, array('register', 'waitlist'), true)) {
        delete_option($pending_key);
        error_log('WR26 payment_paid skipped for entry '.intval($entry_id).': invalid pending action '.print_r($action, true));
        return;
    }
    wr26_queue_entry($entry_id, $action);
    delete_option($pending_key);
}, 10, 3);

function wr26_gas_request($payload, $timeout = 30) {
    $url = esc_url_raw(get_option('wr26_gas_url', ''));
    if (!$url) return array('success' => false, 'message' => 'Missing GAS URL');
    $payload['secret'] = get_option('wr26_gas_secret', '');
    $payload['site'] = site_url();
    $payload['edit_page_url'] = esc_url_raw(get_option('wr26_edit_page_url', site_url('/wr26-edit/')));
    $r = wp_remote_post($url, array('timeout' => intval($timeout), 'headers' => array('Content-Type' => 'application/json'), 'body' => wp_json_encode($payload)));
    if (is_wp_error($r)) return array('success' => false, 'message' => $r->get_error_message());
    return json_decode(wp_remote_retrieve_body($r), true);
}

function wr26_admin_guard() {
    if (!current_user_can('manage_options')) wp_send_json_error(array('message' => 'Unauthorized'), 403);
    if (!check_ajax_referer('wr26_admin_nonce', 'nonce', false)) wp_send_json_error(array('message' => 'Invalid nonce'), 403);
}

add_action('wp_ajax_wr26_get_reg_by_token', function(){ $token=sanitize_text_field($_POST['token']??''); wp_send_json(wr26_gas_request(array('action'=>'getRegistrationByEditToken','token'=>$token))); });
add_action('wp_ajax_nopriv_wr26_get_reg_by_token', function(){ $token=sanitize_text_field($_POST['token']??''); wp_send_json(wr26_gas_request(array('action'=>'getRegistrationByEditToken','token'=>$token))); });
add_action('wp_ajax_wr26_save_edit', function(){
    $fields=array('firstName'=>sanitize_text_field($_POST['first_name']??''),'lastName'=>sanitize_text_field($_POST['last_name']??''),'phone'=>sanitize_text_field($_POST['phone']??''),'church'=>sanitize_text_field($_POST['church']??''),'dietaryNeeds'=>sanitize_textarea_field($_POST['dietary_needs']??''),'emergencyContactName'=>sanitize_text_field($_POST['emergency_contact_name']??''),'emergencyContactPhone'=>sanitize_text_field($_POST['emergency_contact_phone']??''),'specialNeeds'=>sanitize_textarea_field($_POST['special_needs']??''));
    wp_send_json(wr26_gas_request(array('action'=>'editRegistrationByToken','editToken'=>sanitize_text_field($_POST['edit_token']??''),'fields'=>$fields)));
});
add_action('wp_ajax_nopriv_wr26_save_edit', function(){ do_action('wp_ajax_wr26_save_edit'); });

add_action('wp_ajax_wr26_admin_action', function(){
    wr26_admin_guard();
    $a=sanitize_text_field($_POST['wr26_action']??'');
    if($a==='runQueue'){ wr26_process_dispatch_queue(); wp_send_json_success(array('message'=>'Queue processed')); }
    if($a==='dismissFailed'){ $i=intval($_POST['index']??-1); $f=get_option('wr26_failed_submissions',array()); if(isset($f[$i])){array_splice($f,$i,1);} update_option('wr26_failed_submissions',$f,false); wp_send_json_success(); }
    if($a==='retryFailed'){ $i=intval($_POST['index']??-1); $f=get_option('wr26_failed_submissions',array()); if(!isset($f[$i])) wp_send_json_error(); $item=$f[$i]; $item['attempts']=0; unset($item['error'],$item['failed_at']); $q=get_option('wr26_dispatch_queue',array()); $q[]=$item; update_option('wr26_dispatch_queue',$q,false); array_splice($f,$i,1); update_option('wr26_failed_submissions',$f,false); wp_send_json_success(); }
    if($a==='recordPayment'){
        wp_send_json(wr26_gas_request(array(
            'action' => 'recordPayment',
            'registrationId' => sanitize_text_field($_POST['registration_id'] ?? ''),
            'paymentMethod' => sanitize_text_field($_POST['payment_method'] ?? ''),
            'amountPaid' => floatval($_POST['amount_paid'] ?? 0),
            'checkNumber' => sanitize_text_field($_POST['check_number'] ?? ''),
            'paymentNotes' => sanitize_textarea_field($_POST['payment_notes'] ?? ''),
            'adminUser' => wp_get_current_user()->user_login,
        )));
    }
    $map=array('getRegistrations','adminEditRegistration','transferRegistration','getWaitlist','promoteWaitlist','removeWaitlist','checkinByToken','checkinById','searchRegistrations','getChurchRosters','getCheckInStats','getPromoCodes','savePromoCode','deletePromoCode','recordPayment');
    if(!in_array($a,$map,true)) wp_send_json_error(array('message'=>'Invalid action'));
    $payload=array('action'=>$a,'registrationId'=>sanitize_text_field($_POST['registration_id']??''),'waitlistId'=>sanitize_text_field($_POST['waitlist_id']??''),'token'=>sanitize_text_field($_POST['token']??''),'q'=>sanitize_text_field($_POST['q']??''),'status'=>sanitize_text_field($_POST['status']??''),'code'=>sanitize_text_field($_POST['code']??''),'fields'=>wr26_sanitize_admin_fields($_POST['fields']??array()),'adminUser'=>wp_get_current_user()->user_email,'newFirstName'=>sanitize_text_field($_POST['new_first_name']??''),'newLastName'=>sanitize_text_field($_POST['new_last_name']??''),'newEmail'=>sanitize_email($_POST['new_email']??''),'newPhone'=>sanitize_text_field($_POST['new_phone']??''),'newChurch'=>sanitize_text_field($_POST['new_church']??''),'reason'=>sanitize_textarea_field($_POST['reason']??''),'refundNotes'=>sanitize_textarea_field($_POST['refund_notes']??''),'adminNotes'=>sanitize_textarea_field($_POST['admin_notes']??''),'description'=>sanitize_text_field($_POST['description']??''),'discountType'=>sanitize_text_field($_POST['discountType']??''),'discountAmount'=>floatval($_POST['discountAmount']??0),'maxUses'=>intval($_POST['maxUses']??0),'minPurchase'=>floatval($_POST['minPurchase']??0),'expiryDate'=>sanitize_text_field($_POST['expiryDate']??''),'active'=>sanitize_text_field($_POST['active']??'true'));
    wp_send_json(wr26_gas_request($payload));
});

// minimal admin UI + shortcodes scaffolding
add_action('admin_menu', function(){
    add_menu_page('WR26','WR26','manage_options','wr26-dashboard','wr26_page_dashboard','dashicons-groups',30);
    add_submenu_page('wr26-dashboard','Dashboard','Dashboard','manage_options','wr26-dashboard','wr26_page_dashboard');
    add_submenu_page('wr26-dashboard','Registrations','Registrations','manage_options','wr26-registrations','wr26_page_generic');
    add_submenu_page('wr26-dashboard','Waitlist','Waitlist','manage_options','wr26-waitlist','wr26_page_generic');
    add_submenu_page('wr26-dashboard','Check-In','Check-In','manage_options','wr26-checkin','wr26_page_generic');
    add_submenu_page('wr26-dashboard','Church Rosters','Church Rosters','manage_options','wr26-rosters','wr26_page_generic');
    add_submenu_page('wr26-dashboard','Promo Codes','Promo Codes','manage_options','wr26-promo','wr26_page_generic');
    add_submenu_page('wr26-dashboard','Settings','Settings','manage_options','wr26-settings','wr26_page_settings');
});
add_action('admin_enqueue_scripts', function(){ wp_enqueue_script('jquery'); wp_localize_script('jquery','wr26',array('ajax_url'=>admin_url('admin-ajax.php'),'nonce'=>wp_create_nonce('wr26_admin_nonce'))); });
function wr26_admin_header($title,$active){ echo '<div class="wrap"><h1>'.esc_html($title).'</h1><h2 class="nav-tab-wrapper">'; foreach(array('dashboard'=>'Dashboard','registrations'=>'Registrations','waitlist'=>'Waitlist','checkin'=>'Check-In','rosters'=>'Church Rosters','promo'=>'Promo Codes','settings'=>'Settings') as $slug=>$label){$page='wr26-'.$slug;echo '<a class="nav-tab '.($active===$slug?'nav-tab-active':'').'" href="'.esc_url(admin_url('admin.php?page='.$page)).'">'.esc_html($label).'</a>';} echo '</h2></div>'; }
function wr26_page_dashboard(){
    wr26_admin_header('WR26 Dashboard','dashboard');
    $queue = get_option('wr26_dispatch_queue', array());
    $failed = get_option('wr26_failed_submissions', array());
    $last_dispatch = get_option('wr26_dispatch_last_run', '');
    echo '<div class="notice notice-info"><p>Lightweight fallback UI for staging/live operations.</p></div>';
    echo '<table class="widefat striped" style="max-width:900px"><tbody>';
    echo '<tr><th>Queue Count</th><td id="wr26-queue-count">'.intval(count($queue)).'</td></tr>';
    echo '<tr><th>Failed Submissions</th><td id="wr26-failed-count">'.intval(count($failed)).'</td></tr>';
    echo '<tr><th>Last Dispatch Run</th><td>'.esc_html($last_dispatch ? $last_dispatch : 'Never').'</td></tr>';
    echo '<tr><th>Registered Count Override</th><td>'.esc_html((string) get_option('wr26_registered_count', '')).'</td></tr>';
    echo '<tr><th>Waitlist Count (local cache)</th><td>'.intval(count(get_option('wr26_waitlist', array()))).'</td></tr>';
    echo '</tbody></table>';
    echo '<p><button class="button button-primary" id="wr26-run-queue">Run Queue</button> <button class="button" id="wr26-retry-first">Retry first failed item</button> <button class="button" id="wr26-dismiss-first">Dismiss first failed item</button></p><p id="wr26-dashboard-msg"></p>';
    echo <<<'JS'
<script>jQuery(function($){function post(a,extra){return $.post(wr26.ajax_url,$.extend({action:"wr26_admin_action",nonce:wr26.nonce,wr26_action:a},extra||{}));} function msg(t,b){$("#wr26-dashboard-msg").text(t).css("color",b?"#b32d2e":"#1d2327");}
$("#wr26-run-queue").on("click",function(){msg("Running queue...");post("runQueue").done(function(r){msg((r&&r.success)?"Queue processed":"Failed to run queue",!(r&&r.success));});});
$("#wr26-retry-first").on("click",function(){msg("Retrying failed item...");post("retryFailed",{index:0}).done(function(r){msg((r&&r.success)?"Retried failed item":"No failed item to retry",!(r&&r.success));});});
$("#wr26-dismiss-first").on("click",function(){msg("Dismissing failed item...");post("dismissFailed",{index:0}).done(function(r){msg((r&&r.success)?"Dismissed failed item":"No failed item to dismiss",!(r&&r.success));});});});</script>
JS;
}
function wr26_page_generic(){
    $page = sanitize_text_field($_GET['page'] ?? '');
    $map = array(
        'wr26-registrations' => 'registrations',
        'wr26-waitlist' => 'waitlist',
        'wr26-checkin' => 'checkin',
        'wr26-rosters' => 'rosters',
        'wr26-promo' => 'promo',
    );
    $active = $map[$page] ?? '';
    wr26_admin_header('WR26 '.ucwords(str_replace('-', ' ', $active)), $active);
    echo '<div class="notice notice-info"><p>Lightweight fallback UI for staging/live operations.</p></div><div id="wr26-app"></div>';
    $script = <<<'JS'
<script>jQuery(function($){const app=$('#wr26-app');const esc=(s)=>String(s==null?'':s).replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); const post=(a,e)=>$.post(wr26.ajax_url,$.extend({action:'wr26_admin_action',nonce:wr26.nonce,wr26_action:a},e||{})); function loading(){app.html('<p>Loading...</p>');} function err(m){app.html('<p style="color:#b32d2e;">'+esc(m||'Request failed')+'</p>');}
    const page='__PAGE__';
    if(page==='registrations'){app.html('<p><input id=\"wr26-q\" placeholder=\"Search\"> <select id=\"wr26-status\"><option value=\"\">All statuses</option><option>registered</option><option>waitlist</option><option>cancelled</option></select> <button class=\"button\" id=\"wr26-r-refresh\">Refresh</button></p><div id=\"wr26-r-wrap\"></div>'); const load=()=>{loading();post('getRegistrations',{q:$('#wr26-q').val(),status:$('#wr26-status').val()}).done(function(r){if(!r||!r.success){err((r&&r.message)||'Unable to load registrations');return;}const rows=(r.registrations||r.data&&r.data.registrations||[]).map(x=>'<tr><td>'+esc(x.registrationId||x.id)+'</td><td>'+esc((x.firstName||'')+' '+(x.lastName||''))+'</td><td>'+esc(x.email)+'</td><td>'+esc(x.phone)+'</td><td>'+esc(x.church)+'</td><td>'+esc(x.paymentStatus)+'</td><td>'+esc(x.finalAmount)+'</td><td>'+esc(x.checkedIn)+'</td><td>'+esc(x.status)+'</td></tr>').join('');$('#wr26-r-wrap').html('<table class=\"widefat striped\"><thead><tr><th>Registration ID</th><th>Name</th><th>Email</th><th>Phone</th><th>Church</th><th>Payment Status</th><th>Final Amount</th><th>Checked In</th><th>Status</th></tr></thead><tbody>'+(rows||'<tr><td colspan=\"9\">No results.</td></tr>')+'</tbody></table>');}).fail(()=>err('Unable to load registrations'));};$('#wr26-r-refresh,#wr26-status').on('click change',load);$('#wr26-q').on('keyup',function(e){if(e.key==='Enter') load();});load();}
    if(page==='waitlist'){app.html('<p><button class=\"button\" id=\"wr26-w-refresh\">Refresh</button></p><div id=\"wr26-w-wrap\"></div>'); const load=()=>{loading();post('getWaitlist').done(function(r){if(!r||!r.success){err((r&&r.message)||'Unable to load waitlist');return;}const list=(r.waitlist||r.data&&r.data.waitlist||[]);const rows=list.map((x,i)=>'<tr><td>'+(i+1)+'</td><td>'+esc((x.firstName||'')+' '+(x.lastName||''))+'</td><td>'+esc(x.email)+'</td><td>'+esc(x.phone)+'</td><td>'+esc(x.church)+'</td><td>'+esc(x.status)+'</td><td>'+esc(x.notes)+'</td><td><button class=\"button wr26-promote\" data-id=\"'+esc(x.waitlistId||x.id)+'\">Promote</button> <button class=\"button wr26-remove\" data-id=\"'+esc(x.waitlistId||x.id)+'\">Remove</button></td></tr>').join('');$('#wr26-w-wrap').html('<table class=\"widefat striped\"><thead><tr><th>Position</th><th>Name</th><th>Email</th><th>Phone</th><th>Church</th><th>Status</th><th>Notes</th><th>Actions</th></tr></thead><tbody>'+(rows||'<tr><td colspan=\"8\">No waitlist entries.</td></tr>')+'</tbody></table>');}).fail(()=>err('Unable to load waitlist'));};app.on('click','.wr26-promote',function(){post('promoteWaitlist',{waitlist_id:$(this).data('id')}).done(load);});app.on('click','.wr26-remove',function(){post('removeWaitlist',{waitlist_id:$(this).data('id')}).done(load);});$('#wr26-w-refresh').on('click',load);load();}
    if(page==='checkin'){app.html('<p><button class=\"button\" id=\"wr26-c-stats\">Refresh Stats</button></p><div id=\"wr26-c-stats-wrap\"></div><p><input id=\"wr26-c-q\" placeholder=\"Search registrations\"> <button class=\"button\" id=\"wr26-c-search\">Search</button></p><div id=\"wr26-c-results\"></div>'); const loadStats=()=>post('getCheckInStats').done(r=>{$('#wr26-c-stats-wrap').html('<pre>'+esc(JSON.stringify((r.data||r),null,2))+'</pre>');}); const search=()=>{post('searchRegistrations',{q:$('#wr26-c-q').val()}).done(function(r){if(!r||!r.success){$('#wr26-c-results').html('<p style=\"color:#b32d2e\">Search failed</p>');return;}const rows=(r.registrations||r.data&&r.data.registrations||[]).map(x=>'<tr><td>'+esc((x.firstName||'')+' '+(x.lastName||''))+'</td><td>'+esc(x.church)+'</td><td>'+esc(x.paymentStatus)+'</td><td>'+esc(x.balance||x.balanceDue)+'</td><td>'+esc(x.checkedIn)+'</td><td><button class=\"button wr26-checkin\" data-id=\"'+esc(x.registrationId||x.id)+'\">Check In</button> <button class=\"button wr26-pay\" data-id=\"'+esc(x.registrationId||x.id)+'\">Record Payment</button></td></tr>').join('');$('#wr26-c-results').html('<table class=\"widefat striped\"><thead><tr><th>Name</th><th>Church</th><th>Payment Status</th><th>Balance</th><th>Checked In</th><th>Actions</th></tr></thead><tbody>'+(rows||'<tr><td colspan=\"6\">No results.</td></tr>')+'</tbody></table>');});};app.on('click','.wr26-checkin',function(){post('checkinById',{registration_id:$(this).data('id')}).done(search);});app.on('click','.wr26-pay',function(){const id=$(this).data('id');const amt=prompt('Amount paid'); if(!amt) return; post('recordPayment',{registration_id:id,payment_method:'manual',amount_paid:amt}).done(search);});$('#wr26-c-stats').on('click',loadStats);$('#wr26-c-search').on('click',search);loadStats();}
    if(page==='rosters'){loading();post('getChurchRosters').done(function(r){if(!r||!r.success){err('Unable to load rosters');return;}const rosters=(r.rosters||r.data&&r.data.rosters||{});let html='';Object.keys(rosters).forEach(ch=>{html+='<h3>'+esc(ch)+'</h3><table class=\"widefat striped\"><thead><tr><th>Name</th><th>Payment</th><th>Checked In</th></tr></thead><tbody>'+((rosters[ch]||[]).map(x=>'<tr><td>'+esc((x.firstName||'')+' '+(x.lastName||''))+'</td><td>'+esc(x.paymentStatus)+'</td><td>'+esc(x.checkedIn)+'</td></tr>').join('')||'<tr><td colspan=\"3\">No entries.</td></tr>')+'</tbody></table>';});app.html(html||'<p>No rosters found.</p>');}).fail(()=>err('Unable to load rosters'));}
    if(page==='promo'){app.html('<p><button class=\"button\" id=\"wr26-p-refresh\">Refresh</button></p><h3>Create / Update Promo</h3><p><input id=\"wr26-code\" placeholder=\"Code\"> <select id=\"wr26-type\"><option value=\"fixed\">fixed</option><option value=\"percent\">percent</option></select> <input id=\"wr26-amount\" type=\"number\" step=\"0.01\" placeholder=\"Amount\"> <input id=\"wr26-max\" type=\"number\" placeholder=\"Max uses\"> <input id=\"wr26-exp\" type=\"date\"> <label><input id=\"wr26-active\" type=\"checkbox\" checked> Active</label> <button class=\"button button-primary\" id=\"wr26-save-promo\">Save</button></p><div id=\"wr26-p-wrap\"></div>'); const load=()=>post('getPromoCodes').done(function(r){const list=(r.promoCodes||[]);const rows=list.map(x=>'<tr><td>'+esc(x.code)+'</td><td>'+esc(x.discountType)+'</td><td>'+esc(x.discountAmount)+'</td><td>'+esc(x.maxUses)+'</td><td>'+esc(x.currentUses)+'</td><td>'+esc(x.expiryDate)+'</td><td>'+esc(x.active)+'</td><td><button class=\"button wr26-del-promo\" data-code=\"'+esc(x.code)+'\">Deactivate/Delete</button></td></tr>').join('');$('#wr26-p-wrap').html('<table class=\"widefat striped\"><thead><tr><th>Code</th><th>Type</th><th>Amount</th><th>Max Uses</th><th>Current Uses</th><th>Expiry</th><th>Active</th><th>Actions</th></tr></thead><tbody>'+(rows||'<tr><td colspan=\"8\">No promo codes.</td></tr>')+'</tbody></table>');});};$('#wr26-save-promo').on('click',function(){post('savePromoCode',{code:$('#wr26-code').val(),description:'',discountType:$('#wr26-type').val(),discountAmount:$('#wr26-amount').val(),maxUses:$('#wr26-max').val(),minPurchase:0,expiryDate:$('#wr26-exp').val(),active:$('#wr26-active').is(':checked')?'true':'false'}).done(load);});app.on('click','.wr26-del-promo',function(){post('deletePromoCode',{code:$(this).data('code')}).done(load);});$('#wr26-p-refresh').on('click',load);load();}
    });</script>
JS;
    echo str_replace('__PAGE__', esc_js($active), $script);
}
function wr26_page_settings(){
    if(isset($_POST['wr26_save_settings'])&&check_admin_referer('wr26_save_settings')){ foreach(array('wr26_gas_url','wr26_form_id','wr26_capacity','wr26_waitlist_enabled','wr26_edit_page_url','wr26_event_name','wr26_event_dates','wr26_event_location','wr26_payment_default','wr26_worker_registration_url') as $k){ if(isset($_POST[$k])) update_option($k,sanitize_text_field($_POST[$k])); } if($_POST['wr26_registered_count']!=='') update_option('wr26_registered_count',intval($_POST['wr26_registered_count'])); echo '<div class="updated"><p>Saved.</p></div>'; }
    wr26_admin_header('WR26 Settings','settings');
    echo '<form method="post">'; wp_nonce_field('wr26_save_settings');
    foreach(array('wr26_gas_url'=>'GAS URL','wr26_form_id'=>'Fluent Form ID','wr26_capacity'=>'Capacity','wr26_waitlist_enabled'=>'Waitlist Enabled','wr26_edit_page_url'=>'Edit Registration Page URL','wr26_event_name'=>'Event Name','wr26_event_dates'=>'Event Dates','wr26_event_location'=>'Event Location','wr26_payment_default'=>'Default Payment Method','wr26_worker_registration_url'=>'Worker Registration URL','wr26_registered_count'=>'Registered Count Override') as $k=>$label){ echo '<p><label>'.esc_html($label).'<br><input class="regular-text" name="'.esc_attr($k).'" value="'.esc_attr(get_option($k,'')).'"></label></p>'; }
    echo '<p>GAS Secret: <code>'.esc_html(get_option('wr26_gas_secret','')).'</code></p><p><button class="button button-primary" name="wr26_save_settings" value="1">Save</button></p></form>';
}

add_shortcode('wr_edit_registration', function(){
    wp_enqueue_script('jquery');
    $token = sanitize_text_field($_GET['token'] ?? '');
    if (!$token) {
        return '<p style="color:#d63638">No registration token found. Please use the link from your confirmation email.</p>';
    }
    $ajax_url = esc_js(admin_url('admin-ajax.php'));
    $token_js = esc_js($token);
    return '<div id="wr26-edit-wrap" style="max-width:640px"><div id="wr26-edit-loading" style="padding:16px;color:#646970">Loading your registration…</div><form id="wr26-edit-form" style="display:none"><p><strong>Name:</strong> <span id="wr26-edit-name"></span></p><p style="color:#646970;font-style:italic;font-size:.9em">Email, payment details, and arrival dates cannot be changed here. To update those, please contact us directly.</p><table style="width:100%;border-collapse:collapse;margin-bottom:16px"><tr><td style="padding:6px 0;width:200px;font-weight:600">First Name</td><td><input type="text" name="first_name" style="width:100%;padding:6px;border:1px solid #ccd0d4;border-radius:3px"></td></tr><tr><td style="padding:6px 0;font-weight:600">Last Name</td><td><input type="text" name="last_name" style="width:100%;padding:6px;border:1px solid #ccd0d4;border-radius:3px"></td></tr><tr><td style="padding:6px 0;font-weight:600">Phone</td><td><input type="tel" name="phone" style="width:100%;padding:6px;border:1px solid #ccd0d4;border-radius:3px"></td></tr><tr><td style="padding:6px 0;font-weight:600">Church</td><td><input type="text" name="church" style="width:100%;padding:6px;border:1px solid #ccd0d4;border-radius:3px"></td></tr><tr><td style="padding:6px 0;font-weight:600">Dietary Needs</td><td><textarea name="dietary_needs" rows="2" style="width:100%;padding:6px;border:1px solid #ccd0d4;border-radius:3px"></textarea></td></tr><tr><td style="padding:6px 0;font-weight:600">Emergency Contact Name</td><td><input type="text" name="emergency_contact_name" style="width:100%;padding:6px;border:1px solid #ccd0d4;border-radius:3px"></td></tr><tr><td style="padding:6px 0;font-weight:600">Emergency Contact Phone</td><td><input type="tel" name="emergency_contact_phone" style="width:100%;padding:6px;border:1px solid #ccd0d4;border-radius:3px"></td></tr><tr><td style="padding:6px 0;font-weight:600">Special Needs</td><td><textarea name="special_needs" rows="2" style="width:100%;padding:6px;border:1px solid #ccd0d4;border-radius:3px"></textarea></td></tr></table><p><button type="button" id="wr26-edit-save" style="background:#1a7efb;color:#fff;border:none;padding:10px 24px;border-radius:4px;font-size:1em;cursor:pointer">Save Changes</button> <span id="wr26-edit-status" style="margin-left:12px;color:#d63638"></span></p></form><div id="wr26-edit-success" style="display:none;background:#d1e7dd;border-radius:4px;padding:16px;color:#0a3622;font-size:1.05em">✅ Your registration has been updated successfully. You will receive a confirmation email shortly.</div></div><script>jQuery(function($){var ajaxUrl="' . $ajax_url . '";var token="' . $token_js . '";$.post(ajaxUrl,{action:"wr26_get_reg_by_token",token:token},function(r){if(!r||!r.success){$("#wr26-edit-loading").html("<p style=\"color:#d63638\">Could not load your registration. Please check your link and try again.</p>");return;}var reg=r.registration||{};$("#wr26-edit-loading").hide();$("#wr26-edit-name").text((reg.firstName||"")+" "+(reg.lastName||""));$("[name=\"first_name\"]").val(reg.firstName||"");$("[name=\"last_name\"]").val(reg.lastName||"");$("[name=\"phone\"]").val(reg.phone||"");$("[name=\"church\"]").val(reg.church||"");$("[name=\"dietary_needs\"]").val(reg.dietaryNeeds||"");$("[name=\"emergency_contact_name\"]").val(reg.emergencyContactName||"");$("[name=\"emergency_contact_phone\"]").val(reg.emergencyContactPhone||"");$("[name=\"special_needs\"]").val(reg.specialNeeds||"");$("#wr26-edit-form").show();});$("#wr26-edit-save").on("click",function(){$("#wr26-edit-status").text("Saving…").css("color","#646970");$.post(ajaxUrl,{action:"wr26_save_edit",edit_token:token,first_name:$("[name=\"first_name\"]").val(),last_name:$("[name=\"last_name\"]").val(),phone:$("[name=\"phone\"]").val(),church:$("[name=\"church\"]").val(),dietary_needs:$("[name=\"dietary_needs\"]").val(),emergency_contact_name:$("[name=\"emergency_contact_name\"]").val(),emergency_contact_phone:$("[name=\"emergency_contact_phone\"]").val(),special_needs:$("[name=\"special_needs\"]").val()},function(r){if(r&&r.success){$("#wr26-edit-form").hide();$("#wr26-edit-success").show();$("html,body").animate({scrollTop:$("#wr26-edit-success").offset().top-80},400);}else{$("#wr26-edit-status").text("❌ "+(r&&r.message?r.message:"Save failed.")).css("color","#d63638");}});});});</script>';
});
