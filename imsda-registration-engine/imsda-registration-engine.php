<?php
/**
 * Plugin Name: IMSDA Registration Engine
 * Description: Unified event registration engine for IMSDA. Manage multiple events from one admin UI. Each event connects to its own Fluent Forms form and Google Apps Script backend.
 * Version: 1.0.0
 * Author: IMSDA
 */

if (!defined('ABSPATH')) { exit; }

define('IMSDA_REG_VERSION', '1.0.0');
define('IMSDA_REG_PREFIX', 'imsda_reg_');
define('IMSDA_REG_MAX_ATTEMPTS', 5);

require_once __DIR__ . '/includes/class-event-registry.php';
require_once __DIR__ . '/includes/class-queue.php';
require_once __DIR__ . '/includes/class-parser.php';
require_once __DIR__ . '/includes/class-dispatcher.php';
require_once __DIR__ . '/includes/class-admin.php';
require_once __DIR__ . '/includes/class-ajax.php';
require_once __DIR__ . '/includes/class-shortcodes.php';

register_activation_hook(__FILE__, function () {
    add_option('imsda_reg_events', []);
    add_option('imsda_reg_dispatch_queue', []);
    add_option('imsda_reg_failed_submissions', []);
    add_option('imsda_reg_dispatch_last_run', '');
    if (!wp_next_scheduled('imsda_reg_process_queue')) {
        wp_schedule_event(time() + 60, 'imsda_reg_every_5_minutes', 'imsda_reg_process_queue');
    }
    flush_rewrite_rules();
});
register_deactivation_hook(__FILE__, function () {
    wp_clear_scheduled_hook('imsda_reg_process_queue');
});

add_filter('cron_schedules', function($schedules) {
    for ($i = 1; $i <= 60; $i++) {
        $key = 'imsda_reg_every_' . $i . '_minutes';
        if (!isset($schedules[$key])) {
            $schedules[$key] = [
                'interval' => $i * 60,
                'display'  => 'Every ' . $i . ' Minute(s) (IMSDA Reg)',
            ];
        }
    }
    return $schedules;
});

add_action('imsda_reg_process_queue', ['IMSDA_Reg_Queue', 'process']);
add_action('plugins_loaded', function(){ IMSDA_Reg_Admin::init(); IMSDA_Reg_Ajax::init(); IMSDA_Reg_Shortcodes::init(); });

add_action('admin_enqueue_scripts', function ($hook) {
    if (strpos((string)$hook, 'imsda-reg') === false) return;
    wp_enqueue_script('jquery');
    wp_localize_script('jquery', 'imsda_reg', [
        'ajax_url' => admin_url('admin-ajax.php'),
        'nonce' => wp_create_nonce('imsda_reg_admin_nonce'),
    ]);
});

add_action('fluentform/submission_inserted', function($entry_id, $form_data, $form) {
    $event = IMSDA_Reg_Event_Registry::get_by_form_id($form->id ?? 0);
    if (!$event || ($event->status ?? '') !== 'active') return;

    $parsed = IMSDA_Reg_Parser::parse($entry_id, $event);
    $pm = $parsed['payment_method'] ?? '';
    $is_online = in_array($pm, ['square', 'card', 'credit'], true);

    $registered = IMSDA_Reg_Event_Registry::get_counter($event->slug, 'registered');
    $capacity = intval($event->capacity ?? 0);
    $action = ($capacity > 0 && $registered >= $capacity && !empty($event->waitlist_enabled)) ? 'waitlist' : 'register';

    if ($is_online) {
        update_option('imsda_reg_pending_pay_' . $event->slug . '_' . intval($entry_id), $action, false);
        return;
    }
    IMSDA_Reg_Queue::enqueue($event->slug, $entry_id, $action);
}, 10, 3);

add_action('fluentform/payment_paid', function($payment, $submission, $status) {
  $entry_id = intval($submission->id ?? 0);
  if (!$entry_id) return;

  $events = IMSDA_Reg_Event_Registry::get_all();
  foreach ($events as $slug => $event) {
    $key = 'imsda_reg_pending_pay_' . $slug . '_' . $entry_id;
    $action = get_option($key, '');
    if ($action && in_array($action, ['register', 'waitlist'], true)) {
      IMSDA_Reg_Queue::enqueue($slug, $entry_id, $action);
      delete_option($key);
      return;
    }
  }
}, 10, 3);


add_action('init', function () {
    add_rewrite_rule('^imsda-checkin/?$', 'index.php?imsda_checkin=1', 'top');
    add_rewrite_rule('^imsda-checkin-manifest\.json$', 'index.php?imsda_checkin_manifest=1', 'top');
});

add_filter('query_vars', function ($vars) {
    $vars[] = 'imsda_checkin';
    $vars[] = 'imsda_checkin_manifest';
    return $vars;
});

add_action('template_redirect', function () {
    if (get_query_var('imsda_checkin')) {
        $file = plugin_dir_path(__FILE__) . 'pwa/imsda-checkin.html';
        if (file_exists($file)) {
            header('Content-Type: text/html; charset=utf-8');
            header('Cache-Control: no-store');
            readfile($file);
            exit;
        }
    }
    if (get_query_var('imsda_checkin_manifest')) {
        $file = plugin_dir_path(__FILE__) . 'pwa/manifest.json';
        if (file_exists($file)) {
            header('Content-Type: application/manifest+json; charset=utf-8');
            header('Cache-Control: no-store');
            readfile($file);
            exit;
        }
    }
});
