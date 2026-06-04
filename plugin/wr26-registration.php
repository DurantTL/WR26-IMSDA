<?php
/**
 * Plugin Name: WR26 Registration
 * Description: Women's Retreat 2026 registration + waitlist + check-in bridge for Fluent Forms and Google Apps Script.
 * Version: 1.0.5
 * Author: IMSDA
 */

if (!defined('ABSPATH')) {
    exit;
}

define('WR26_VERSION', '1.0.5');

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
        'wr26_payment_failures' => array(),
        'wr26_dispatch_last_run' => '',
        'wr26_event_name' => "Women's Retreat 2026",
        'wr26_event_dates' => 'October 9–11, 2026',
        'wr26_event_location' => 'Des Moines, IA',
        'wr26_payment_default' => 'pay_later',
        'wr26_early_bird_price' => '125',
        'wr26_regular_price' => '145',
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

function wr26_queue_entry($entry_id, $action, $extra = array()) {
    $entry_id = intval($entry_id);
    $action = sanitize_text_field($action);
    $queue = get_option('wr26_dispatch_queue', array());
    foreach ($queue as $item) {
        if (intval($item['entry_id']) === $entry_id && $item['action'] === $action) {
            return;
        }
    }
    $item = array('entry_id' => $entry_id, 'action' => $action, 'queued_at' => current_time('mysql'), 'attempts' => 0);
    if (!empty($extra)) {
        $item['extra'] = $extra;
    }
    $queue[] = $item;
    update_option('wr26_dispatch_queue', $queue, false);
}

/**
 * Sanitize one attendee's ranked seminar preferences into the
 * { session_N: { pref_1: title, pref_2: title, ... } } shape that GAS
 * flattenSeminarPreferences expects. Slots are limited to session_1..session_4
 * and ranks to pref_1..pref_4; everything is run through sanitize_text_field.
 */
function wr26_sanitize_seminar_preferences($prefs) {
    $out = array();
    if (!is_array($prefs)) {
        return $out;
    }
    foreach (array('session_1', 'session_2', 'session_3', 'session_4') as $slot) {
        if (empty($prefs[$slot]) || !is_array($prefs[$slot])) {
            continue;
        }
        $slot_out = array();
        foreach (array('pref_1', 'pref_2', 'pref_3', 'pref_4') as $rank) {
            if (!isset($prefs[$slot][$rank])) {
                continue;
            }
            $title = sanitize_text_field((string) $prefs[$slot][$rank]);
            if ($title !== '') {
                $slot_out[$rank] = $title;
            }
        }
        if (!empty($slot_out)) {
            $out[$slot] = $slot_out;
        }
    }
    return $out;
}

/**
 * Build the attendees array from the hidden attendees_json field produced by the
 * custom roster UI. Returns an empty array when the field is absent or invalid so
 * the caller can fall back to the legacy a{N}_* fields. There is no fixed cap on
 * the number of attendees — GAS prices off the array length.
 */
