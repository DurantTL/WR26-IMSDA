<?php
/**
 * Plugin Name: Camp Meeting 2026 Integration
 * Description: Connects Fluent Forms to Google Apps Script with field mapping debug.
 * Version: 6.4
 * Author: IMC
 *
 * CHANGELOG v6.4:
 * - Fixed test payload action treating GAS 302 response as failure after v6.3 302=success change.
 *
 * CHANGELOG v6.3:
 * - Fixed blocking POST false-failure caused by following GAS 302 redirect to googleusercontent which returns 400 HTML.
 *
 * CHANGELOG v6.2:
 * - Added ACCESS_TOKEN authentication via cm26_gas_token WP option
 *
 * CHANGELOG v6.1:
 * - cm26_build_and_send: added $blocking parameter; blocking=true uses timeout=30, waits for GAS response, returns bool
 * - cm26_fire_to_gas: passes blocking=true to cm26_build_and_send; propagates failure as WP_Error
 * - cm26_options_page_html: added empty cm26_gas_token warning notice
 * - cm26_handle_admin_actions: added resubmit_entry action with nonce check, DB lookup, re-send, and GAS verification
 * - cm26_options_page_html: added resubmit result notices and Manual Resubmit UI box
 * - Failed submissions table: added Action column with per-row resubmit link button
 *
 * CHANGELOG v6.0:
 * - Added dispatch queue architecture for background GAS delivery
 * - Added queue processor cron hook (cm26_dispatch_queue_process)
 * - Added admin queue status and manual "Run Queue Now" action
 * - Added GAS domain allowlist validation before server-side HTTP calls
 *
 * CHANGELOG v5.0:
 * - Added "View Last Submission" debug feature
 * - Flexible field name mapping (tries multiple names)
 * - Better guest list parsing
 * - Fixed nights handling (supports both number and checkbox)
 * - Enhanced meal field detection
 */

if (!defined('ABSPATH')) { exit; }

/**
 * ==================================================
 * PRICING CONSTANTS (Match your Config sheet!)
 * ==================================================
 */
define('CM26_DORM_PRICE', 25);
define('CM26_RV_PRICE', 15);
define('CM26_TENT_PRICE', 5);

define('CM26_ADULT_BREAKFAST', 7);
define('CM26_ADULT_LUNCH', 8);
define('CM26_ADULT_SUPPER', 8);

define('CM26_CHILD_BREAKFAST', 6);
define('CM26_CHILD_LUNCH', 7);
define('CM26_CHILD_SUPPER', 7);

// Meal counts per type
define('CM26_BREAKFAST_DAYS', 4); // Wed, Thu, Fri, Sat
define('CM26_LUNCH_DAYS', 3);     // Wed, Thu, Fri
define('CM26_SUPPER_DAYS', 5);    // Tue, Wed, Thu, Fri, Sat

/**
 * ==================================================
 * HELPER: Get field value from multiple possible names
 * ==================================================
 */
function cm26_get_field($formData, $possibleNames, $default = '') {
    foreach ((array)$possibleNames as $name) {
        // Check direct key
        if (isset($formData[$name]) && $formData[$name] !== '') {
            return $formData[$name];
        }
        // Check with underscores/dashes converted
        $altName = str_replace(['-', ' '], '_', strtolower($name));
        if (isset($formData[$altName]) && $formData[$altName] !== '') {
            return $formData[$altName];
        }
    }
    return $default;
}

/**
 * ==================================================
 * HELPER: Get nested field value
 * ==================================================
 */
function cm26_get_nested($formData, $key, $subkey, $default = '') {
    if (isset($formData[$key]) && is_array($formData[$key]) && isset($formData[$key][$subkey])) {
        return $formData[$key][$subkey];
    }
    return $default;
}

function cm26_offline_values() {
    return ['check', 'cash', 'offline', 'test', 'Offline'];
}

function cm26_is_offline_payment( $formData ) {
    $raw = strtolower( sanitize_text_field(
        cm26_get_field( $formData, ['payment_method', 'pay_method'], '' )
    ));
    return in_array( $raw, ['check', 'cash', 'offline', 'test'], true );
}

function cm26_is_allowed_gas_url($url) {
    $host = wp_parse_url($url, PHP_URL_HOST);
    if (empty($host)) {
        return new WP_Error('cm26_invalid_url', 'Invalid Google Script URL.');
    }

    $allowedHosts = [
        'script.google.com',
        'script.googleusercontent.com',
        'accounts.google.com',
    ];

    if (!in_array(strtolower($host), $allowedHosts, true)) {
        return new WP_Error('cm26_disallowed_host', 'Disallowed host for GAS request: ' . $host);
    }

    return true;
}

function cm26_get_gas_url($params = []) {
    $scriptUrl = trim(get_option('cm26_google_script_url'));
    $token = trim(get_option('cm26_gas_token'));
    if (!empty($token)) {
        $params['token'] = $token;
    }
    return add_query_arg($params, $scriptUrl);
}

/**
 * ==================================================
 * 1. ADMIN SETTINGS PAGE
 * ==================================================
 */
add_action('admin_menu', 'cm26_add_admin_menu');
function cm26_add_admin_menu() {
    add_menu_page(
        'Camp Meeting Settings', 
        'Camp Meeting', 
        'manage_options', 
        'cm26-settings', 
        'cm26_options_page_html', 
        'dashicons-calendar-alt', 
        60
    );
}

add_action('admin_init', 'cm26_settings_init');
function cm26_settings_init() {
    register_setting('cm26_plugin_options', 'cm26_google_script_url');
    register_setting('cm26_plugin_options', 'cm26_form_id');
    register_setting('cm26_plugin_options', 'cm26_debug_mode');
    register_setting('cm26_plugin_options', 'cm26_gas_token');

    add_settings_section('cm26_plugin_main', 'Connection Settings', 'cm26_section_text', 'cm26-settings');
    add_settings_field('cm26_google_script_url', 'Google Apps Script Web App URL', 'cm26_setting_url_render', 'cm26-settings', 'cm26_plugin_main');
    add_settings_field('cm26_form_id', 'Fluent Form ID', 'cm26_setting_id_render', 'cm26-settings', 'cm26_plugin_main');
    add_settings_field('cm26_debug_mode', 'Debug Mode', 'cm26_setting_debug_render', 'cm26-settings', 'cm26_plugin_main');
    add_settings_field('cm26_gas_token', 'Google Apps Script Access Token', 'cm26_setting_token_render', 'cm26-settings', 'cm26_plugin_main');
}

add_filter('cron_schedules', 'cm26_add_cron_schedules');
function cm26_add_cron_schedules($schedules) {
    if (!isset($schedules['cm26_every_5_minutes'])) {
        $schedules['cm26_every_5_minutes'] = [
            'interval' => 300,
            'display'  => __('Every 5 Minutes (CM26)')
        ];
    }
    return $schedules;
}

add_action('init', 'cm26_register_dispatch_queue_cron');
function cm26_register_dispatch_queue_cron() {
    if (!wp_next_scheduled('cm26_dispatch_queue_process')) {
        wp_schedule_event(time() + 300, 'cm26_every_5_minutes', 'cm26_dispatch_queue_process');
    }
}

add_action('cm26_dispatch_queue_process', 'cm26_process_dispatch_queue');

function cm26_section_text() { 
    echo '<p>Enter your Google Apps Script Web App URL and the ID of the Fluent Form.</p>'; 
}

function cm26_setting_url_render() { 
    $val = get_option('cm26_google_script_url'); 
    echo "<input name='cm26_google_script_url' size='80' type='text' value='" . esc_attr($val) . "' />";
    echo "<p class='description'>The deployed Web App URL (must end in /exec).</p>";
}

function cm26_setting_id_render() { 
    $val = get_option('cm26_form_id'); 
    echo "<input name='cm26_form_id' size='10' type='number' value='" . esc_attr($val) . "' />";
    echo "<p class='description'>Find this in Fluent Forms → Your Form → Settings</p>";
}

function cm26_setting_debug_render() {
    $val = get_option('cm26_debug_mode');
    echo "<label><input name='cm26_debug_mode' type='checkbox' value='1' " . checked(1, $val, false) . " /> ";
    echo "Enable debug mode (saves raw form data for inspection)</label>";
    echo "<p class='description'>Turn this ON, submit a test form, then check 'Last Submission Data' below.</p>";
}

function cm26_setting_token_render() {
    $val = get_option('cm26_gas_token');
    echo "<input name='cm26_gas_token' size='80' type='text' value='" . esc_attr($val) . "' />";
    echo "<p class='description'>Must match ACCESS_TOKEN in Google Apps Script Script Properties.</p>";
}

/**
 * Handle admin actions
 */
