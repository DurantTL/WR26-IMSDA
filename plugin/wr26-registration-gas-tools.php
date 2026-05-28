<?php
/**
 * Plugin Name: WR26 Registration GAS Tools
 * Description: Compatibility wrapper. GAS Tools is built into the main WR26 Registration plugin and appears under WR26 → GAS Tools when the main plugin is active.
 * Version: 1.0.1
 * Author: IMSDA
 */

if (!defined('ABSPATH')) {
    exit;
}

add_action('admin_notices', function () {
    if (!current_user_can('manage_options')) {
        return;
    }

    if (!defined('WR26_VERSION')) {
        echo '<div class="notice notice-warning"><p><strong>WR26 GAS Tools:</strong> Activate the main WR26 Registration plugin to use WR26 → GAS Tools.</p></div>';
    }
});