function wr26_attendees_from_json($raw, $entry_id, $church) {
    if (empty($raw['attendees_json'])) {
        return array();
    }
    $decoded = json_decode((string) $raw['attendees_json'], true);
    if (!is_array($decoded)) {
        return array();
    }
    $attendees = array();
    $n = 0;
    foreach ($decoded as $a) {
        if (!is_array($a)) continue;
        if (empty($a['first_name']) && empty($a['last_name'])) continue;
        $n++;
        $attendees[] = array(
            'attendee_id'         => 'A-' . intval($entry_id) . '-' . $n,
            'first_name'          => sanitize_text_field($a['first_name'] ?? ''),
            'last_name'           => sanitize_text_field($a['last_name'] ?? ''),
            'phone'               => sanitize_text_field($a['phone'] ?? ''),
            'email'               => $n === 1 ? sanitize_email($raw['email'] ?? ($a['email'] ?? '')) : sanitize_email($a['email'] ?? ''),
            'church'              => $n === 1 ? $church : sanitize_text_field($a['church'] ?? ''),
            'attendee_type'       => sanitize_text_field($a['attendee_type'] ?? ''),
            'meal_preference'     => sanitize_text_field($a['meal_preference'] ?? ''),
            'dietary_needs'       => sanitize_textarea_field($a['dietary_needs'] ?? ''),
            'childcare_needed'    => sanitize_text_field($a['childcare_needed'] ?? ''),
            'childcare_children'  => sanitize_text_field($a['childcare_children'] ?? ''),
            'volunteer'           => sanitize_text_field($a['volunteer'] ?? ''),
            'seminar_preferences' => wr26_sanitize_seminar_preferences($a['seminar_preferences'] ?? array()),
        );
    }
    return $attendees;
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

    // Preferred path: the custom roster UI submits one clean hidden field,
    // attendees_json, with an uncapped array of attendees. When present and valid
    // it is the source of truth. When absent (older form / JS disabled) we fall
    // back to the legacy a{N}_* fields below.
    $attendees = wr26_attendees_from_json($raw, $entry_id, $church);

    // Legacy fallback: read attendees from a{N}_* fields (N = 1..attendee_count).
    // a1_first_name/last_name/phone/attendee_type were added in the May 2026 form
    // restructure; they are always visible and required. a2_-a5_ equivalents are
    // hidden by Fluent Forms conditional logic when attendee_count < N and submit
    // as empty strings — the empty-first-name guard handles those slots. The count
    // is no longer hard-capped at 5: GAS prices off the attendee array length.
    if (empty($attendees)) {
    $attendee_count = max(1, intval($raw['attendee_count'] ?? 1));
    for ($n = 1; $n <= $attendee_count; $n++) {
        $prefix = "a{$n}_";
        if ($n > 1 && empty($raw["{$prefix}first_name"])) continue;
        $attendees[] = array(
            'attendee_id'     => 'A-' . intval($entry_id) . '-' . $n,
            'first_name'      => sanitize_text_field($raw["{$prefix}first_name"] ?? ''),
            'last_name'       => sanitize_text_field($raw["{$prefix}last_name"] ?? ''),
            'phone'           => sanitize_text_field($raw["{$prefix}phone"] ?? ''),
            'email'           => $n === 1 ? sanitize_email($raw['email'] ?? '') : '',
            'church'          => $n === 1 ? $church : '',
            'attendee_type'   => sanitize_text_field($raw["{$prefix}attendee_type"] ?? ''),
            'meal_preference' => sanitize_text_field($raw["{$prefix}meal_preference"] ?? ''),
            'dietary_needs'   => sanitize_textarea_field($raw["{$prefix}dietary_needs"] ?? ''),
            'childcare_needed'=> sanitize_text_field($raw["{$prefix}childcare_needed"] ?? ''),
            'childcare_children'=> sanitize_text_field($raw["{$prefix}childcare_children"] ?? ''),
            'volunteer'       => sanitize_text_field($raw["{$prefix}volunteer"] ?? ''),
            'seminar_preferences' => array(
                'session_1' => array(
                    'pref_1' => sanitize_text_field($raw["{$prefix}session1_pref1"] ?? ''),
                    'pref_2' => sanitize_text_field($raw["{$prefix}session1_pref2"] ?? '')
                ),
                'session_2' => array(
                    'pref_1' => sanitize_text_field($raw["{$prefix}session2_pref1"] ?? ''),
                    'pref_2' => sanitize_text_field($raw["{$prefix}session2_pref2"] ?? '')
                ),
                'session_3' => array(
                    'pref_1' => sanitize_text_field($raw["{$prefix}session3_pref1"] ?? ''),
                    'pref_2' => sanitize_text_field($raw["{$prefix}session3_pref2"] ?? '')
                ),
                'session_4' => array(
                    'pref_1' => sanitize_text_field($raw["{$prefix}session4"] ?? '')
                )
            )
        );
    }
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

function wr26_build_and_send($entry_id, $action, $extra = array()) {
    $url = esc_url_raw(get_option('wr26_gas_url', ''));
    if (!$url) return 'Missing GAS URL';
    $data = wr26_parse_ff_entry($entry_id);
    if (empty($data)) return 'Fluent Forms entry not found';
    $payload = array_merge($data, array(
        'action' => sanitize_text_field($action), 'secret' => get_option('wr26_gas_secret', ''), 'site' => site_url(), 'version' => WR26_VERSION,
        'edit_page_url' => esc_url_raw(get_option('wr26_edit_page_url', site_url('/wr26-edit/')))
    ));
    if (!empty($extra)) {
        $payload = array_merge($payload, $extra);
    }
    // Retries transient Google front-end failures; safe because GAS de-duplicates by entry_id.
    $res = wr26_gas_http_post($url, $payload, 45, 3);
    if (empty($res['ok'])) return $res['message'];
    $body = $res['body'];
    if (empty($body['success'])) {
        if ($action === 'register' && !empty($body['capacityFull'])) {
            $waitlist_payload = array_merge($payload, array('action' => 'waitlist'));
            $waitlist_res = wr26_gas_http_post($url, $waitlist_payload, 45, 3);
            if (empty($waitlist_res['ok'])) return $waitlist_res['message'];
            $waitlist_body = $waitlist_res['body'];
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
        $result = wr26_build_and_send($item['entry_id'], $item['action'], $item['extra'] ?? array());
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
    if ($is_online) {
        // FF native payment handles this path — fluentform_payment_success fires after charge
        return;
    }
    // Pay Later / offline path — queue immediately
    $action = intval(get_option('wr26_registered_count', 0)) < intval(get_option('wr26_capacity', 350)) ? 'register' : 'waitlist';
    wr26_queue_entry($entry_id, $action, array('payment_status' => 'pending_offline'));
}, 10, 3);

// FF native Square charge succeeded — read transaction details and queue GAS dispatch
add_action('fluentform_payment_success', function($transaction, $submission, $form) {
    if (!is_object($submission)) return;
    $entry_id = intval($submission->id ?? 0);
    if (!$entry_id) return;

    // Verify this is the WR26 form
    $configured_form_id = intval(get_option('wr26_form_id', 0));
    $form_id = is_object($form) ? intval($form->id ?? 0) : intval($form ?? 0);
    if (!$form_id) {
        global $wpdb;
        $form_id = intval($wpdb->get_var($wpdb->prepare("SELECT form_id FROM {$wpdb->prefix}fluentform_submissions WHERE id=%d", $entry_id)));
    }
    if ($configured_form_id && $form_id !== $configured_form_id) return;

    $charge_id  = '';
    $amount_paid = 0.0;
    $coupon_used = '';

    if (is_object($transaction)) {
        $charge_id   = sanitize_text_field($transaction->charge_id ?? $transaction->transaction_hash ?? '');
        $amount_paid = floatval(($transaction->payment_total ?? 0) / 100);
        // Coupon may be stored as a code or an ID depending on FF Pro version
        $coupon_used = sanitize_text_field($transaction->coupon_code ?? ($transaction->coupon_id ? (string) $transaction->coupon_id : ''));
    }

    $action = intval(get_option('wr26_registered_count', 0)) < intval(get_option('wr26_capacity', 350)) ? 'register' : 'waitlist';
    wr26_queue_entry($entry_id, $action, array(
        'payment_status'   => 'paid',
        'square_charge_id' => $charge_id,
        'amount_paid'      => $amount_paid,
        'coupon_used'      => $coupon_used,
    ));
}, 10, 3);

// FF native Square charge failed — log for admin visibility; FF blocks submission so no entry is created
add_action('fluentform_payment_failed', function($transaction, $submission, $form) {
    if (!is_object($submission)) return;
    $entry_id = intval($submission->id ?? 0);

    $form_id = is_object($form) ? intval($form->id ?? 0) : intval($form ?? 0);
    if (!$form_id && $entry_id) {
        global $wpdb;
        $form_id = intval($wpdb->get_var($wpdb->prepare("SELECT form_id FROM {$wpdb->prefix}fluentform_submissions WHERE id=%d", $entry_id)));
    }
    $configured_form_id = intval(get_option('wr26_form_id', 0));
    if ($configured_form_id && $form_id !== $configured_form_id) return;

    $failures = get_option('wr26_payment_failures', array());
    $failures[] = array(
        'entry_id'  => $entry_id,
        'form_id'   => $form_id,
        'failed_at' => current_time('mysql'),
        'charge_id' => sanitize_text_field(is_object($transaction) ? ($transaction->charge_id ?? $transaction->transaction_hash ?? '') : ''),
        'error'     => sanitize_text_field(is_object($transaction) ? ($transaction->last_error ?? $transaction->status ?? '') : ''),
    );
    if (count($failures) > 100) {
        $failures = array_slice($failures, -100);
    }
    update_option('wr26_payment_failures', $failures, false);
    error_log('WR26 payment failed for entry ' . $entry_id . ': ' . (is_object($transaction) ? wp_json_encode($transaction) : '(no transaction)'));
}, 10, 3);

function wr26_gas_request($payload, $timeout = 30) {
    $url = esc_url_raw(get_option('wr26_gas_url', ''));
    if (!$url) return array('success' => false, 'message' => 'Missing GAS URL');
    $payload['secret'] = get_option('wr26_gas_secret', '');
    $payload['site'] = site_url();
    $payload['edit_page_url'] = esc_url_raw(get_option('wr26_edit_page_url', site_url('/wr26-edit/')));
    $res = wr26_gas_http_post($url, $payload, $timeout, 3);
    if (empty($res['ok'])) return array('success' => false, 'message' => $res['message']);
    return $res['body'];
}

function wr26_admin_guard() {
    if (!current_user_can('manage_options')) wp_send_json_error(array('message' => 'Unauthorized'), 403);
    if (!check_ajax_referer('wr26_admin_nonce', 'nonce', false)) wp_send_json_error(array('message' => 'Invalid nonce'), 403);
}


function wr26_tools_sanitize_secret($value) {
    return preg_replace('/[^A-Za-z0-9_\-.]/', '', (string) $value);
}

/**
 * A correctly deployed Apps Script web app URL looks like:
 *   https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec
 * (Google Workspace domains may use /a/macros/<domain>/s/<ID>/exec.)
 *
 * Anything else — the editor URL, the /dev URL, a bare script.google.com
 * link, or a truncated value — will be rejected by Google's front end with
 * an HTML error page long before the script runs.
 */
function wr26_gas_url_looks_valid($url) {
    $url = trim((string) $url);
    if ($url === '') return false;
    return (bool) preg_match('#^https://script\.google\.com/(a/)?macros/(s/[^/]+|[^/]+/s/[^/]+)/exec$#', $url);
}

/**
 * Turn a non-JSON GAS reply into an actionable diagnosis.
 *
 * When the body is Google's "Error 400 (Bad Request)" robot page (or a login
 * / quota page) it means the request never reached the Apps Script: Google's
 * front end answered instead. That is almost always a misconfigured GAS URL
 * or a web app that isn't deployed/shared correctly — not a bug in the script.
 */
function wr26_gas_diagnose_non_json($code, $raw_body) {
    $raw = (string) $raw_body;
    $is_google_html = (stripos($raw, '<!DOCTYPE html') !== false || stripos($raw, '<html') !== false)
        && (stripos($raw, 'google.com') !== false || stripos($raw, 'That') !== false);

    if ($code === 400 && $is_google_html) {
        return 'Google returned an HTTP 400 page instead of JSON, so this request did not reach Apps Script. '
            . 'Apps Script\'s front end does this intermittently even when the URL and deployment are correct, so the plugin '
            . 'retries automatically — and because registrations de-duplicate by entry, a momentary 400 here does NOT mean a '
            . 'submission was lost (run the full test below to confirm the connection works). '
            . 'Only if EVERY attempt fails (including the full test) is the GAS URL likely wrong or undeployed: in '
            . 'WR26 → Settings → GAS URL, paste the current Web app URL ending in /exec from Apps Script → Deploy → Manage '
            . 'deployments, redeploy (New deployment or Edit → new version) with "Who has access: Anyone", and retest.';
    }
    if (($code === 401 || $code === 403) || stripos($raw, 'accounts.google.com') !== false || stripos($raw, 'sign in') !== false) {
        return 'Google returned a sign-in/authorization page instead of JSON (HTTP ' . intval($code) . '). '
            . 'Redeploy the Apps Script web app with "Execute as: Me" and "Who has access: Anyone", then use the fresh /exec URL.';
    }
    if ($is_google_html) {
        return 'Google returned an HTML page (HTTP ' . intval($code) . ') instead of JSON — the request did not reach Apps Script. '
            . 'Verify the GAS URL ends in /exec and the web app deployment is current and shared with "Anyone".';
    }
    return 'GAS returned a non-JSON response (HTTP ' . intval($code) . '). See raw_body below.';
}

/**
 * POST JSON to the GAS web app, retrying transient failures.
 *
 * Apps Script's front end (script.google.com → script.googleusercontent.com)
 * intermittently answers a perfectly valid POST with a Google "Error 400" /
 * non-JSON HTML page even when the URL and deployment are correct; an identical
 * request a moment later succeeds. Because handleRegister()/handleWaitlist()
 * de-duplicate by entry_id, replaying a register/waitlist POST is safe, so we
 * retry these transient responses (Google HTML 400, 5xx, 429, 408, and WP
 * network errors) with a short backoff instead of reporting a false failure.
 *
 * Returns:
 *   on JSON reply: ['ok'=>true,  'body'=>array, 'http_code'=>int]
 *   on failure:    ['ok'=>false, 'http_code'=>int, 'raw_body'=>string, 'message'=>string]
 */
function wr26_gas_http_post($url, $payload, $timeout = 45, $tries = 3) {
    $last = array('ok' => false, 'http_code' => 0, 'raw_body' => '', 'message' => 'No response from GAS.');
    $tries = max(1, intval($tries));
    for ($attempt = 1; $attempt <= $tries; $attempt++) {
        if ($attempt > 1) {
            sleep(2 * ($attempt - 1)); // 2s, 4s, … backoff between attempts
        }
        $response = wp_remote_post($url, array(
            'timeout' => intval($timeout),
            'headers' => array('Content-Type' => 'application/json'),
            'body' => wp_json_encode($payload),
        ));
        if (is_wp_error($response)) {
            $last = array('ok' => false, 'http_code' => 0, 'raw_body' => '', 'message' => $response->get_error_message());
            continue; // network error — retry
        }
        $code = intval(wp_remote_retrieve_response_code($response));
        $raw_body = (string) wp_remote_retrieve_body($response);
        $body = json_decode($raw_body, true);
        if (is_array($body)) {
            return array('ok' => true, 'body' => $body, 'http_code' => $code);
        }
        // Non-JSON reply. Record diagnosis, then decide whether to retry.
        $last = array(
            'ok' => false,
            'http_code' => $code,
            'raw_body' => $raw_body,
            'message' => wr26_gas_diagnose_non_json($code, $raw_body),
        );
        $google_html = (stripos($raw_body, '<html') !== false || stripos($raw_body, '<!DOCTYPE html') !== false);
        $transient = ($code >= 500 || $code === 429 || $code === 408 || $code === 0 || ($code === 400 && $google_html));
        if (!$transient) {
            break; // genuine sign-in/auth/other error — retrying won't help
        }
    }
    return $last;
}

function wr26_tools_post_to_gas($payload, $timeout = 45) {
    $url = esc_url_raw(get_option('wr26_gas_url', ''));
    if (!$url) {
        return array('success' => false, 'message' => 'Missing WR26 GAS URL in WR26 settings.');
    }

    $payload['secret'] = get_option('wr26_gas_secret', '');
    $payload['site'] = site_url();
    $payload['version'] = WR26_VERSION;
    $payload['edit_page_url'] = esc_url_raw(get_option('wr26_edit_page_url', site_url('/wr26-edit/')));

    $res = wr26_gas_http_post($url, $payload, $timeout, 3);
    if (!empty($res['ok'])) {
        $body = $res['body'];
        $body['_http_code'] = $res['http_code'];
        return $body;
    }

    $raw_body = (string) ($res['raw_body'] ?? '');
    $trimmed = (strlen($raw_body) > 600) ? substr($raw_body, 0, 600) . '… [truncated]' : $raw_body;
    return array(
        'success' => false,
        'message' => $res['message'],
        'http_code' => intval($res['http_code']),
        'gas_url_valid' => wr26_gas_url_looks_valid(get_option('wr26_gas_url', '')),
        'raw_body' => $trimmed,
    );
}

function wr26_tools_fake_registration_payload() {
    $now = current_time('mysql');
    $stamp = gmdate('YmdHis');
    $entry_id = intval(gmdate('His'));
    $admin_email = get_option('admin_email');

    return array(
        'action' => 'register',
        'entry_id' => $entry_id,
        'form_id' => intval(get_option('wr26_form_id', 0)),
        'first_name' => 'WR26',
        'last_name' => 'GAS Test ' . $stamp,
        'email' => $admin_email,
        'phone' => '555-0100',
        'church' => 'IMSDA Test Church',
        'arrival_date' => '2026-10-09',
        'departure_date' => '2026-10-11',
        'dietary_needs' => 'None - fake test submission',
        'emergency_contact_name' => 'Test Emergency Contact',
        'emergency_contact_phone' => '555-0199',
        'special_needs' => 'Generated from WR26 GAS Tools. Safe to delete after test.',
        'attendee_notes' => 'FAKE TEST SUBMISSION generated from WordPress admin at ' . $now,
        'promo_code' => '',
        'payment_method' => 'pay_later',
        'payment_status' => 'pending_offline',
        'amount' => 0,
        'amount_paid' => 0,
        'ip_address' => isset($_SERVER['REMOTE_ADDR']) ? sanitize_text_field(wp_unslash($_SERVER['REMOTE_ADDR'])) : '',
        'submitted_at' => $now,
        'worker_flag' => '',
        'attendee_count' => 2,
        'admin_test' => true,
        'attendees' => array(
            array(
                'attendee_id' => 'A-TEST-' . $stamp . '-1',
                'first_name' => 'WR26',
                'last_name' => 'Test Adult',
                'phone' => '555-0100',
                'email' => $admin_email,
                'church' => 'IMSDA Test Church',
                'attendee_type' => 'adult',
                'meal_preference' => 'regular',
                'dietary_needs' => 'None',
                'childcare_needed' => 'no',
                'seminar_preferences' => array(
                    'session_1' => array('pref_1' => 'fri_opt_1', 'pref_2' => 'fri_opt_2'),
                    'session_2' => array('pref_1' => 'sat_2pm_opt_1', 'pref_2' => 'sat_2pm_opt_2', 'pref_3' => 'sat_2pm_opt_3'),
                    'session_3' => array('pref_1' => 'sat_330_opt_1', 'pref_2' => 'sat_330_opt_2'),
                    'session_4' => array('pref_1' => 'sun_opt_1'),
                ),
            ),
            array(
                'attendee_id' => 'A-TEST-' . $stamp . '-2',
                'first_name' => 'Second',
                'last_name' => 'Test Attendee',
                'phone' => '555-0101',
                'email' => '',
                'church' => '',
                'attendee_type' => 'adult',
                'meal_preference' => 'vegetarian',
                'dietary_needs' => 'Vegetarian',
                'childcare_needed' => 'no',
                'seminar_preferences' => array(
                    'session_1' => array('pref_1' => 'fri_opt_2', 'pref_2' => 'fri_opt_1'),
                    'session_2' => array('pref_1' => 'sat_2pm_opt_2', 'pref_2' => 'sat_2pm_opt_3', 'pref_3' => 'sat_2pm_opt_1'),
                    'session_3' => array('pref_1' => 'sat_330_opt_2', 'pref_2' => 'sat_330_opt_1'),
                    'session_4' => array('pref_1' => 'sun_opt_1'),
                ),
            ),
        ),
    );
}

function wr26_tools_page() {
    if (!current_user_can('manage_options')) {
        wp_die('Unauthorized');
    }

    $notice = null;
    $result = null;

    if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['wr26_gas_tools_action'])) {
        check_admin_referer('wr26_gas_tools');
        $action = sanitize_text_field(wp_unslash($_POST['wr26_gas_tools_action']));

        if ($action === 'save_secret') {
            $secret = wr26_tools_sanitize_secret(wp_unslash($_POST['wr26_gas_secret'] ?? ''));
            if (!$secret) {
                $notice = array('type' => 'error', 'message' => 'Secret cannot be blank.');
            } else {
                update_option('wr26_gas_secret', $secret, false);
                $notice = array('type' => 'success', 'message' => 'GAS secret saved. Copy this same value to the Google Sheet Config tab as SECRET.');
            }
        } elseif ($action === 'regenerate_secret') {
            $secret = wp_generate_password(48, false, false);
            update_option('wr26_gas_secret', $secret, false);
            $notice = array('type' => 'success', 'message' => 'New GAS secret generated. Copy it to the Google Sheet Config tab as SECRET before running the queue.');
        } elseif ($action === 'send_test') {
            $payload = wr26_tools_fake_registration_payload();
            $result = wr26_tools_post_to_gas($payload, 45);
            $notice = !empty($result['success'])
                ? array('type' => 'success', 'message' => 'Fake WR26 test registration sent to GAS successfully. Check Registrations, Attendees, and SeminarPreferences in the Sheet.')
                : array('type' => 'error', 'message' => 'Fake WR26 test registration failed. See response below.');
        } elseif ($action === 'ping_cache') {
            $result = wr26_tools_post_to_gas(array('action' => 'portalGetCacheSnapshot'), 45);
            $notice = !empty($result['success'])
                ? array('type' => 'success', 'message' => 'GAS cache snapshot/ping succeeded.')
                : array('type' => 'error', 'message' => 'GAS cache snapshot/ping failed. See response below.');
        } else {
            $notice = array('type' => 'error', 'message' => 'Unknown GAS Tools action.');
        }
    }

    $gas_url = get_option('wr26_gas_url', '');
    $secret = get_option('wr26_gas_secret', '');
    $form_id = get_option('wr26_form_id', '');
    $queue = get_option('wr26_dispatch_queue', array());
    $failed = get_option('wr26_failed_submissions', array());

    wr26_admin_header('WR26 GAS Tools', 'gas-tools');

    if ($notice) {
        echo '<div class="notice notice-' . esc_attr($notice['type']) . ' is-dismissible"><p>' . esc_html($notice['message']) . '</p></div>';
    }

    echo '<h2>Connection Summary</h2>';
    echo '<table class="widefat striped" style="max-width:900px"><tbody>';
    if (!$gas_url) {
        $gas_url_cell = '<strong style="color:#b32d2e">Missing</strong>';
    } elseif (wr26_gas_url_looks_valid($gas_url)) {
        $gas_url_cell = esc_html($gas_url);
    } else {
        $gas_url_cell = esc_html($gas_url) . '<br><strong style="color:#b32d2e">⚠ This does not look like a deployed web-app URL.</strong> '
            . 'It should end in <code>/exec</code> (Apps Script → Deploy → Manage deployments → Web app). '
            . 'A wrong URL is the usual cause of a Google "Error 400" / non-JSON response.';
    }
    echo '<tr><th style="width:220px">GAS URL</th><td>' . $gas_url_cell . '</td></tr>';
    echo '<tr><th>Fluent Form ID</th><td>' . esc_html((string) $form_id) . '</td></tr>';
    echo '<tr><th>Current GAS Secret</th><td><code>' . esc_html($secret) . '</code></td></tr>';
    echo '<tr><th>Queue Count</th><td>' . intval(is_array($queue) ? count($queue) : 0) . '</td></tr>';
    echo '<tr><th>Failed Submissions</th><td>' . intval(is_array($failed) ? count($failed) : 0) . '</td></tr>';
    echo '</tbody></table>';

    echo '<h2>Edit GAS Secret</h2>';
    echo '<p>Use the same value in the Google Sheet <strong>Config</strong> tab: <code>SECRET</code>.</p>';
    echo '<form method="post" style="max-width:900px">';
    wp_nonce_field('wr26_gas_tools');
    echo '<input type="hidden" name="wr26_gas_tools_action" value="save_secret">';
    echo '<p><input class="large-text code" name="wr26_gas_secret" value="' . esc_attr($secret) . '" autocomplete="off"></p>';
    echo '<p><button class="button button-primary">Save GAS Secret</button></p>';
    echo '</form>';

    echo '<form method="post" style="margin-top:8px">';
    wp_nonce_field('wr26_gas_tools');
    echo '<input type="hidden" name="wr26_gas_tools_action" value="regenerate_secret">';
    echo '<p><button class="button" onclick="return confirm(\'Generate a new secret? You must also update the Google Sheet Config SECRET.\')">Generate New Secret</button></p>';
    echo '</form>';

    echo '<h2>GAS Tests</h2>';
    echo '<p><strong>Ping / cache snapshot</strong> checks the GAS URL and secret without creating a registration.</p>';
    echo '<form method="post" style="display:inline-block;margin-right:8px">';
    wp_nonce_field('wr26_gas_tools');
    echo '<input type="hidden" name="wr26_gas_tools_action" value="ping_cache">';
    echo '<button class="button">Ping GAS / Cache Snapshot</button>';
    echo '</form>';

    echo '<p style="margin-top:18px"><strong>Send fake WR26 registration</strong> creates a real test registration in Google Sheets using a WR26-style two-attendee payload. Delete it from the Sheet after confirming the test.</p>';
    echo '<form method="post">';
    wp_nonce_field('wr26_gas_tools');
    echo '<input type="hidden" name="wr26_gas_tools_action" value="send_test">';
    echo '<button class="button button-primary" onclick="return confirm(\'This sends a fake test registration to GAS and may create rows in the Google Sheet. Continue?\')">Send Fake Registration to GAS</button>';
    echo '</form>';

    if ($result !== null) {
        echo '<h2>Latest GAS Response</h2>';
        echo '<pre style="max-width:1100px;white-space:pre-wrap;background:#fff;border:1px solid #ccd0d4;padding:14px;overflow:auto">' . esc_html(wp_json_encode($result, JSON_PRETTY_PRINT)) . '</pre>';
    }

    echo '<hr><p><strong>Tip:</strong> Use Ping GAS first. Use Send Fake Registration only for testing, then delete generated test rows from the Sheet afterward. Existing Dashboard queue buttons remain available under WR26 → Dashboard.</p>';
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
    $map=array('getRegistrations','adminEditRegistration','transferRegistration','getWaitlist','promoteWaitlist','removeWaitlist','checkinByToken','checkinById','searchRegistrations','getChurchRosters','getCheckInStats','getPromoCodes','savePromoCode','deletePromoCode','recordPayment','getPaymentStats','getPaymentsByStatus','getCouponStats');
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
    add_submenu_page('wr26-dashboard', 'GAS Tools', 'GAS Tools', 'manage_options', 'wr26-gas-tools', 'wr26_tools_page');
});
add_action('admin_enqueue_scripts', function($hook){ if(strpos((string)$hook,'wr26')===false) return; wp_enqueue_script('jquery'); wp_localize_script('jquery','wr26',array('ajax_url'=>admin_url('admin-ajax.php'),'nonce'=>wp_create_nonce('wr26_admin_nonce'))); });