add_action('admin_init', 'cm26_handle_admin_actions');
function cm26_handle_admin_actions() {
    if (!isset($_GET['page']) || $_GET['page'] !== 'cm26-settings') {
        return;
    }
    
    if (!current_user_can('manage_options')) {
        return;
    }
    
    // Handle clear debug data action
    if (isset($_GET['action']) && $_GET['action'] === 'clear_debug') {
        if (!isset($_GET['_wpnonce']) || !wp_verify_nonce($_GET['_wpnonce'], 'cm26_clear_debug')) {
            wp_die('Security check failed');
        }
        delete_option('cm26_last_submission_raw');
        delete_option('cm26_last_submission_mapped');
        wp_redirect(add_query_arg(['page' => 'cm26-settings', 'debug_cleared' => '1'], admin_url('admin.php')));
        exit;
    }
    
    // Handle retry action
    if (isset($_GET['action']) && $_GET['action'] === 'retry') {
        if (!isset($_GET['_wpnonce']) || !wp_verify_nonce($_GET['_wpnonce'], 'cm26_retry_action')) {
            wp_die('Security check failed');
        }
        
        $result = cm26_process_failed_submissions_manual(true);
        
        wp_redirect(add_query_arg([
            'page' => 'cm26-settings',
            'retry_result' => $result['success'] ? 'success' : 'partial',
            'retry_processed' => $result['processed'],
            'retry_succeeded' => $result['succeeded'],
            'retry_failed' => $result['failed']
        ], admin_url('admin.php')));
        exit;
    }
    
    // Handle clear failed action
    if (isset($_GET['action']) && $_GET['action'] === 'clear_failed') {
        if (!isset($_GET['_wpnonce']) || !wp_verify_nonce($_GET['_wpnonce'], 'cm26_clear_action')) {
            wp_die('Security check failed');
        }
        
        delete_option('cm26_failed_submissions');
        
        wp_redirect(add_query_arg(['page' => 'cm26-settings', 'cleared' => '1'], admin_url('admin.php')));
        exit;
    }
    
    // Handle test payload action
    if (isset($_GET['action']) && $_GET['action'] === 'test_payload') {
        if (!isset($_GET['_wpnonce']) || !wp_verify_nonce($_GET['_wpnonce'], 'cm26_test_action')) {
            wp_die('Security check failed');
        }
        
        $scriptUrl = trim(get_option('cm26_google_script_url'));
        
        $payload = [
            'action' => 'submitRegistration',
            'regType' => 'TEST_SIMULATION',
            'entryId' => 'TEST-' . time(),
            'name' => 'WP System Test',
            'email' => get_option('admin_email'),
            'phone' => '555-0000',
            'addressStreet' => '123 Test Lane',
            'addressCity'   => 'Testville',
            'addressState'  => 'TS',
            'addressZip'    => '12345',
            'church'        => 'Test Church',
            'housingOption' => 'tent',
            'nights' => 'Fri,Sat',
            'numNights' => 2,
            'adultsCount'   => 1,
            'childrenCount' => 0,
            'guests' => [['name' => 'WP System Test', 'age' => 99, 'isChild' => false]],
            'mealSelections' => [
                'breakfast' => ['adult' => 0, 'child' => 0],
                'lunch' => ['adult' => 0, 'child' => 0],
                'supper' => ['adult' => 0, 'child' => 0],
            ],
            'dietaryNeeds' => 'None',
            'specialNeeds' => 'Connection test from WordPress admin.',
            'specialRequests' => 'Test special request — admin approval needed',
            'housingSubtotal' => 0,
            'mealSubtotal'    => 0,
            'subtotal'        => 0,
            'processingFee'   => 0,
            'totalCharged'  => 0,
            'paymentStatus' => 'test',
            'paymentMethod' => 'system_test',
            'transactionId' => 'TEST-' . uniqid(),
            'submittedAt' => current_time('c')
        ];
        $payload['token'] = trim(get_option('cm26_gas_token'));

        $allowed = cm26_is_allowed_gas_url($scriptUrl);
        if (is_wp_error($allowed)) {
            set_transient('cm26_test_result', [
                'success' => false,
                'message' => 'URL validation failed: ' . $allowed->get_error_message()
            ], 300);
            wp_redirect(add_query_arg(['page' => 'cm26-settings', 'test_done' => '1'], admin_url('admin.php')));
            exit;
        }

        $response = wp_remote_post(cm26_get_gas_url(), [
            'method'    => 'POST',
            'body'      => json_encode($payload),
            'timeout'   => 45,
            'redirection' => 0,
            'headers'   => ['Content-Type' => 'application/json'],
            'blocking'  => true
        ]);

        $resultData = [];
        
        if (is_wp_error($response)) {
            $resultData['success'] = false;
            $resultData['message'] = 'WP Error: ' . $response->get_error_message();
        } else {
            $rawBody = wp_remote_retrieve_body($response);
            $httpCode = wp_remote_retrieve_response_code($response);
            
            if ($httpCode == 302) {
                $resultData['success'] = true;
                $resultData['http_code'] = $httpCode;
                $resultData['message'] = 'Success! GAS accepted the submission (302 after doPost).';
                set_transient('cm26_test_result', $resultData, 300);
                wp_redirect(add_query_arg(['page' => 'cm26-settings', 'test_done' => '1'], admin_url('admin.php')));
                exit;
            }

            $resultData['http_code'] = $httpCode;
            $resultData['raw'] = $rawBody;
            
            if (strpos($rawBody, '<!DOCTYPE html>') !== false) {
                $resultData['success'] = false;
                $resultData['message'] = 'Received HTML instead of JSON. Ensure Web App is deployed as "Anyone".';
            } else {
                $json = json_decode($rawBody, true);
                if ($json && (!empty($json['success']) || (isset($json['result']) && $json['result'] === 'success'))) {
                    $resultData['success'] = true;
                    $resultData['message'] = 'Success! Google Script accepted the data.';
                } else {
                    $resultData['success'] = false;
                    $resultData['message'] = 'Script returned error: ' . ($json['error'] ?? 'Unknown');
                }
            }
        }
        
        set_transient('cm26_test_result', $resultData, 300);
        
        wp_redirect(add_query_arg(['page' => 'cm26-settings', 'test_done' => '1'], admin_url('admin.php')));
        exit;
    }

    // Handle run queue action
    if (isset($_GET['action']) && $_GET['action'] === 'run_queue') {
        if (!isset($_GET['_wpnonce']) || !wp_verify_nonce($_GET['_wpnonce'], 'cm26_run_queue_action')) {
            wp_die('Security check failed');
        }

        cm26_process_dispatch_queue();
        wp_redirect(add_query_arg(['page' => 'cm26-settings', 'queue_ran' => '1'], admin_url('admin.php')));
        exit;
    }

    // Handle resubmit_entry action
    if (isset($_GET['action']) && $_GET['action'] === 'resubmit_entry') {
        if (!isset($_GET['_wpnonce']) || !wp_verify_nonce($_GET['_wpnonce'], 'cm26_resubmit_entry')) {
            wp_die('Security check failed');
        }

        $entryId = intval($_GET['entry_id'] ?? 0);
        if ($entryId <= 0) {
            wp_redirect(add_query_arg(['page' => 'cm26-settings', 'resubmit_result' => 'bad_id'], admin_url('admin.php')));
            exit;
        }

        $submission = wpFluent()->table('fluentform_submissions')->where('id', $entryId)->first();
        if (!$submission) {
            wp_redirect(add_query_arg(['page' => 'cm26-settings', 'resubmit_result' => 'not_found', 'resubmit_id' => $entryId], admin_url('admin.php')));
            exit;
        }

        $formData = is_string($submission->response)
            ? json_decode($submission->response, true)
            : (array) $submission->response;
        if (!is_array($formData)) {
            wp_redirect(add_query_arg(['page' => 'cm26-settings', 'resubmit_result' => 'not_found', 'resubmit_id' => $entryId], admin_url('admin.php')));
            exit;
        }

        $paymentStatus = cm26_is_offline_payment($formData) ? 'pending' : 'paid';

        // Clear dispatched record so the send is not blocked
        $dispatched = get_option('cm26_dispatched_entries', []);
        update_option('cm26_dispatched_entries', array_values(array_filter($dispatched, function($id) use ($entryId) {
            return intval($id) !== $entryId;
        })));

        // Clear failed record so the entry can be cleanly re-queued on failure
        $failedList = get_option('cm26_failed_submissions', []);
        update_option('cm26_failed_submissions', array_values(array_filter($failedList, function($item) use ($entryId) {
            return intval($item['entry_id'] ?? 0) !== $entryId;
        })));

        $scriptUrl = trim(get_option('cm26_google_script_url'));
        $debugMode  = get_option('cm26_debug_mode');

        cm26_build_and_send($entryId, $formData, $paymentStatus, $scriptUrl, $debugMode, true);

        sleep(2);

        // Verify GAS received it
        $resubmitResult = 'fired';
        $resubmitReg    = '';

        $verifyUrl = add_query_arg(['action' => 'getRegistration', 'id' => 'FF-' . $entryId], $scriptUrl);
        $verifyResponse = wp_remote_get($verifyUrl, ['timeout' => 15, 'redirection' => 5]);
        if (!is_wp_error($verifyResponse)) {
            $verifyBody = json_decode(wp_remote_retrieve_body($verifyResponse), true);
            if ($verifyBody && !empty($verifyBody['success']) && !empty($verifyBody['registration'])) {
                $resubmitResult = 'success';
                $resubmitReg    = $verifyBody['registration']['regId'] ?? '';
            }
        }

        wp_redirect(add_query_arg([
            'page'            => 'cm26-settings',
            'resubmit_result' => $resubmitResult,
            'resubmit_id'     => $entryId,
            'resubmit_reg'    => $resubmitReg,
        ], admin_url('admin.php')));
        exit;
    }
}

