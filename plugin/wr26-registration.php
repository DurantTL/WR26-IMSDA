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

function wr26_has_meaningful_attendee_data($candidate) {
    $checks = array(
        wr26_value_from_keys($candidate, array('first_name', 'attendee_first_name', 'firstName'), ''),
        wr26_value_from_keys($candidate, array('last_name', 'attendee_last_name', 'lastName'), ''),
        wr26_value_from_keys($candidate, array('email', 'attendee_email'), ''),
        wr26_value_from_keys($candidate, array('phone', 'attendee_phone'), ''),
        wr26_value_from_keys($candidate, array('meal_preference', 'attendee_meal_preference'), ''),
        wr26_value_from_keys($candidate, array('dietary_needs', 'attendee_dietary_needs'), ''),
        wr26_value_from_keys($candidate, array('childcare_needed', 'attendee_childcare_needed'), '')
    );
    foreach ($checks as $value) {
        if (is_array($value) && !empty($value)) return true;
        if (trim((string) $value) !== '') return true;
    }
    $seminars = wr26_build_seminar_preferences($candidate);
    return !empty($seminars);
}

function wr26_build_seminar_preferences($attendee) {
    $preferences = array();
    $direct = wr26_value_from_keys($attendee, array('seminar_preferences', 'session_preferences'), array());
    if (!empty($direct)) {
        $preferences['raw'] = $direct;
    }
    foreach (array('friday_session', 'saturday_session_1', 'saturday_session_2', 'sunday_session') as $slot) {
        $value = wr26_value_from_keys($attendee, array($slot), '');
        if ($value !== '') $preferences[$slot] = $value;
    }
    foreach ($attendee as $key => $value) {
        if (preg_match('/^session_\d+_preference_\d+$/', (string) $key)) {
            $preferences[$key] = $value;
        }
    }
    return $preferences;
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
    $first = $raw['first_name'] ?? '';
    $last = $raw['last_name'] ?? '';
    foreach ($raw as $v) {
        if (is_array($v)) {
            if (!$first && !empty($v['first_name'])) $first = $v['first_name'];
            if (!$last && !empty($v['last_name'])) $last = $v['last_name'];
        }
    }
    $payment_method = wr26_normalize_payment_method($raw['payment_method'] ?? $raw['payment'] ?? $raw['pay_method'] ?? get_option('wr26_payment_default', 'pay_later'));
    $promo = strtoupper(sanitize_text_field($raw['promo_code'] ?? $raw['discount_code'] ?? $raw['coupon_code'] ?? $raw['coupon'] ?? ''));
    $amount = wr26_extract_amount($raw, $entry_id, $wpdb);
    $attendees = array();
    foreach (array('attendees', 'attendee', 'guests', 'registrants', 'people') as $container_key) {
        if (!empty($raw[$container_key]) && is_array($raw[$container_key])) {
            foreach ($raw[$container_key] as $idx => $candidate) {
                if (!is_array($candidate)) continue;
                $first_name = sanitize_text_field(wr26_value_from_keys($candidate, array('first_name', 'attendee_first_name', 'firstName'), ''));
                $last_name = sanitize_text_field(wr26_value_from_keys($candidate, array('last_name', 'attendee_last_name', 'lastName'), ''));
                if (!wr26_has_meaningful_attendee_data($candidate)) continue;
                $attendees[] = array(
                    'attendee_id' => 'A-'.intval($entry_id).'-'.($idx + 1),
                    'first_name' => $first_name,
                    'last_name' => $last_name,
                    'phone' => sanitize_text_field(wr26_value_from_keys($candidate, array('phone', 'attendee_phone'), '')),
                    'email' => sanitize_email(wr26_value_from_keys($candidate, array('email', 'attendee_email'), '')),
                    'church' => sanitize_text_field(wr26_value_from_keys($candidate, array('church', 'attendee_church'), '')),
                    'attendee_type' => sanitize_text_field(wr26_value_from_keys($candidate, array('adult_child', 'attendee_type', 'type', 'age_group'), '')),
                    'meal_preference' => sanitize_text_field(wr26_value_from_keys($candidate, array('meal_preference', 'attendee_meal_preference'), '')),
                    'dietary_needs' => sanitize_textarea_field(wr26_value_from_keys($candidate, array('dietary_needs', 'attendee_dietary_needs'), '')),
                    'childcare_needed' => sanitize_text_field(wr26_value_from_keys($candidate, array('childcare_needed', 'attendee_childcare_needed'), '')),
                    'seminar_preferences' => wr26_build_seminar_preferences($candidate)
                );
            }
        }
    }
    if (empty($attendees)) {
        $attendees[] = array(
            'attendee_id' => 'A-'.intval($entry_id).'-1',
            'first_name' => sanitize_text_field($first),
            'last_name' => sanitize_text_field($last),
            'phone' => sanitize_text_field($raw['phone'] ?? ''),
            'email' => sanitize_email($raw['email'] ?? ''),
            'church' => sanitize_text_field($raw['church'] ?? ''),
            'attendee_type' => sanitize_text_field(wr26_value_from_keys($raw, array('adult_child', 'attendee_type', 'type', 'age_group'), '')),
            'meal_preference' => sanitize_text_field(wr26_value_from_keys($raw, array('meal_preference', 'attendee_meal_preference'), '')),
            'dietary_needs' => sanitize_textarea_field($raw['dietary_needs'] ?? ''),
            'childcare_needed' => sanitize_text_field(wr26_value_from_keys($raw, array('childcare_needed', 'attendee_childcare_needed'), '')),
            'seminar_preferences' => wr26_build_seminar_preferences($raw)
        );
    }

    return array(
        'entry_id' => intval($sub['id']), 'form_id' => intval($sub['form_id']),
        'first_name' => sanitize_text_field($first), 'last_name' => sanitize_text_field($last),
        'email' => sanitize_email($raw['email'] ?? ''), 'phone' => sanitize_text_field($raw['phone'] ?? ''),
        'church' => sanitize_text_field($raw['church'] ?? ''),
        'arrival_date' => sanitize_text_field($raw['arrival_date'] ?? ''), 'departure_date' => sanitize_text_field($raw['departure_date'] ?? ''),
        'dietary_needs' => sanitize_textarea_field($raw['dietary_needs'] ?? ''),
        'emergency_contact_name' => sanitize_text_field($raw['emergency_contact_name'] ?? ''),
        'emergency_contact_phone' => sanitize_text_field($raw['emergency_contact_phone'] ?? ''),
        'special_needs' => sanitize_textarea_field($raw['special_needs'] ?? ''), 'promo_code' => $promo,
        'payment_method' => $payment_method, 'amount' => floatval($amount), 'ip_address' => sanitize_text_field($sub['ip']),
        'submitted_at' => sanitize_text_field($sub['created_at']),
        'worker_flag' => sanitize_text_field(wr26_value_from_keys($raw, array('worker', 'is_worker', 'worker_registration', 'non_paying_worker'), '')),
        'attendees' => $attendees
    );
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
    if (empty($body['success'])) return !empty($body['message']) ? $body['message'] : 'Unknown GAS error';
    if ($action === 'register') update_option('wr26_registered_count', intval(get_option('wr26_registered_count', 0)) + 1, false);
    if ($action === 'waitlist') update_option('wr26_waitlist_count', intval(get_option('wr26_waitlist_count', 0)) + 1, false);
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
    $action = intval(get_option('wr26_registered_count', 0)) < intval(get_option('wr26_capacity', 350)) ? 'register' : 'waitlist';
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
    $payload=array('action'=>$a,'registrationId'=>sanitize_text_field($_POST['registration_id']??''),'waitlistId'=>sanitize_text_field($_POST['waitlist_id']??''),'token'=>sanitize_text_field($_POST['token']??''),'q'=>sanitize_text_field($_POST['q']??''),'status'=>sanitize_text_field($_POST['status']??''),'code'=>sanitize_text_field($_POST['code']??''),'fields'=>$_POST['fields']??array(),'adminUser'=>wp_get_current_user()->user_email,'newFirstName'=>sanitize_text_field($_POST['new_first_name']??''),'newLastName'=>sanitize_text_field($_POST['new_last_name']??''),'newEmail'=>sanitize_email($_POST['new_email']??''),'newPhone'=>sanitize_text_field($_POST['new_phone']??''),'newChurch'=>sanitize_text_field($_POST['new_church']??''),'reason'=>sanitize_textarea_field($_POST['reason']??''),'refundNotes'=>sanitize_textarea_field($_POST['refund_notes']??''),'adminNotes'=>sanitize_textarea_field($_POST['admin_notes']??''),'promo'=>array_map('sanitize_text_field',$_POST['promo']??array()));
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
function wr26_page_dashboard(){ wr26_admin_header('WR26 Dashboard','dashboard'); echo '<p>Use other tabs for full management. Queue and failed items are managed via AJAX actions.</p>'; }
function wr26_page_generic(){ wr26_admin_header('WR26',''); echo '<div id="wr26-app"></div>'; }
function wr26_page_settings(){
    if(isset($_POST['wr26_save_settings'])&&check_admin_referer('wr26_save_settings')){ foreach(array('wr26_gas_url','wr26_form_id','wr26_capacity','wr26_waitlist_enabled','wr26_edit_page_url','wr26_event_name','wr26_event_dates','wr26_event_location','wr26_payment_default','wr26_worker_registration_url') as $k){ if(isset($_POST[$k])) update_option($k,sanitize_text_field($_POST[$k])); } if($_POST['wr26_registered_count']!=='') update_option('wr26_registered_count',intval($_POST['wr26_registered_count'])); echo '<div class="updated"><p>Saved.</p></div>'; }
    wr26_admin_header('WR26 Settings','settings');
    echo '<form method="post">'; wp_nonce_field('wr26_save_settings');
    foreach(array('wr26_gas_url'=>'GAS URL','wr26_form_id'=>'Fluent Form ID','wr26_capacity'=>'Capacity','wr26_waitlist_enabled'=>'Waitlist Enabled','wr26_edit_page_url'=>'Edit Registration Page URL','wr26_event_name'=>'Event Name','wr26_event_dates'=>'Event Dates','wr26_event_location'=>'Event Location','wr26_payment_default'=>'Default Payment Method','wr26_worker_registration_url'=>'Worker Registration URL','wr26_registered_count'=>'Registered Count Override') as $k=>$label){ echo '<p><label>'.esc_html($label).'<br><input class="regular-text" name="'.esc_attr($k).'" value="'.esc_attr(get_option($k,'')).'"></label></p>'; }
    echo '<p>GAS Secret: <code>'.esc_html(get_option('wr26_gas_secret','')).'</code></p><p><button class="button button-primary" name="wr26_save_settings" value="1">Save</button></p></form>';
}

add_shortcode('wr_edit_registration', fn()=>'<div id="wr26-edit-registration">Edit form loads via AJAX using token.</div>');