/**
 * Enqueue the live payment-summary/recalc script on the front end.
 *
 * The script lives in plugin/assets so it is delivered as a real, executable
 * asset. It cannot ship inside the Fluent Forms Custom HTML field: Fluent Forms
 * sanitizes that markup and strips <script> tags, which left the JS rendering as
 * visible text and the summary frozen at $0.00. The script self-gates on
 * `.wr26-summary-box`, so it is a no-op on pages without the WR26 form.
 */
function wr26_enqueue_form_summary() {
    wp_enqueue_script(
        'wr26-form-summary',
        plugins_url('assets/wr26-form-summary.js', __FILE__),
        array('jquery'),
        WR26_VERSION,
        true
    );
    // Source of truth for the recorded balance is GAS; these only drive the
    // on-screen preview / inline Square charge. Keep in sync with the Config sheet.
    wp_add_inline_script('wr26-form-summary', 'window.WR26_FORM_PRICING=' . wp_json_encode(array(
        'earlyPrice'   => floatval(apply_filters('wr26_early_price', 125)),
        'regularPrice' => floatval(apply_filters('wr26_regular_price', 145)),
        'earlyEnd'     => apply_filters('wr26_early_end', '2026-08-14T23:59:59'),
    )) . ';', 'before');
}
add_action('wp_enqueue_scripts', 'wr26_enqueue_form_summary');