function cm26_options_page_html() {
    if (empty(trim(get_option('cm26_gas_token')))) {
        echo '<div class="notice notice-warning"><p><strong>CM26:</strong> The GAS security token (<code>cm26_gas_token</code>) is not configured. Requests to Google Apps Script may be rejected.</p></div>';
    }
    $failed = get_option('cm26_failed_submissions', []);
    $failedCount = count($failed);
    $dispatchQueue = get_option('cm26_dispatch_queue', []);
    $queueCount = count($dispatchQueue);
    $lastQueueRun = get_option('cm26_dispatch_last_run');
    $lastRaw = get_option('cm26_last_submission_raw');
    $lastMapped = get_option('cm26_last_submission_mapped');
    ?>
    <div class="wrap">
        <h1>Camp Meeting 2026 Settings</h1>
        
        <?php
        // Resubmit result notices
        if (isset($_GET['resubmit_result'])) {
            $rResult = sanitize_text_field($_GET['resubmit_result']);
            $rId     = intval($_GET['resubmit_id'] ?? 0);
            $rReg    = sanitize_text_field($_GET['resubmit_reg'] ?? '');
            if ($rResult === 'success') {
                echo '<div class="notice notice-success"><p><strong>Resubmit succeeded.</strong> Entry ' . $rId . ' was accepted by GAS'
                    . ($rReg ? ' — Registration ID: <strong>' . esc_html($rReg) . '</strong>' : '') . '.</p></div>';
            } elseif ($rResult === 'fired') {
                echo '<div class="notice notice-warning"><p><strong>Resubmit fired</strong> for entry ' . $rId . ', but GAS verification did not confirm receipt. The entry may still process — check GAS logs.</p></div>';
            } elseif ($rResult === 'not_found') {
                echo '<div class="notice notice-error"><p><strong>Resubmit failed:</strong> Entry ' . $rId . ' was not found in Fluent Forms submissions.</p></div>';
            } elseif ($rResult === 'bad_id') {
                echo '<div class="notice notice-error"><p><strong>Resubmit failed:</strong> Invalid entry ID supplied.</p></div>';
            }
        }

        // Show messages
        if (isset($_GET['retry_result'])) {
            $processed = intval($_GET['retry_processed'] ?? 0);
            $succeeded = intval($_GET['retry_succeeded'] ?? 0);
            $failed_count = intval($_GET['retry_failed'] ?? 0);
            echo '<div class="notice notice-' . ($_GET['retry_result'] === 'success' ? 'success' : 'warning') . '"><p>';
            echo "Retry: Processed {$processed}, Succeeded: {$succeeded}, Failed: {$failed_count}";
            echo '</p></div>';
        }
        
        if (isset($_GET['cleared'])) {
            echo '<div class="notice notice-success"><p>Failed submissions cleared.</p></div>';
        }
        
        if (isset($_GET['debug_cleared'])) {
            echo '<div class="notice notice-success"><p>Debug data cleared.</p></div>';
        }

        if (isset($_GET['queue_ran'])) {
            echo '<div class="notice notice-success"><p>Dispatch queue processed.</p></div>';
        }
        
        // Test result
        if (isset($_GET['test_done'])) {
            $testResult = get_transient('cm26_test_result');
            delete_transient('cm26_test_result');
            
            if ($testResult) {
                $class = $testResult['success'] ? 'notice-success' : 'notice-error';
                echo '<div class="notice ' . $class . '" style="padding:15px;">';
                echo '<h3>Test: ' . ($testResult['success'] ? 'Passed ✅' : 'Failed ❌') . '</h3>';
                echo '<p>' . esc_html($testResult['message']) . '</p>';
                if (!empty($testResult['raw'])) {
                    echo '<details><summary>Raw Response</summary><pre>' . esc_html($testResult['raw']) . '</pre></details>';
                }
                echo '</div>';
            }
        }
        ?>
        
        <!-- Debug: Last Submission Data -->
        <?php if ($lastRaw): ?>
        <div class="notice notice-info" style="padding: 15px;">
            <h3 style="margin-top: 0;">🔍 Last Submission Data (Debug)</h3>
            <p><strong>This shows exactly what Fluent Forms sent.</strong> Use this to verify field names match.</p>
            
            <details open>
                <summary><strong>📥 Raw Form Data (from Fluent Forms)</strong></summary>
                <pre style="background:#f0f0f1; padding:15px; overflow:auto; max-height:400px; font-size:12px;"><?php 
                    echo esc_html(print_r(json_decode($lastRaw, true), true)); 
                ?></pre>
            </details>
            
            <?php if ($lastMapped): ?>
            <details>
                <summary><strong>📤 Mapped Payload (sent to Google)</strong></summary>
                <pre style="background:#f0f0f1; padding:15px; overflow:auto; max-height:400px; font-size:12px;"><?php 
                    echo esc_html(print_r(json_decode($lastMapped, true), true)); 
                ?></pre>
            </details>
            <?php endif; ?>
            
            <p>
                <a href="<?php echo wp_nonce_url(admin_url('admin.php?page=cm26-settings&action=clear_debug'), 'cm26_clear_debug'); ?>" 
                   class="button">Clear Debug Data</a>
            </p>
        </div>
        <?php endif; ?>

        <div class="notice notice-info" style="padding: 15px;">
            <h3 style="margin-top: 0;">📬 Dispatch Queue</h3>
            <p><strong>Items in queue:</strong> <?php echo intval($queueCount); ?></p>
            <p><strong>Last queue run:</strong> <?php echo $lastQueueRun ? esc_html(date_i18n('Y-m-d H:i:s', intval($lastQueueRun))) : 'Never'; ?></p>
            <p>
                <a href="<?php echo wp_nonce_url(admin_url('admin.php?page=cm26-settings&action=run_queue'), 'cm26_run_queue_action'); ?>"
                   class="button button-secondary">▶️ Run Queue Now</a>
            </p>
        </div>
        
        <!-- Manual Resubmit -->
        <div class="notice notice-info" style="padding: 15px;">
            <h3 style="margin-top: 0;">🔁 Manual Resubmit</h3>
            <p>Force a Fluent Forms entry to be resent to Google Apps Script immediately. The entry is looked up directly from the database, any prior dispatch or failure record is cleared, and the submission is sent blocking. A GAS verification check runs 2 seconds after the send.</p>
            <form method="get" action="<?php echo esc_url(admin_url('admin.php')); ?>">
                <input type="hidden" name="page" value="cm26-settings">
                <input type="hidden" name="action" value="resubmit_entry">
                <input type="hidden" name="_wpnonce" value="<?php echo esc_attr(wp_create_nonce('cm26_resubmit_entry')); ?>">
                <label for="cm26-resubmit-entry-id"><strong>Fluent Forms Entry ID:</strong></label>
                <input type="number" id="cm26-resubmit-entry-id" name="entry_id" min="1" style="width:120px; margin: 0 8px;" required>
                <button type="submit" class="button button-secondary">Resubmit Entry</button>
            </form>
        </div>

        <!-- Failed Submissions -->
        <?php if ($failedCount > 0): ?>
        <div class="notice notice-warning" style="padding: 15px;">
            <h3 style="margin-top: 0;">⚠️ <?php echo $failedCount; ?> Pending Submission(s)</h3>
            <table class="widefat" style="margin: 10px 0;">
                <thead>
                    <tr><th>Entry ID</th><th>Name</th><th>Email</th><th>Attempts</th><th>Last Error</th><th>Action</th></tr>
                </thead>
                <tbody>
                    <?php foreach ($failed as $item): ?>
                    <tr>
                        <td><?php echo esc_html($item['entry_id']); ?></td>
                        <td><?php echo esc_html($item['payload']['name'] ?? 'Unknown'); ?></td>
                        <td><?php echo esc_html($item['payload']['email'] ?? 'Unknown'); ?></td>
                        <td><?php echo esc_html($item['attempts']); ?></td>
                        <td style="color:#d63638;"><?php echo esc_html($item['last_error'] ?? 'Unknown'); ?></td>
                        <td><a href="<?php echo esc_url(wp_nonce_url(admin_url('admin.php?page=cm26-settings&action=resubmit_entry&entry_id=' . intval($item['entry_id'])), 'cm26_resubmit_entry')); ?>" class="button button-small">Resubmit</a></td>
                    </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
            <p>
                <a href="<?php echo wp_nonce_url(admin_url('admin.php?page=cm26-settings&action=retry'), 'cm26_retry_action'); ?>" 
                   class="button button-primary">🔄 Retry Now</a>
                <a href="<?php echo wp_nonce_url(admin_url('admin.php?page=cm26-settings&action=clear_failed'), 'cm26_clear_action'); ?>" 
                   class="button" onclick="return confirm('Delete these from retry queue?');">🗑️ Discard</a>
            </p>
        </div>
        <?php endif; ?>
        
        <!-- Settings Form -->
        <form action="options.php" method="post">
            <?php
            settings_fields('cm26_plugin_options');
            do_settings_sections('cm26-settings');
            submit_button();
            ?>
        </form>
        
        <hr>
        <h2>Testing</h2>
        <p>
            <button type="button" class="button" id="cm26-test-btn">Test Ping (Browser)</button>
            <span id="cm26-test-result" style="margin-left: 10px;"></span>
        </p>
        <p>
            <a href="<?php echo wp_nonce_url(admin_url('admin.php?page=cm26-settings&action=test_payload'), 'cm26_test_action'); ?>" 
               class="button button-secondary">🚀 Simulate Full Submission</a>
        </p>
        
        <script>
        document.getElementById('cm26-test-btn').addEventListener('click', function() {
            var url = document.querySelector('input[name="cm26_google_script_url"]').value;
            var resultEl = document.getElementById('cm26-test-result');
            if (!url) { resultEl.innerHTML = '<span style="color:red;">Enter URL first</span>'; return; }
            resultEl.innerHTML = '<span style="color:#666;">Testing...</span>';
            fetch(url + '?action=ping')
                .then(r => r.json())
                .then(data => {
                    resultEl.innerHTML = data.success 
                        ? '<span style="color:green;">✅ Connected!</span>' 
                        : '<span style="color:red;">❌ ' + (data.error || 'Failed') + '</span>';
                })
                .catch(e => { resultEl.innerHTML = '<span style="color:red;">❌ ' + e.message + '</span>'; });
        });
        </script>
    </div>
    <?php
}

/**
 * ==================================================
 * 2. FLUENT FORMS SUBMISSION HANDLER
 * ==================================================
 */
add_action('fluentform/submission_inserted', 'cm26_send_to_google', 10, 3);

