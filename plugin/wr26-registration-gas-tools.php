<?php
/**
 * Plugin Name: WR26 Registration GAS Tools
 * Description: Admin tools for editing the WR26 GAS secret and sending a fake WR26 test registration to GAS.
 * Version: 1.0.0
 * Author: IMSDA
 */

if (!defined('ABSPATH')) {
    exit;
}

function wr26_tools_parent_menu_slug() {
    return 'wr26-dashboard';
}

add_action('admin_menu', function () {
    add_submenu_page(
        wr26_tools_parent_menu_slug(),
        'GAS Tools',
        'GAS Tools',
        'manage_options',
        'wr26-gas-tools',
        'wr26_tools_page'
    );
});

function wr26_tools_sanitize_secret($value) {
    return preg_replace('/[^A-Za-z0-9_\-\.]/', '', (string) $value);
}

function wr26_tools_post_to_gas($payload, $timeout = 45) {
    $url = esc_url_raw(get_option('wr26_gas_url', ''));
    if (!$url) {
        return array('success' => false, 'message' => 'Missing WR26 GAS URL in WR26 settings.');
    }

    $payload['secret'] = get_option('wr26_gas_secret', '');
    $payload['site'] = site_url();
    $payload['version'] = defined('WR26_VERSION') ? WR26_VERSION : 'tools-1.0.0';
    $payload['edit_page_url'] = esc_url_raw(get_option('wr26_edit_page_url', site_url('/wr26-edit/')));

    $response = wp_remote_post($url, array(
        'timeout' => intval($timeout),
        'headers' => array('Content-Type' => 'application/json'),
        'body' => wp_json_encode($payload),
    ));

    if (is_wp_error($response)) {
        return array('success' => false, 'message' => $response->get_error_message());
    }

    $code = intval(wp_remote_retrieve_response_code($response));
    $raw_body = wp_remote_retrieve_body($response);
    $body = json_decode($raw_body, true);

    if (!is_array($body)) {
        return array(
            'success' => false,
            'message' => 'GAS returned a non-JSON response.',
            'http_code' => $code,
            'raw_body' => $raw_body,
        );
    }

    $body['_http_code'] = $code;
    return $body;
}

function wr26_tools_fake_registration_payload() {
    $now = current_time('mysql');
    $stamp = gmdate('YmdHis');
    $entry_id = intval(gmdate('His'));

    return array(
        'action' => 'register',
        'entry_id' => $entry_id,
        'form_id' => intval(get_option('wr26_form_id', 0)),
        'first_name' => 'WR26',
        'last_name' => 'GAS Test ' . $stamp,
        'email' => get_option('admin_email'),
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
                'email' => get_option('admin_email'),
                'church' => 'IMSDA Test Church',
                'attendee_type' => 'adult',
                'meal_preference' => 'regular',
                'dietary_needs' => 'None',
                'childcare_needed' => 'no',
                'seminar_preferences' => array(
                    'session_1' => array('pref_1' => 'fri_opt_1', 'pref_2' => 'fri_opt_2'),
                    'session_2' => array('pref_1' => 'sat_2pm_opt_1', 'pref_2' => 'sat_2pm_opt_2'),
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
                    'session_2' => array('pref_1' => 'sat_2pm_opt_2', 'pref_2' => 'sat_2pm_opt_3'),
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
        }

        if ($action === 'regenerate_secret') {
            $secret = wp_generate_password(48, false, false);
            update_option('wr26_gas_secret', $secret, false);
            $notice = array('type' => 'success', 'message' => 'New GAS secret generated. Copy it to the Google Sheet Config tab as SECRET before running the queue.');
        }

        if ($action === 'send_test') {
            $payload = wr26_tools_fake_registration_payload();
            $result = wr26_tools_post_to_gas($payload, 45);
            $notice = !empty($result['success'])
                ? array('type' => 'success', 'message' => 'Fake WR26 test registration sent to GAS successfully. Check Registrations, Attendees, and SeminarPreferences in the Sheet.')
                : array('type' => 'error', 'message' => 'Fake WR26 test registration failed. See response below.');
        }

        if ($action === 'ping_cache') {
            $result = wr26_tools_post_to_gas(array('action' => 'portalGetCacheSnapshot'), 45);
            $notice = !empty($result['success'])
                ? array('type' => 'success', 'message' => 'GAS cache snapshot/ping succeeded.')
                : array('type' => 'error', 'message' => 'GAS cache snapshot/ping failed. See response below.');
        }
    }

    $gas_url = get_option('wr26_gas_url', '');
    $secret = get_option('wr26_gas_secret', '');
    $form_id = get_option('wr26_form_id', '');
    $queue = get_option('wr26_dispatch_queue', array());
    $failed = get_option('wr26_failed_submissions', array());

    echo '<div class="wrap">';
    echo '<h1>WR26 GAS Tools</h1>';

    if ($notice) {
        echo '<div class="notice notice-' . esc_attr($notice['type']) . ' is-dismissible"><p>' . esc_html($notice['message']) . '</p></div>';
    }

    echo '<h2>Connection Summary</h2>';
    echo '<table class="widefat striped" style="max-width:900px"><tbody>';
    echo '<tr><th style="width:220px">GAS URL</th><td>' . ($gas_url ? esc_html($gas_url) : '<strong style="color:#b32d2e">Missing</strong>') . '</td></tr>';
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

    echo '<hr><p><strong>Tip:</strong> After a Pay Later test form submission, go to WR26 → Dashboard and click <strong>Run Queue</strong>. Online Square submissions only queue after Fluent Forms reports payment success.</p>';
    echo '</div>';
}