/**
 * Canonical seminar catalog for the front-end roster/seminar-card UI. Mirrors
 * tools/seminars-seed.csv (slot keys + titles + presenters) so the cards render
 * immediately; live availability counts are overlaid from getSeminarAvailability
 * via the wr26_seminar_availability AJAX proxy. Filterable so the catalog can be
 * managed without code edits if needed.
 */
function wr26_seminar_catalog() {
    return apply_filters('wr26_seminar_catalog', array(
        array('slot' => 'session_1', 'label' => 'Friday 4:00–5:00 PM', 'picks' => 2, 'seminars' => array(
            array(
                'title' => 'Color Me Golden: Embracing Life in Every Season',
                'speaker' => 'Panel Discussion',
                'description' => "Every season of a woman's life holds unique beauty, but later chapters often bring transitions that feel like winding down. God views this stage not as a time of fading, but as a vibrant season of deep impact and fruitfulness. Come hear real stories of faith and uncover fresh avenues for kingdom purpose while exploring practical ways to turn your life experience into a lasting legacy.",
            ),
            array(
                'title' => 'Refined by Fire, Revealed in Beauty',
                'speaker' => 'Presenter TBD',
                'description' => "Learn how hard seasons shape strength, depth, and resilience — how to walk through trials without losing our faith, and how to find purpose in pain while developing a strength that comes only through surrender to God.",
            ),
        )),
        array('slot' => 'session_2', 'label' => 'Sabbath 2:00–3:15 PM', 'picks' => 2, 'seminars' => array(
            array(
                'title' => 'Repainted by Grace',
                'speaker' => 'Valerie Haveman',
                'description' => "So many women carry the stains of past mistakes — shame, regret, or feeling not enough. But God does not define us by the colors of our past. We'll explore what it means to accept God's forgiveness, stop condemning ourselves, and let His grace repaint our hearts with truth, freedom, and hope.",
            ),
            array(
                'title' => 'Color Me Open',
                'speaker' => 'Mary Kendall',
                'description' => "What does a root canal have to do with church hospitality? More than you'd think. Mary draws from business, home, and church ministry to share what she's learning about what it means to truly see the people around us — our neighbors, our church family, and the stranger in our pew.",
            ),
            array(
                'title' => 'Nourished by Color',
                'speaker' => 'Stephanie Richards',
                'description' => "Simple, evidence-based ways to improve overall health through colorful nutrition, regular movement, and healthy sun exposure. Learn how \"eating the rainbow\" supports immunity, heart, gut health, and energy, and how daily activity and safe sunshine work together for long-term wellness.",
            ),
            array(
                'title' => 'Color Me Prayerful: Discovering the Beautiful Ways We Talk With God',
                'speaker' => 'Shannon Pigsley',
                'description' => "Prayer is an intimate, ongoing conversation with a God who listens, loves, and responds. Discover the many beautiful ways we can talk with our Heavenly Father — from quiet surrender to praying in community — with interactive prayer stations that let you experience different forms of prayer hands-on.",
            ),
        )),
        array('slot' => 'session_3', 'label' => 'Sabbath 4:15–5:30 PM', 'picks' => 2, 'seminars' => array(
            array(
                'title' => 'Shades of Peace',
                'speaker' => 'Melissa Morris',
                'description' => "A practical, encouraging seminar on letting go of anger and resentment while discovering the peace that comes through forgiveness in God. Explore how releasing past hurts can bring healing, restore relationships, and create greater emotional and spiritual freedom.",
            ),
            array(
                'title' => 'Coloring Through the Chaos: Raising Children with Grace and Truth',
                'speaker' => 'Panel Discussion',
                'description' => "Raising children today can feel unpredictable and overwhelming — but God is still at work, both in your child and in you. This season doesn't ask us to control every detail; it asks us to guide, love, and trust God with the outcome.",
            ),
            array(
                'title' => 'Broken Crayons Still Color',
                'speaker' => '',
                'description' => "Domestic violence and alcohol use affect families inside and outside our church. This session is about awareness, growth, and safety — empowering women to be the hands and feet of Jesus in a struggling world. (Matthew 22:37–39)",
            ),
        )),
        array('slot' => 'session_4', 'label' => 'Sunday 8:15–9:15 AM', 'picks' => 1, 'seminars' => array(
            array(
                'title' => 'Brushstrokes of Leadership',
                'speaker' => 'Ami Cook',
                'description' => "God uses ordinary women to create extraordinary ministry. Discover how small acts of faith, kindness, and leadership become beautiful brushstrokes in God's masterpiece, and learn creative ways to build women's ministry in your local church.",
            ),
        )),
    ));
}