function cm26_send_to_google($entryId, $formData, $form) {
    $targetFormId = get_option('cm26_form_id');
    $scriptUrl = trim(get_option('cm26_google_script_url'));
    $debugMode = get_option('cm26_debug_mode');

    if (empty($targetFormId) || empty($scriptUrl)) {
        return;
    }
    
    if ($form->id != $targetFormId) {
        return;
    }

    // Only fire immediately for offline/check payments.
    // Square payments are normally handled by the payment_paid hooks below,
    // EXCEPT when the custom payment amount is empty/zero — in that case
    // Fluent Forms never actually charges Square, so no payment_paid hook
    // will fire. Without this fallback the submission is silently dropped.
    if ( ! cm26_is_offline_payment( $formData ) ) {
        $customAmount = cm26_get_field( $formData, [
            'custom_payment_amount', 'payment_amount', 'total_charged', 'total_payment'
        ], '' );
        if ( is_array( $customAmount ) ) {
            $customAmount = '';
        }
        $customAmount = trim( (string) $customAmount );
        if ( $customAmount !== '' && floatval( $customAmount ) > 0 ) {
            // Payment will fire — wait for the payment_paid hook.
            return;
        }
        error_log( 'CM26 Send: Square submission with empty custom_payment_amount (entry ' . $entryId . '); dispatching immediately to avoid silent drop.' );
    }

    // Save raw form data for debugging
    if ($debugMode) {
        update_option('cm26_last_submission_raw', json_encode($formData, JSON_PRETTY_PRINT));
    }

    cm26_queue_entry($entryId);
}

// FF5 payment hooks
add_action( 'fluentform_payment_paid',           'cm26_handle_payment_paid', 20, 10 );
add_action( 'fluentform_payment_status_to_paid', 'cm26_handle_payment_paid', 20, 10 );

function cm26_handle_payment_paid( ...$args ) {
    $targetFormId = get_option( 'cm26_form_id' );
    $scriptUrl    = trim( get_option( 'cm26_google_script_url' ) );
    if ( empty( $targetFormId ) || empty( $scriptUrl ) ) return;

    // Resolve submission and form ID from variadic args
    $submission = null;
    $formId     = 0;
    foreach ( $args as $arg ) {
        if ( is_object( $arg ) && isset( $arg->form_id ) ) {
            $submission = $arg;
            $formId     = (int) $arg->form_id;
            break;
        }
        if ( is_array( $arg ) && isset( $arg['form_id'] ) ) {
            $formId = (int) $arg['form_id'];
            break;
        }
    }
    if ( $formId !== (int) $targetFormId ) return;

    $entryId = 0;
    foreach ( $args as $arg ) {
        if ( is_object( $arg ) && isset( $arg->id ) ) {
            $entryId = (int) $arg->id;
            break;
        }
        if ( is_numeric( $arg ) && (int) $arg > 0 ) {
            $entryId = (int) $arg;
            break;
        }
    }
    if ( $entryId <= 0 ) return;

    cm26_queue_entry($entryId);
}

// FF6 slash-namespaced hooks
add_action( 'fluentform/payment_paid',                'cm26_handle_ff6_payment_paid',   20, 2 );
add_action( 'fluentform/after_payment_status_change', 'cm26_handle_ff6_status_change',   20, 2 );

function cm26_handle_ff6_payment_paid( $submission, $transaction ) {
    $targetFormId = (int) get_option( 'cm26_form_id' );
    if ( is_object( $submission ) ) $submission = get_object_vars( $submission );
    $formId  = (int) ( $submission['form_id'] ?? 0 );
    $entryId = (int) ( $submission['id']      ?? 0 );
    if ( $formId !== $targetFormId || $entryId <= 0 ) return;
    cm26_queue_entry($entryId);
}

function cm26_handle_ff6_status_change( $newStatus, $submission ) {
    if ( strtolower( (string) $newStatus ) !== 'paid' ) return;
    $targetFormId = (int) get_option( 'cm26_form_id' );
    if ( is_object( $submission ) ) $submission = get_object_vars( $submission );
    $formId  = (int) ( $submission['form_id'] ?? 0 );
    $entryId = (int) ( $submission['id']      ?? 0 );
    if ( $formId !== $targetFormId || $entryId <= 0 ) return;
    cm26_queue_entry($entryId);
}

function cm26_fire_to_gas( $entryId ) {
    $scriptUrl = trim( get_option( 'cm26_google_script_url' ) );
    $debugMode = get_option( 'cm26_debug_mode' );
    if ( empty( $scriptUrl ) ) {
        return new WP_Error('cm26_missing_script_url', 'Missing Google Script URL.');
    }

    $allowed = cm26_is_allowed_gas_url($scriptUrl);
    if (is_wp_error($allowed)) {
        return $allowed;
    }

    $submission = wpFluent()->table('fluentform_submissions')
        ->where('id', $entryId)->first();
    if ( ! $submission ) {
        return new WP_Error('cm26_missing_submission', 'Submission not found for entry ' . $entryId);
    }

    $formData = is_string( $submission->response )
        ? json_decode( $submission->response, true )
        : (array) $submission->response;
    if ( ! is_array( $formData ) ) {
        return new WP_Error('cm26_invalid_submission', 'Submission response is not valid JSON for entry ' . $entryId);
    }

    if ( $debugMode ) {
        update_option( 'cm26_last_submission_raw', json_encode( $formData, JSON_PRETTY_PRINT ) );
    }

    $paymentStatus = cm26_is_offline_payment($formData) ? 'pending' : 'paid';

    $result = cm26_build_and_send( $entryId, $formData, $paymentStatus, $scriptUrl, $debugMode, true );
    return ($result === false)
        ? new WP_Error('cm26_send_failed', 'GAS rejected submission for entry ' . $entryId)
        : true;
}

function cm26_queue_entry($entryId) {
    $entryId = intval($entryId);
    if ($entryId <= 0) {
        return;
    }

    // Prevent re-queue if already successfully dispatched
    $dispatched = get_option('cm26_dispatched_entries', []);
    if (in_array($entryId, $dispatched, true)) {
        error_log('CM26 Queue: entry ' . $entryId . ' already dispatched, skipping.');
        return;
    }

    $queue = get_option('cm26_dispatch_queue', []);
    foreach ($queue as $item) {
        if (intval($item['entry_id'] ?? 0) === $entryId) {
            return;
        }
    }

    $queue[] = [
        'entry_id'   => $entryId,
        'queued_at'  => time(),
        'attempts'   => 0,
    ];
    update_option('cm26_dispatch_queue', $queue);

    if (!wp_next_scheduled('cm26_dispatch_queue_process')) {
        wp_schedule_single_event(time() + 30, 'cm26_dispatch_queue_process');
    }

    error_log('CM26 Queue: entry ' . $entryId . ' queued for dispatch.');
}

function cm26_process_dispatch_queue() {
    $queue = get_option('cm26_dispatch_queue', []);
    $remaining = [];
    $maxAttempts = 5;

    update_option('cm26_dispatch_last_run', time());

    if (empty($queue)) {
        return;
    }

    foreach ($queue as $item) {
        $entryId = intval($item['entry_id'] ?? 0);
        $attempts = intval($item['attempts'] ?? 0);

        if ($entryId <= 0) {
            continue;
        }

        $result = cm26_fire_to_gas($entryId);
        if (!is_wp_error($result)) {
            // Mark as successfully dispatched to prevent duplicate sends
            $dispatched = get_option('cm26_dispatched_entries', []);
            $dispatched[] = $entryId;
            update_option('cm26_dispatched_entries', array_slice($dispatched, -500));
            continue;
        }

        $attempts++;
        if ($attempts >= $maxAttempts) {
            $errorMsg = $result->get_error_message();
            error_log('CM26 Queue: max attempts reached for entry ' . $entryId . '. Error: ' . $errorMsg);

            $submission = wpFluent()->table('fluentform_submissions')->where('id', $entryId)->first();
            $formData = [];
            if ($submission && isset($submission->response)) {
                $formData = is_string($submission->response)
                    ? json_decode($submission->response, true)
                    : (array) $submission->response;
            }
            if (!is_array($formData)) {
                $formData = [];
            }

            cm26_queue_failed_submission($formData, $entryId, 'Dispatch queue max attempts reached: ' . $errorMsg);
            wp_mail(get_option('admin_email'), 'CM26 Queue Failure', 'Entry ' . $entryId . ' failed queue dispatch after ' . $maxAttempts . ' attempts. Error: ' . $errorMsg);
            continue;
        }

        $item['attempts'] = $attempts;
        $remaining[] = $item;
    }

    update_option('cm26_dispatch_queue', $remaining);

    if (!empty($remaining)) {
        wp_schedule_single_event(time() + 300, 'cm26_dispatch_queue_process');
    }
}