/**
 * Enqueue the custom attendee-roster + seminar-card UI. Self-gates on the
 * #wr26-roster mount element so it is a no-op on pages without the WR26 form.
 * Ships as real plugin assets because Fluent Forms strips <script> from Custom
 * HTML fields (same constraint that moved the summary recalc out of the form).
 */
function wr26_enqueue_roster() {
    wp_enqueue_style(
        'wr26-roster',
        plugins_url('assets/wr26-roster.css', __FILE__),
        array(),
        WR26_VERSION
    );
    wp_enqueue_script(
        'wr26-roster',
        plugins_url('assets/wr26-roster.js', __FILE__),
        array('jquery'),
        WR26_VERSION,
        true
    );
    wp_localize_script('wr26-roster', 'WR26_ROSTER', array(
        'ajaxUrl'  => admin_url('admin-ajax.php'),
        'nonce'    => wp_create_nonce('wr26_public_nonce'),
        'catalog'  => wr26_seminar_catalog(),
    ));
}
add_action('wp_enqueue_scripts', 'wr26_enqueue_roster');

/**
 * Public AJAX proxy: returns the seminar availability snapshot (counts only) from
 * GAS. Keeps the GAS secret server-side and caches the result briefly so a busy
 * registration page does not hammer Apps Script. Counts-only payload — never
 * attendee names — so it is safe to expose to logged-out visitors.
 */