function cm26_build_and_send( $entryId, $formData, $paymentStatus, $scriptUrl, $debugMode, $blocking = false ) {

    // =============================================
    // 1. GET PAYMENT INFO
    // =============================================
    // totalCharged is computed after section 8 once all mapped values are available

    $firstName = cm26_get_nested($formData, 'names', 'first_name', '');
    $lastName  = cm26_get_nested($formData, 'names', 'last_name', '');
    $fullName  = trim($firstName . ' ' . $lastName);

    if (empty($fullName)) {
        $fullName = sanitize_text_field(cm26_get_field($formData, ['name', 'full_name', 'registrant_name'], 'Unknown'));
    }

    // =============================================
    // 2. PARSE GUEST DETAILS (flexible field names)
    // =============================================
    $guests = [];
    
    // Try multiple possible field names for guest list
    $guestListNames = ['guest_details', 'guest_list', 'guests', 'family_members', 'attendees'];
    $guestData = null;
    
    foreach ($guestListNames as $fieldName) {
        if (!empty($formData[$fieldName]) && is_array($formData[$fieldName])) {
            $guestData = $formData[$fieldName];
            break;
        }
    }
    
    if ($guestData) {
        foreach ($guestData as $guest) {
            $name = '';
            $age = 30;

            // Check if it's a numeric array (Fluent Forms repeater format)
            // [0] = name, [1] = age
            if (isset($guest[0]) && is_string($guest[0])) {
                $name = sanitize_text_field($guest[0]);
                $age = (isset($guest[1]) && $guest[1] !== '') ? intval($guest[1]) : 30;
            } else {
                // Try named keys as fallback
                foreach (['guest_name', 'name', 'Name', 'full_name', 'fullname'] as $nameField) {
                    if (!empty($guest[$nameField])) {
                        $name = sanitize_text_field($guest[$nameField]);
                        break;
                    }
                }
                
                foreach (['age', 'Age', 'guest_age'] as $ageField) {
                    if (isset($guest[$ageField]) && $guest[$ageField] !== '') {
                        $age = intval($guest[$ageField]);
                        break;
                    }
                }
            }
            
            if ($name) {
                $guests[] = [
                    'name'    => $name,
                    'age'     => $age,
                    'isChild' => ($age > 0 && $age < 18)
                ];
            }
        }
    }
    
    // If no guests, create from primary registrant
    if (empty($guests)) {
        $firstName = cm26_get_nested($formData, 'names', 'first_name', '');
        $lastName = cm26_get_nested($formData, 'names', 'last_name', '');

        // Also try 'name' as direct field
        if (empty($firstName) && !empty($formData['name'])) {
            $guests[] = [
                'name' => sanitize_text_field($formData['name']),
                'age' => 30,
                'isChild' => false
            ];
        } else {
            $guests[] = [
                'name' => trim($firstName . ' ' . $lastName),
                'age' => 30,
                'isChild' => false
            ];
        }
    }

    $adultsCount = intval(cm26_get_field($formData, [
        'num_adults', 'number_of_adults', 'adults', 'adult_count',
        'number_of_adults_18', 'adults_count'
    ], 1));

    $childrenCount = intval(cm26_get_field($formData, [
        'num_children', 'number_of_children', 'children', 'child_count',
        'children_count', 'kids'
    ], 0));

    // Ensure primary registrant is in the guest list
    $primaryInList = false;
    foreach ($guests as $g) {
        if (
            !empty($fullName) && (
                stripos($g['name'], $firstName) !== false ||
                stripos($g['name'], $lastName)  !== false ||
                stripos($g['name'], $fullName)  !== false
            )
        ) {
            $primaryInList = true;
            break;
        }
    }

    if (!$primaryInList && !empty($fullName)) {
        array_unshift($guests, [
            'name'    => $fullName,
            'age'     => 30,
            'isChild' => false
        ]);
    }

    // If adultsCount + childrenCount exceeds guest list, pad with placeholder guests
    $totalExpected = $adultsCount + $childrenCount;
    while (count($guests) < $totalExpected) {
        $guests[] = [
            'name'    => 'Guest ' . count($guests),
            'age'     => 30,
            'isChild' => false
        ];
    }

    // =============================================
    // 3. HOUSING OPTION
    // =============================================
    $housingRaw = cm26_get_field($formData, [
        'housing_selection', 'housing_type', 'housing', 'payment_item', 
        'accommodation', 'lodging', 'housing_option'
    ], '');
    
    $housingOption = 'none';
    $knownOptions  = ['dorm', 'rv', 'tent', 'none'];

    if (in_array($housingRaw, $knownOptions, true)) {
        // Exact match on a known option ID — use it directly
        $housingOption = $housingRaw;
    } else {
        // Fall back to label-text substring matching
        $housingLower = strtolower($housingRaw);
        if (strpos($housingLower, 'dorm') !== false) {
            $housingOption = 'dorm';
        } elseif (strpos($housingLower, 'rv') !== false || strpos($housingLower, 'camper') !== false) {
            $housingOption = 'rv';
        } elseif (strpos($housingLower, 'tent') !== false) {
            $housingOption = 'tent';
        } else {
            $housingOption = 'none';
            if (!empty($housingRaw)) {
                error_log('CM26 Warning: Unrecognized housing option value "' . $housingRaw . '" — defaulting to none');
            }
        }
    }

    // =============================================
    // 4. NUMBER OF NIGHTS (supports number or checkbox)
    // =============================================
    $nightsRaw = cm26_get_field($formData, [
        'cm_num_nights', 'nights_attending', 'number_of_nights', 'num_nights',
        'nights', 'number_of_nights_1_5', 'nights_count'
    ], '');
    
    $numNights = 0;
    $nightsStr = '';
    
    if (is_array($nightsRaw)) {
        // Checkbox array of days
        $numNights = count($nightsRaw);
        $nightsStr = implode(',', $nightsRaw);
    } elseif (is_numeric($nightsRaw)) {
        // Single number field
        $numNights = intval($nightsRaw);
        // Generate night abbreviations based on count
        $allNights = ['Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        $nightsStr = implode(',', array_slice($allNights, 0, $numNights));
    }

    // =============================================
    // 5. GUEST COUNTS
    // =============================================
    // $adultsCount, $childrenCount parsed above for guest list use.

    // =============================================
    // 6. MEAL SELECTIONS (flexible field names)
    // =============================================
    $mealSelections = [
        'breakfast' => [
            'adult' => intval(cm26_get_field($formData, [
                'bf_adult_qty', 'adult_breakfast', 'breakfast_adult', 
                '_of_adult_breakfast_7ea', 'adult_breakfast_qty'
            ], 0)),
            'child' => intval(cm26_get_field($formData, [
                'bf_child_qty', 'child_breakfast', 'breakfast_child',
                '_of_child_breakfast_6ea', 'child_breakfast_qty'
            ], 0))
        ],
        'lunch' => [
            'adult' => intval(cm26_get_field($formData, [
                'lunch_adult_qty', 'adult_lunch', 'lunch_adult',
                '_of_adult_lunch_8ea', 'adult_lunch_qty'
            ], 0)),
            'child' => intval(cm26_get_field($formData, [
                'lunch_child_qty', 'child_lunch', 'lunch_child',
                '_of_child_lunch_7ea', 'child_lunch_qty'
            ], 0))
        ],
        'supper' => [
            'adult' => intval(cm26_get_field($formData, [
                'supper_adult_qty', 'adult_supper', 'supper_adult',
                '_of_adult_supper_8ea', 'adult_supper_qty'
            ], 0)),
            'child' => intval(cm26_get_field($formData, [
                'supper_child_qty', 'child_supper', 'supper_child',
                '_of_child_supper_7ea', 'child_supper_qty'
            ], 0))
        ]
    ];

    // =============================================
    // 7. CONTACT INFORMATION
    // =============================================
    // $firstName, $lastName, $fullName parsed above for guest list use.

    $email = sanitize_email(cm26_get_field($formData, ['email', 'email_address', 'e_mail'], ''));
    $phone = sanitize_text_field(cm26_get_field($formData, ['phone', 'phone_mobile', 'phone_number', 'mobile'], ''));
    
    // Address - try nested first, then flat
    $addressStreet = cm26_get_nested($formData, 'address', 'address_line_1', '');
    if (empty($addressStreet)) {
        $addressStreet = cm26_get_nested($formData, 'address', 'street_address', '');
    }
    $addressCity = cm26_get_nested($formData, 'address', 'city', '');
    $addressState = cm26_get_nested($formData, 'address', 'state', '');
    $addressZip = cm26_get_nested($formData, 'address', 'zip', '');
    
    $church = sanitize_text_field(cm26_get_field($formData, [
        'church_name', 'home_church', 'church', 'local_church'
    ], ''));

    // =============================================
    // 8. CALCULATED TOTALS
    // =============================================
    $housingSubtotal = floatval(cm26_get_field($formData, [
        'housing_total_payment', 'housing_total', 'housing_subtotal', 'lodging_total'
    ], 0));

    $mealSubtotal = floatval(cm26_get_field($formData, [
        'meal_total_payment', 'meal_total', 'meals_total', 'meal_subtotal', 'food_total'
    ], 0));

    $subtotal = floatval(cm26_get_field($formData, [
        'subtotal', 'sub_total', 'total_before_fees'
    ], 0));

    $processingFee = floatval(cm26_get_field($formData, [
        'fee_payment', 'processing_fee', 'card_fee', 'square_fee', 'payment_fee'
    ], 0));

    // ── SERVER-SIDE FALLBACK CALCULATION ──────────────────────────────────────
    // If JS did not run (stale cache, blocked JS, etc.) recalculate server-side.
    if ( $housingSubtotal == 0 && $mealSubtotal == 0 ) {
        // Housing rate map
        $housingRates = [ 'dorm' => 25, 'rv' => 15, 'tent' => 5, 'none' => 0 ];
        $housingRate  = $housingRates[ $housingOption ] ?? 0;

        // Count nights from array
        $nightsArr = cm26_get_field( $formData, ['nights_attending'], [] );
        if ( is_array( $nightsArr ) ) {
            $countedNights = count( array_filter( $nightsArr, function( $n ) {
                return strtolower( trim( $n ) ) !== 'none' && trim( $n ) !== '';
            }));
        } else {
            $countedNights = $numNights;
        }
        if ( $countedNights > 0 ) $numNights = $countedNights;

        $housingSubtotal = $housingRate * $numNights;

        // Meal subtotal
        $mealSubtotal =
            intval( cm26_get_field( $formData, ['bf_adult_qty',     'adult_breakfast_qty'],  0 ) ) * CM26_ADULT_BREAKFAST +
            intval( cm26_get_field( $formData, ['bf_child_qty',     'child_breakfast_qty'],  0 ) ) * CM26_CHILD_BREAKFAST +
            intval( cm26_get_field( $formData, ['lunch_adult_qty',  'adult_lunch_qty'],      0 ) ) * CM26_ADULT_LUNCH +
            intval( cm26_get_field( $formData, ['lunch_child_qty',  'child_lunch_qty'],      0 ) ) * CM26_CHILD_LUNCH +
            intval( cm26_get_field( $formData, ['supper_adult_qty', 'adult_supper_qty'],     0 ) ) * CM26_ADULT_SUPPER +
            intval( cm26_get_field( $formData, ['supper_child_qty', 'child_supper_qty'],     0 ) ) * CM26_CHILD_SUPPER;

        $subtotal = $housingSubtotal + $mealSubtotal;

        // Processing fee for Square payments
        $isSquare = ! cm26_is_offline_payment( $formData );
        $processingFee = $isSquare && $subtotal > 0
            ? round( ( $subtotal / 0.971 ) - $subtotal + ( 0.30 / 0.971 ), 2 )
            : 0;

        error_log( 'CM26 Fallback Calc [Entry ' . $entryId . ']: housing=' . $housingSubtotal . ' meals=' . $mealSubtotal . ' fee=' . $processingFee );
    }
    // ── END FALLBACK ───────────────────────────────────────────────────────────

    $firstFloorNeeded = sanitize_text_field(cm26_get_field($formData, [
        'first_floor_needed'
    ], ''));

    $rvDetails = sanitize_textarea_field(cm26_get_field($formData, [
        'rv_details'
    ], ''));

    // Determine payment method and compute totalCharged
    // Check payers send no processing fee; Square payers pay the full amount online
    $paymentMethodRaw = sanitize_text_field(cm26_get_field($formData, [
        'payment_method', 'pay_method'
    ], 'square'));
    $isCheck = cm26_is_offline_payment($formData);
    $totalCharged = $isCheck ? $subtotal : ($housingSubtotal + $mealSubtotal + $processingFee);

    // =============================================
    // 9. BUILD PAYLOAD
    // =============================================
    $payload = [
        'action' => 'submitRegistration',
        'regType' => 'paid',
        'entryId' => $entryId,
        
        // Contact
        'name' => $fullName,
        'email' => $email,
        'phone' => $phone,
        'addressStreet' => sanitize_text_field($addressStreet),
        'addressCity'   => sanitize_text_field($addressCity),
        'addressState'  => sanitize_text_field($addressState),
        'addressZip'    => sanitize_text_field($addressZip),
        'church'        => $church,
        
        // Housing
        'housingOption' => $housingOption,
        'nights' => $nightsStr,
        'numNights' => $numNights,
        
        // Guests
        'adultsCount'   => $adultsCount,
        'childrenCount' => $childrenCount,
        'guests' => $guests,
        
        // Meals
        'mealSelections' => $mealSelections,
        
        // Notes
        'dietaryNeeds' => sanitize_textarea_field(cm26_get_field($formData, [
            'dietary_restrictions', 'dietary', 'allergies', 'food_allergies'
        ], '')),
        // Accessibility / general special needs — 'special_requests' intentionally excluded
        // to avoid collision with the admin-approval specialRequests field below
        'specialNeeds' => sanitize_textarea_field(cm26_get_field($formData, [
            'special_needs', 'accessibility', 'accessibility_needs', 'notes'
        ], '')),
        // Items requiring administration approval (separate from accessibility needs)
        'specialRequests' => sanitize_textarea_field(cm26_get_field($formData, [
            'special_requests_requires_administration_approval', 'special_requests_admin',
            'special_requests_approval', 'admin_requests', 'requests_approval'
        ], '')),
        'firstFloorNeeded' => $firstFloorNeeded,
        'rvDetails'        => $rvDetails,
        
        // Financials
        'housingSubtotal' => $housingSubtotal,
        'mealSubtotal'    => $mealSubtotal,
        'subtotal'        => $subtotal,
        'processingFee'   => $processingFee,
        'totalCharged'    => $totalCharged,
        'paymentStatus'   => ($paymentStatus === 'paid') ? 'paid' : 'pending',
        'paymentMethod'   => $paymentMethodRaw,
        'transactionId'   => 'FF-' . $entryId,
        
        'submittedAt' => current_time('c')
    ];
    $payload['token'] = trim(get_option('cm26_gas_token'));

    // Save mapped payload for debugging
    if ($debugMode) {
        update_option('cm26_last_submission_mapped', json_encode($payload, JSON_PRETTY_PRINT));
    }

    // =============================================
    // 10. SEND TO GOOGLE
    // =============================================
    $payload = cm26_recursive_utf8_clean($payload);
    $jsonBody = json_encode($payload, JSON_INVALID_UTF8_SUBSTITUTE ?? 0);

    if ($jsonBody === false) {
        $errorMsg = 'JSON Encoding Error: ' . json_last_error_msg();
        error_log('CM26 Error [Entry ' . $entryId . ']: ' . $errorMsg);
        cm26_queue_failed_submission($payload, $entryId, $errorMsg);
        return;
    }

    // POST: blocking mode waits for GAS response; non-blocking fires and forgets.
    $response = wp_remote_post(cm26_get_gas_url(), [
        'method'      => 'POST',
        'body'        => $jsonBody,
        'data_format' => 'body',
        'timeout'     => $blocking ? 30 : 5,
        'redirection' => 0,
        'headers'     => ['Content-Type' => 'application/json'],
        'blocking'    => $blocking
    ]);

    if ($blocking) {
        // 1. Network-level failure.
        if (is_wp_error($response)) {
            $errorMsg = $response->get_error_message();
            error_log('CM26 Error [Entry ' . $entryId . ']: ' . $errorMsg);
            cm26_queue_failed_submission($payload, $entryId, $errorMsg);
            return false;
        }
        $httpCode = wp_remote_retrieve_response_code($response);
        // 2. GAS always returns 302 after executing doPost(); treat as success.
        if ($httpCode === 302) {
            error_log('CM26 Blocking send success [Entry ' . $entryId . ']: GAS returned 302 (redirect after doPost).');
            return true;
        }
        $rawBody = wp_remote_retrieve_body($response);
        $json = json_decode($rawBody, true);
        // 3. HTTP 200 with valid JSON success.
        if ($json && (!empty($json['success']) || (isset($json['result']) && $json['result'] === 'success'))) {
            error_log('CM26 Blocking send success [Entry ' . $entryId . '].');
            return true;
        }
        // 4. HTTP 200 with JSON error body.
        if ($json && !empty($json['error'])) {
            $errorMsg = $json['error'];
            error_log('CM26 Error [Entry ' . $entryId . ']: ' . $errorMsg);
            cm26_queue_failed_submission($payload, $entryId, $errorMsg);
            return false;
        }
        // 5. HTTP 200 with HTML or unrecognised body.
        $errorMsg = 'GAS returned non-success (HTTP ' . $httpCode . '): ' . substr($rawBody, 0, 200);
        error_log('CM26 Error [Entry ' . $entryId . ']: ' . $errorMsg);
        cm26_queue_failed_submission($payload, $entryId, $errorMsg);
        return false;
    }

    if (is_wp_error($response)) {
        // Network-level failure before the request could even be sent
        $errorMsg = $response->get_error_message();
        error_log('CM26 Error [Entry ' . $entryId . ']: Could not initiate request: ' . $errorMsg);
        cm26_queue_failed_submission($payload, $entryId, $errorMsg);
        return;
    }

    // Schedule a verification check 30 seconds later to confirm GAS received it
    wp_schedule_single_event(time() + 30, 'cm26_verify_submission', [$entryId, $payload]);
    error_log('CM26: Submission fired for entry ' . $entryId . '. Verification scheduled in 30s.');
    return true;
}

/**
 * Scheduled verification handler: confirms the registration was saved by GAS.
 * Queues to cm26_failed_submissions if the record cannot be found.
 */
add_action('cm26_verify_submission', 'cm26_handle_verify_submission', 10, 2);

function cm26_handle_verify_submission($entryId, $payload) {
    $scriptUrl = trim(get_option('cm26_google_script_url'));
    if (empty($scriptUrl)) {
        return;
    }

    $allowed = cm26_is_allowed_gas_url($scriptUrl);
    if (is_wp_error($allowed)) {
        cm26_queue_failed_submission($payload, $entryId, 'Verification blocked: ' . $allowed->get_error_message());
        return;
    }

    $verifyUrl = cm26_get_gas_url(['action' => 'getRegistration', 'id' => 'FF-' . $entryId]);

    $response = wp_remote_get($verifyUrl, [
        'timeout'     => 15,
        'redirection' => 5
    ]);

    if (is_wp_error($response)) {
        $errorMsg = $response->get_error_message();
        error_log('CM26 Verify Error [Entry ' . $entryId . ']: ' . $errorMsg);
        cm26_queue_failed_submission($payload, $entryId, 'Verification GET failed: ' . $errorMsg);
        return;
    }

    $rawBody = wp_remote_retrieve_body($response);
    $body    = json_decode($rawBody, true);

    if ($body && !empty($body['success']) && !empty($body['registration'])) {
        $regId = $body['registration']['regId'] ?? '';
        error_log('CM26 Verified [Entry ' . $entryId . ']: RegID = ' . $regId);

        if (!empty($regId)) {
            $submission = wpFluent()->table('fluentform_submissions')->where('id', $entryId)->first();
            if ($submission) {
                wpFluent()->table('fluentform_submission_meta')->insert([
                    'response_id' => $entryId,
                    'form_id'     => $submission->form_id,
                    'meta_key'    => '_cm26_registration_id',
                    'value'       => $regId,
                    'created_at'  => current_time('mysql')
                ]);
            }
        }
    } else {
        $errorMsg = $body['error'] ?? 'Registration not found during verification';
        error_log('CM26 Verify Failed [Entry ' . $entryId . ']: ' . $errorMsg);
        cm26_queue_failed_submission($payload, $entryId, 'Verification: ' . $errorMsg);
    }
}

/**
 * ==================================================
 * 3. RETRY LOGIC
 * ==================================================
 */
function cm26_queue_failed_submission($payload, $entryId, $errorMsg = '') {
    $failed = get_option('cm26_failed_submissions', []);
    
    foreach ($failed as $item) {
        if ($item['entry_id'] == $entryId) {
            return;
        }
    }
    
    $failed[] = [
        'payload' => $payload,
        'entry_id' => $entryId,
        'attempts' => 1,
        'last_attempt' => time(),
        'last_error' => $errorMsg
    ];
    
    update_option('cm26_failed_submissions', $failed);
    
    if (!wp_next_scheduled('cm26_retry_submissions')) {
        wp_schedule_single_event(time() + 300, 'cm26_retry_submissions');
    }
}

add_action('cm26_retry_submissions', 'cm26_process_failed_submissions');

function cm26_process_failed_submissions() {
    cm26_process_failed_submissions_manual(false);
}

function cm26_process_failed_submissions_manual($force = false) {
    $failed = get_option('cm26_failed_submissions', []);
    $scriptUrl = trim(get_option('cm26_google_script_url'));
    
    $result = ['success' => true, 'processed' => 0, 'succeeded' => 0, 'failed' => 0];
    
    if (empty($failed) || empty($scriptUrl)) {
        return $result;
    }

    $allowed = cm26_is_allowed_gas_url($scriptUrl);
    if (is_wp_error($allowed)) {
        $result['success'] = false;
        return $result;
    }
    
    $stillFailed = [];
    
    foreach ($failed as $item) {
        $result['processed']++;
        
        $cleanPayload = cm26_recursive_utf8_clean($item['payload']);
        $cleanPayload['token'] = trim(get_option('cm26_gas_token'));

        $response = wp_remote_post(cm26_get_gas_url(), [
            'method'    => 'POST',
            'body'      => json_encode($cleanPayload, JSON_INVALID_UTF8_SUBSTITUTE ?? 0),
            'data_format' => 'body',
            'timeout'   => 45,
            'redirection' => 0,
            'headers'   => ['Content-Type' => 'application/json'],
            'blocking'  => true
        ]);
        
        if (is_wp_error($response)) {
            $item['attempts']++;
            $item['last_attempt'] = time();
            $item['last_error'] = $response->get_error_message();
            $stillFailed[] = $item;
            $result['failed']++;
            continue;
        }
        
        $httpCode = wp_remote_retrieve_response_code($response);
        $rawBody = wp_remote_retrieve_body($response);
        
        if ($httpCode == 302) {
            $location = wp_remote_retrieve_header($response, 'location');
            if (empty($location) && preg_match('/HREF="([^"]+)"/', $rawBody, $matches)) {
                $location = $matches[1];
            }
            if (!empty($location)) {
                $redirectAllowed = cm26_is_allowed_gas_url($location);
                if (is_wp_error($redirectAllowed)) {
                    $item['attempts']++;
                    $item['last_attempt'] = time();
                    $item['last_error'] = $redirectAllowed->get_error_message();
                    $stillFailed[] = $item;
                    $result['failed']++;
                    continue;
                }
                $redirectResponse = wp_remote_get($location, ['timeout' => 30, 'redirection' => 5]);
                if (!is_wp_error($redirectResponse)) {
                    $rawBody = wp_remote_retrieve_body($redirectResponse);
                }
            }
        }
        
        $body = json_decode($rawBody, true);
        $isSuccess = ($body && (!empty($body['success']) || (isset($body['result']) && $body['result'] === 'success')));
        
        if (!$isSuccess) {
            $item['attempts']++;
            $item['last_attempt'] = time();
            $item['last_error'] = $body['error'] ?? 'Invalid response';
            $stillFailed[] = $item;
            $result['failed']++;
        } else {
            $result['succeeded']++;
        }
    }
    
    update_option('cm26_failed_submissions', $stillFailed);
    
    if (!empty($stillFailed) && !wp_next_scheduled('cm26_retry_submissions')) {
        wp_schedule_single_event(time() + 900, 'cm26_retry_submissions');
    }
    
    $result['success'] = empty($stillFailed);
    return $result;
}

/**
 * Helper: UTF-8 clean
 */
function cm26_recursive_utf8_clean($data) {
    if (is_array($data) || is_object($data)) {
        $result = [];
        foreach ($data as $key => $value) {
            $result[$key] = cm26_recursive_utf8_clean($value);
        }
        return $result;
    } elseif (is_string($data)) {
        $data = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', '', $data);
        return function_exists('mb_convert_encoding') ? mb_convert_encoding($data, 'UTF-8', 'UTF-8') : $data;
    }
    return $data;
}

/**
 * ==================================================
 * 4. AVAILABILITY AJAX PROXY + SHORTCODES
 * ==================================================
 */
add_action('wp_ajax_cm26_get_availability', 'cm26_ajax_get_availability');
add_action('wp_ajax_nopriv_cm26_get_availability', 'cm26_ajax_get_availability');

function cm26_ajax_get_availability() {
    $scriptUrl = trim(get_option('cm26_google_script_url'));
    if (empty($scriptUrl)) {
        wp_send_json_error(['message' => 'Google Script URL not configured'], 500);
    }

    $response = wp_remote_get(cm26_get_gas_url(['action' => 'getAvailability']), [
        'timeout'     => 20,
        'redirection' => 3,
    ]);

    if (is_wp_error($response)) {
        wp_send_json_error(['message' => 'Availability service is unavailable'], 502);
    }

    $statusCode = wp_remote_retrieve_response_code($response);
    $rawBody = wp_remote_retrieve_body($response);
    $payload = json_decode($rawBody, true);

    if ($statusCode >= 400 || !is_array($payload)) {
        wp_send_json_error(['message' => 'Invalid availability response'], 502);
    }

    wp_send_json($payload);
}

/**
 * ==================================================
 * 5. SHORTCODE: [cm_availability]
 * ==================================================
 */
add_shortcode('cm_availability', 'cm26_render_availability_widget');

function cm26_render_availability_widget($atts) {
    $atts = shortcode_atts([
        'style' => 'cards',
        'refresh' => '60',
    ], $atts);
    
    if (empty(trim(get_option('cm26_google_script_url')))) {
        return '<p style="color:red;">Camp Meeting: Google Script URL not configured.</p>';
    }

    $widgetId = 'cm-availability-widget-' . wp_rand(1000, 999999);
    $ajaxUrl = admin_url('admin-ajax.php?action=cm26_get_availability');

    // Inline the JS to avoid needing a separate file
    ob_start();
    ?>
    <div id="<?php echo esc_attr($widgetId); ?>" class="cm-availability-widget cm-style-<?php echo esc_attr($atts['style']); ?>">
        <style>
            .cm-style-cards .cm-grid { 
                display: flex; flex-wrap: wrap; justify-content: center; gap: 20px; margin: 20px 0; 
            }
            .cm-style-cards .cm-card { 
                flex: 0 1 250px; border: 1px solid #e2e8f0; padding: 24px 20px; border-radius: 12px; 
                text-align: center; background: linear-gradient(135deg, #fff 0%, #f8fafc 100%);
                box-shadow: 0 4px 15px rgba(0,0,0,0.05); transition: all 0.3s ease;
            }
            .cm-style-cards .cm-card:hover { transform: translateY(-3px); box-shadow: 0 8px 25px rgba(0,0,0,0.1); }
            .cm-style-cards .cm-card h4 { margin: 0 0 8px; color: #1a365d; font-size: 1.1rem; }
            .cm-style-cards .cm-card .cm-price { font-size: 0.9rem; color: #64748b; margin-bottom: 12px; }
            .cm-style-cards .cm-stat { font-size: 2rem; font-weight: 700; color: #10b981; margin-bottom: 4px; line-height: 1; }
            .cm-style-cards .cm-stat.low { color: #f59e0b; }
            .cm-style-cards .cm-stat.sold-out { color: #ef4444; }
            .cm-style-cards .cm-label { font-size: 0.85rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }
            .cm-style-cards .cm-card.sold-out-card { background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%); border-color: #fecaca; }
            .cm-style-compact .cm-grid { display: flex; flex-wrap: wrap; gap: 10px; margin: 15px 0; }
            .cm-style-compact .cm-card { display: inline-flex; align-items: center; gap: 8px; background: #f8fafc; border: 1px solid #e2e8f0; padding: 8px 14px; border-radius: 20px; font-size: 0.9rem; }
            .cm-style-compact .cm-card h4 { margin: 0; font-size: 0.9rem; font-weight: 500; }
            .cm-style-compact .cm-stat { font-weight: 700; color: #10b981; }
            .cm-style-compact .cm-stat.low { color: #f59e0b; }
            .cm-style-compact .cm-stat.sold-out { color: #ef4444; }
            .cm-style-compact .cm-price, .cm-style-compact .cm-label { display: none; }
            .cm-loading { color: #64748b; font-style: italic; padding: 20px; text-align: center; }
            .cm-error { color: #ef4444; background: #fef2f2; padding: 15px; border-radius: 8px; text-align: center; }
            .cm-last-updated { font-size: 0.75rem; color: #94a3b8; text-align: right; margin-top: 10px; }
        </style>
        <div class="cm-loading">⏳ Checking availability...</div>
        <div class="cm-grid" style="display:none;">
            <div class="cm-card" id="card-dorm">
                <h4>🏠 Dorm Rooms</h4>
                <div class="cm-price">$25/night</div>
                <div class="cm-stat" id="count-dorm">--</div>
                <div class="cm-label">Available</div>
            </div>
            <div class="cm-card" id="card-rv">
                <h4>🚐 RV Hookups</h4>
                <div class="cm-price">$15/night</div>
                <div class="cm-stat" id="count-rv">--</div>
                <div class="cm-label">Available</div>
            </div>
            <div class="cm-card" id="card-tent">
                <h4>⛺ Tent Sites</h4>
                <div class="cm-price">$5/night</div>
                <div class="cm-stat" id="count-tent">∞</div>
                <div class="cm-label">Unlimited</div>
            </div>
        </div>
        <div class="cm-last-updated" style="display:none;">Last updated: <span id="cm-timestamp">--</span></div>
    </div>
    <script>
    (function() {
        var apiUrl = <?php echo wp_json_encode($ajaxUrl); ?>;
        var refreshInterval = <?php echo intval($atts['refresh']) * 1000; ?>;
        var widget = document.getElementById(<?php echo wp_json_encode($widgetId); ?>);
        if (!widget) return;
        var loading = widget.querySelector('.cm-loading');
        var grid = widget.querySelector('.cm-grid');
        var lastUpdated = widget.querySelector('.cm-last-updated');
        var timestamp = widget.querySelector('#cm-timestamp');
        
        function loadAvailability() {
            fetch(apiUrl, { credentials: 'same-origin' })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success && data.housing) {
                        data.housing.forEach(function(item) {
                            var countEl = widget.querySelector('#count-' + item.optionId);
                            var cardEl = widget.querySelector('#card-' + item.optionId);
                            if (!countEl) return;
                            
                            countEl.className = 'cm-stat';
                            if (cardEl) cardEl.className = 'cm-card';
                            
                            if (item.isUnlimited) {
                                countEl.textContent = '∞';
                            } else if (item.available <= 0) {
                                countEl.textContent = 'SOLD OUT';
                                countEl.classList.add('sold-out');
                                if (cardEl) cardEl.classList.add('sold-out-card');
                            } else {
                                countEl.textContent = item.available;
                                if (item.available < 10) countEl.classList.add('low');
                            }
                        });
                        
                        loading.style.display = 'none';
                        grid.style.display = 'flex';
                        lastUpdated.style.display = 'block';
                        timestamp.textContent = new Date().toLocaleTimeString();
                    }
                })
                .catch(function(e) {
                    loading.innerHTML = '<span class="cm-error">⚠️ Unable to load availability</span>';
                });
        }
        
        loadAvailability();
        if (refreshInterval > 0) {
            setInterval(loadAvailability, refreshInterval);
        }
    })();
    </script>
    <?php
    return ob_get_clean();
}

/**
 * ==================================================
 * 6. SHORTCODE: [cm_availability_banner]
 * ==================================================
 */
add_shortcode('cm_availability_banner', 'cm26_render_availability_banner');

function cm26_render_availability_banner($atts) {
    $atts = shortcode_atts([
        'refresh' => '60',
        'cta'     => 'Check availability below',
    ], $atts);

    if (empty(trim(get_option('cm26_google_script_url')))) {
        return '<p style="color:red;">Camp Meeting: Google Script URL not configured.</p>';
    }

    $bannerId = 'cm-availability-banner-' . wp_rand(1000, 999999);
    $ajaxUrl = admin_url('admin-ajax.php?action=cm26_get_availability');

    ob_start();
    ?>
    <div id="<?php echo esc_attr($bannerId); ?>" class="cm-availability-banner">
        <style>
            .cm-availability-banner { border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px 16px; background: #ffffff; margin: 12px 0; }
            .cm-availability-banner .cm-banner-cta { margin: 0 0 12px; color: #1e293b; font-weight: 600; font-size: 1rem; }
            .cm-availability-banner .cm-banner-grid { display: flex; gap: 10px; align-items: stretch; }
            .cm-availability-banner .cm-banner-item { flex: 1 1 0; border-radius: 10px; padding: 10px 12px; border: 1px solid transparent; background: #f8fafc; min-width: 0; }
            .cm-availability-banner .cm-banner-title { display: block; font-size: 0.88rem; color: #334155; font-weight: 600; margin-bottom: 4px; }
            .cm-availability-banner .cm-banner-status { display: block; font-size: 0.92rem; font-weight: 700; color: #0f172a; }
            .cm-availability-banner .cm-state-available { background: #ecfdf5; border-color: #86efac; }
            .cm-availability-banner .cm-state-low { background: #fefce8; border-color: #fde047; }
            .cm-availability-banner .cm-state-sold { background: #fef2f2; border-color: #fca5a5; }
            .cm-availability-banner .cm-banner-loading { color: #64748b; font-style: italic; }
            @media (max-width: 700px) {
                .cm-availability-banner .cm-banner-grid { flex-direction: column; }
            }
        </style>
        <p class="cm-banner-cta"><?php echo esc_html($atts['cta']); ?></p>
        <div class="cm-banner-loading">⏳ Checking availability...</div>
        <div class="cm-banner-grid" style="display:none;">
            <div class="cm-banner-item" data-option="dorm">
                <span class="cm-banner-title">Dorm Rooms</span>
                <span class="cm-banner-status">--</span>
            </div>
            <div class="cm-banner-item" data-option="rv">
                <span class="cm-banner-title">RV Hookups</span>
                <span class="cm-banner-status">--</span>
            </div>
            <div class="cm-banner-item" data-option="tent">
                <span class="cm-banner-title">Tent Sites</span>
                <span class="cm-banner-status">--</span>
            </div>
        </div>
    </div>
    <script>
    (function() {
        var banner = document.getElementById(<?php echo wp_json_encode($bannerId); ?>);
        if (!banner) return;
        var apiUrl = <?php echo wp_json_encode($ajaxUrl); ?>;
        var refreshInterval = <?php echo intval($atts['refresh']) * 1000; ?>;
        var loading = banner.querySelector('.cm-banner-loading');
        var grid = banner.querySelector('.cm-banner-grid');

        function getStateClasses(item) {
            var base = 'cm-banner-item ';
            if (item.isUnlimited || item.available >= 10) return base + 'cm-state-available';
            if (item.available > 0) return base + 'cm-state-low';
            return base + 'cm-state-sold';
        }

        function getStatusText(item) {
            if (item.isUnlimited) return 'Available';
            if (item.available > 0) return item.available + ' available';
            if (item.waitlistAllowed) return 'Sold out — waitlist available';
            return 'Sold out';
        }

        function loadAvailability() {
            fetch(apiUrl, { credentials: 'same-origin' })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (!data.success || !data.housing) return;
                    data.housing.forEach(function(item) {
                        var card = banner.querySelector('[data-option="' + item.optionId + '"]');
                        if (!card) return;
                        card.className = getStateClasses(item);
                        var status = card.querySelector('.cm-banner-status');
                        if (status) status.textContent = getStatusText(item);
                    });
                    loading.style.display = 'none';
                    grid.style.display = 'flex';
                })
                .catch(function() {
                    loading.textContent = '⚠️ Unable to load availability.';
                });
        }

        loadAvailability();
        if (refreshInterval > 0) {
            setInterval(loadAvailability, refreshInterval);
        }
    })();
    </script>
    <?php
    return ob_get_clean();
}

/**
 * ==================================================
 * 7. FORM PAGE INTEGRATION
 * Disables sold-out options in forms
 * ==================================================
 */
add_action('wp_footer', 'cm26_form_availability_script');

function cm26_form_availability_script() {
    $formId = get_option('cm26_form_id');
    $ajaxUrl = admin_url('admin-ajax.php?action=cm26_get_availability');
    
    if (empty($formId) || empty(trim(get_option('cm26_google_script_url')))) {
        return;
    }
    ?>
    <script>
    (function() {
        var formEl = document.querySelector('.fluentform[data-form_id="<?php echo esc_js($formId); ?>"]');
        if (!formEl) return;
        
        fetch(<?php echo wp_json_encode($ajaxUrl); ?>, { credentials: 'same-origin' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (!data.success || !data.housing) return;
                
                data.housing.forEach(function(item) {
                    // Find inputs that contain the housing type in their value or label
                    var inputs = formEl.querySelectorAll('input[type="radio"], input[type="checkbox"]');
                    
                    inputs.forEach(function(input) {
                        var label = input.closest('label') || input.parentElement;
                        var labelText = label ? label.textContent.toLowerCase() : '';
                        
                        // Check if this input is for this housing type
                        var isMatch = false;
                        if (item.optionId === 'dorm' && labelText.indexOf('dorm') !== -1) isMatch = true;
                        if (item.optionId === 'rv' && (labelText.indexOf('rv') !== -1 || labelText.indexOf('camper') !== -1)) isMatch = true;
                        if (item.optionId === 'tent' && labelText.indexOf('tent') !== -1) isMatch = true;
                        
                        if (!isMatch) return;
                        
                        if (!item.isUnlimited && item.available <= 0) {
                            input.disabled = true;
                            if (label) {
                                label.style.opacity = '0.5';
                                label.style.cursor = 'not-allowed';
                                var badge = document.createElement('span');
                                badge.textContent = ' (SOLD OUT)';
                                badge.style.color = '#ef4444';
                                badge.style.fontWeight = 'bold';
                                label.appendChild(badge);
                            }
                        } else if (!item.isUnlimited && item.available < 10) {
                            if (label) {
                                var badge = document.createElement('span');
                                badge.textContent = ' (' + item.available + ' left)';
                                badge.style.color = '#f59e0b';
                                badge.style.fontSize = '0.85em';
                                label.appendChild(badge);
                            }
                        }
                    });
                });
            })
            .catch(function(e) {
                console.log('CM26: Could not load availability', e);
            });
    })();
    </script>
    <?php
}

/**
 * Deactivation cleanup
 */
register_deactivation_hook(__FILE__, function() {
    wp_clear_scheduled_hook('cm26_retry_submissions');
    wp_clear_scheduled_hook('cm26_verify_submission');
    wp_clear_scheduled_hook('cm26_dispatch_queue_process');
});