function wr26_ajax_seminar_availability() {
    check_ajax_referer('wr26_public_nonce', 'nonce');
    $cached = get_transient('wr26_seminar_availability');
    if (is_array($cached)) {
        wp_send_json($cached);
    }
    $res = wr26_gas_request(array('action' => 'getSeminarAvailability'));
    if (is_array($res) && !empty($res['success'])) {
        set_transient('wr26_seminar_availability', $res, 60);
    }
    wp_send_json(is_array($res) ? $res : array('success' => false, 'message' => 'No response'));
}
add_action('wp_ajax_wr26_seminar_availability', 'wr26_ajax_seminar_availability');
add_action('wp_ajax_nopriv_wr26_seminar_availability', 'wr26_ajax_seminar_availability');
function wr26_admin_header($title,$active){ echo '<div class="wrap"><h1>'.esc_html($title).'</h1><h2 class="nav-tab-wrapper">'; foreach(array('dashboard'=>'Dashboard','registrations'=>'Registrations','waitlist'=>'Waitlist','checkin'=>'Check-In','rosters'=>'Church Rosters','promo'=>'Promo Codes','settings'=>'Settings','gas-tools'=>'GAS Tools') as $slug=>$label){$page='wr26-'.$slug;echo '<a class="nav-tab '.($active===$slug?'nav-tab-active':'').'" href="'.esc_url(admin_url('admin.php?page='.$page)).'">'.esc_html($label).'</a>';} echo '</h2></div>'; }
function wr26_page_dashboard(){
    wr26_admin_header('WR26 Dashboard','dashboard');
    $queue = get_option('wr26_dispatch_queue', array());
    $failed = get_option('wr26_failed_submissions', array());
    $last_dispatch = get_option('wr26_dispatch_last_run', '');
    $pay_failures = get_option('wr26_payment_failures', array());
    echo '<div class="notice notice-info"><p>Lightweight fallback UI for staging/live operations.</p></div>';
    echo '<table class="widefat striped" style="max-width:900px"><tbody>';
    echo '<tr><th>Queue Count</th><td id="wr26-queue-count">'.intval(count($queue)).'</td></tr>';
    echo '<tr><th>Failed Submissions</th><td id="wr26-failed-count">'.intval(count($failed)).'</td></tr>';
    echo '<tr><th>Payment Failures (FF declined)</th><td>'.intval(count($pay_failures)).'</td></tr>';
    echo '<tr><th>Last Dispatch Run</th><td>'.esc_html($last_dispatch ? $last_dispatch : 'Never').'</td></tr>';
    echo '<tr><th>Registered Count Override</th><td>'.esc_html((string) get_option('wr26_registered_count', '')).'</td></tr>';
    echo '<tr><th>Waitlist Count (local cache)</th><td>'.intval(get_option('wr26_waitlist_count', 0)).'</td></tr>';
    echo '</tbody></table>';
    if (!empty($pay_failures)) {
        echo '<h3>Recent Payment Failures</h3><table class="widefat striped" style="max-width:900px"><thead><tr><th>Entry ID</th><th>Failed At</th><th>Charge ID</th><th>Error</th></tr></thead><tbody>';
        foreach (array_reverse(array_slice($pay_failures, -10)) as $pf) {
            echo '<tr><td>'.intval($pf['entry_id']).'</td><td>'.esc_html($pf['failed_at']).'</td><td>'.esc_html($pf['charge_id']).'</td><td>'.esc_html($pf['error']).'</td></tr>';
        }
        echo '</tbody></table>';
    }
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
    if(page==='rosters'){loading();post('getChurchRosters').done(function(r){if(!r||!r.success){err('Unable to load rosters');return;}const rosters=(r.rosters||[]);let html='';(Array.isArray(rosters)?rosters:[]).forEach(function(church){const ch=esc(church&&church.name||'Unknown');const members=Array.isArray(church&&church.members)?church.members:[];html+='<h3>'+ch+'</h3><table class=\"widefat striped\"><thead><tr><th>Name</th><th>Payment</th><th>Checked In</th></tr></thead><tbody>'+(members.map(function(x){return '<tr><td>'+esc((x.firstName||'')+' '+(x.lastName||''))+'</td><td>'+esc(x.paymentStatus)+'</td><td>'+esc(x.checkedIn)+'</td></tr>';}).join('')||'<tr><td colspan=\"3\">No entries.</td></tr>')+'</tbody></table>';});app.html(html||'<p>No rosters found.</p>');}).fail(()=>err('Unable to load rosters'));}
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

add_shortcode('wr_edit_registration', function() {
  $token = sanitize_text_field($_GET['token'] ?? '');

  if (empty($token)) {
    return '<p style="color:#d63638;font-size:1em">'
      . 'No registration token found. '
      . 'Please use the link from your confirmation email.'
      . '</p>';
  }

  wp_enqueue_script('jquery');

  $ajax_url = esc_js(admin_url('admin-ajax.php'));
  $token_js  = esc_js($token);

  return '
<div id="wr26-edit-wrap" style="max-width:640px;'
  . 'margin:0 auto;font-family:sans-serif">

  <div id="wr26-edit-loading"
    style="padding:20px;color:#646970">
    Loading your registration&#8230;
  </div>

  <form id="wr26-edit-form" style="display:none">

    <div style="margin-bottom:20px">
      <strong>Name:</strong>
      <span id="wr26-edit-name"></span>
    </div>

    <p style="color:#646970;font-style:italic;'
  . 'font-size:.9em;margin-bottom:20px">
      Email, payment details, and arrival dates cannot be
      changed here. To update those, please contact us.
    </p>

    <table style="width:100%;border-collapse:collapse;'
  . 'margin-bottom:20px">

      <tr><td style="padding:8px 0;width:220px;'
  . 'font-weight:600;vertical-align:top;'
  . 'padding-right:16px">First Name</td>
        <td style="padding:8px 0">
          <input type="text" name="first_name"
            style="width:100%;padding:8px;'
  . 'border:1px solid #ccd0d4;border-radius:3px;'
  . 'font-size:1em">
        </td></tr>

      <tr><td style="padding:8px 0;font-weight:600;'
  . 'vertical-align:top;padding-right:16px">
        Last Name</td>
        <td style="padding:8px 0">
          <input type="text" name="last_name"
            style="width:100%;padding:8px;'
  . 'border:1px solid #ccd0d4;border-radius:3px;'
  . 'font-size:1em">
        </td></tr>

      <tr><td style="padding:8px 0;font-weight:600;'
  . 'vertical-align:top;padding-right:16px">
        Phone</td>
        <td style="padding:8px 0">
          <input type="tel" name="phone"
            style="width:100%;padding:8px;'
  . 'border:1px solid #ccd0d4;border-radius:3px;'
  . 'font-size:1em">
        </td></tr>

      <tr><td style="padding:8px 0;font-weight:600;'
  . 'vertical-align:top;padding-right:16px">
        Church</td>
        <td style="padding:8px 0">
          <input type="text" name="church"
            style="width:100%;padding:8px;'
  . 'border:1px solid #ccd0d4;border-radius:3px;'
  . 'font-size:1em">
        </td></tr>

      <tr><td style="padding:8px 0;font-weight:600;'
  . 'vertical-align:top;padding-right:16px">
        Dietary Needs</td>
        <td style="padding:8px 0">
          <textarea name="dietary_needs" rows="2"
            style="width:100%;padding:8px;'
  . 'border:1px solid #ccd0d4;border-radius:3px;'
  . 'font-size:1em"></textarea>
        </td></tr>

      <tr><td style="padding:8px 0;font-weight:600;'
  . 'vertical-align:top;padding-right:16px">
        Emergency Contact Name</td>
        <td style="padding:8px 0">
          <input type="text" name="emergency_contact_name"
            style="width:100%;padding:8px;'
  . 'border:1px solid #ccd0d4;border-radius:3px;'
  . 'font-size:1em">
        </td></tr>

      <tr><td style="padding:8px 0;font-weight:600;'
  . 'vertical-align:top;padding-right:16px">
        Emergency Contact Phone</td>
        <td style="padding:8px 0">
          <input type="tel" name="emergency_contact_phone"
            style="width:100%;padding:8px;'
  . 'border:1px solid #ccd0d4;border-radius:3px;'
  . 'font-size:1em">
        </td></tr>

      <tr><td style="padding:8px 0;font-weight:600;'
  . 'vertical-align:top;padding-right:16px">
        Special Needs</td>
        <td style="padding:8px 0">
          <textarea name="special_needs" rows="2"
            style="width:100%;padding:8px;'
  . 'border:1px solid #ccd0d4;border-radius:3px;'
  . 'font-size:1em"></textarea>
        </td></tr>

    </table>

    <p>
      <button type="button" id="wr26-edit-save"
        style="background:#1a7efb;color:#fff;border:none;'
  . 'padding:10px 28px;border-radius:4px;font-size:1em;'
  . 'cursor:pointer;font-weight:600">
        Save Changes
      </button>
      <span id="wr26-edit-status"
        style="margin-left:12px;font-size:.95em"></span>
    </p>

  </form>

  <div id="wr26-edit-success"
    style="display:none;background:#d1e7dd;'
  . 'border-radius:4px;padding:20px;color:#0a3622;'
  . 'font-size:1.05em;margin-top:16px">
    ✅ Your registration has been updated successfully.
    You will receive a confirmation email shortly.
  </div>

</div>

<script>
jQuery(function($) {
  var ajaxUrl = "' . $ajax_url . '";
  var token   = "' . $token_js . '";

  $.post(ajaxUrl, {
    action: "wr26_get_reg_by_token",
    token: token
  }, function(r) {
    if (!r || !r.success || !r.registration) {
      $("#wr26-edit-loading").html(
        "<p style=\"color:#d63638\">"
        + "Could not load your registration. "
        + "Please check your link and try again."
        + "</p>"
      );
      return;
    }
    var reg = r.registration;
    $("#wr26-edit-name").text(
      (reg.firstName || "") + " " + (reg.lastName || "")
    );
    $("[name=\"first_name\"]").val(reg.firstName || "");
    $("[name=\"last_name\"]").val(reg.lastName || "");
    $("[name=\"phone\"]").val(reg.phone || "");
    $("[name=\"church\"]").val(reg.church || "");
    $("[name=\"dietary_needs\"]")
      .val(reg.dietaryNeeds || "");
    $("[name=\"emergency_contact_name\"]")
      .val(reg.emergencyContactName || "");
    $("[name=\"emergency_contact_phone\"]")
      .val(reg.emergencyContactPhone || "");
    $("[name=\"special_needs\"]")
      .val(reg.specialNeeds || "");
    $("#wr26-edit-loading").hide();
    $("#wr26-edit-form").show();
  }).fail(function() {
    $("#wr26-edit-loading").html(
      "<p style=\"color:#d63638\">"
      + "Connection error. Please try again."
      + "</p>"
    );
  });

  $("#wr26-edit-save").on("click", function() {
    var $btn = $(this);
    $btn.prop("disabled", true)
      .text("Saving\u2026");
    $("#wr26-edit-status")
      .text("")
      .css("color", "#646970");
    $.post(ajaxUrl, {
      action: "wr26_save_edit",
      edit_token: token,
      first_name: $("[name=\"first_name\"]").val(),
      last_name: $("[name=\"last_name\"]").val(),
      phone: $("[name=\"phone\"]").val(),
      church: $("[name=\"church\"]").val(),
      dietary_needs: $("[name=\"dietary_needs\"]").val(),
      emergency_contact_name:
        $("[name=\"emergency_contact_name\"]").val(),
      emergency_contact_phone:
        $("[name=\"emergency_contact_phone\"]").val(),
      special_needs: $("[name=\"special_needs\"]").val()
    }, function(r) {
      if (r && r.success) {
        $("#wr26-edit-form").hide();
        $("#wr26-edit-success").show();
        $("html,body").animate(
          { scrollTop:
            $("#wr26-edit-success").offset().top - 80 },
          400
        );
      } else {
        $btn.prop("disabled", false)
          .text("Save Changes");
        $("#wr26-edit-status")
          .text("\u274C " + (r && r.message
            ? r.message : "Save failed. Please try again."))
          .css("color", "#d63638");
      }
    }).fail(function() {
      $btn.prop("disabled", false).text("Save Changes");
      $("#wr26-edit-status")
        .text("\u274C Connection error. Please try again.")
        .css("color", "#d63638");
    });
  });
});
</script>';
});
