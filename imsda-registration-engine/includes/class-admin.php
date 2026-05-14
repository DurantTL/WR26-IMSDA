<?php
if (!defined('ABSPATH')) { exit; }
class IMSDA_Reg_Admin {
    public static function init(){ add_action('admin_menu',[__CLASS__,'menu']); add_action('admin_init',[__CLASS__,'select_event']); }
    public static function menu(){ add_menu_page('IMSDA Reg','IMSDA Reg','manage_options','imsda-reg-dashboard',[__CLASS__,'dashboard'],'dashicons-groups',30); $subs=['events'=>'Events','registrations'=>'Registrations','waitlist'=>'Waitlist','checkin'=>'Check-In','rosters'=>'Church Rosters','promo'=>'Promo Codes','settings'=>'Settings']; foreach($subs as $k=>$label){ add_submenu_page('imsda-reg-dashboard',$label,$label,'manage_options','imsda-reg-'.$k,[__CLASS__,'page']); }}
    public static function select_event(){ if(isset($_POST['imsda_selected_event'])) update_user_meta(get_current_user_id(),'imsda_reg_selected_event',sanitize_key($_POST['imsda_selected_event'])); }
    private static function selected_slug(){ return sanitize_key(get_user_meta(get_current_user_id(),'imsda_reg_selected_event',true)); }
    private static function nonce(){ return wp_create_nonce('imsda_reg_admin_nonce'); }
    private static function format_dashboard_time($mysql_datetime) {
        if (!$mysql_datetime) return 'Never';
        $ts = strtotime($mysql_datetime);
        if (!$ts) return $mysql_datetime;
        return date('M j g:ia', $ts);
    }
    private static function event_switcher(){ $events=IMSDA_Reg_Event_Registry::get_all(); if(!$events){ echo '<div class="notice notice-warning"><p>No events configured. Go to Events to add your first event.</p></div>'; return; } echo '<form method="post" style="margin:8px 0 16px;"><select name="imsda_selected_event">'; foreach($events as $slug=>$e){ echo '<option value="'.esc_attr($slug).'" '.selected(self::selected_slug(),$slug,false).'>'.esc_html($e['name']).' ('.esc_html($slug).')</option>'; } echo '</select> <button class="button">Switch</button></form>'; }

    public static function dashboard(){ self::render_shell('imsda-reg-dashboard'); }
    public static function page(){ self::render_shell(sanitize_key($_GET['page']??'')); }

    private static function render_shell($page){
        $events=IMSDA_Reg_Event_Registry::get_all(); $selected=self::selected_slug(); if(!$selected && $events) $selected=array_key_first($events);
        echo '<div class="wrap"><h1>IMSDA Registration Engine</h1>';
        if(!in_array($page,['imsda-reg-dashboard','imsda-reg-events','imsda-reg-settings'],true)) self::event_switcher();
        if($page==='imsda-reg-settings'){ self::settings_page(); echo '</div>'; return; }
        if($page==='imsda-reg-dashboard'){ self::dashboard_page(); echo '</div>'; return; }
        if($page==='imsda-reg-checkin'){ self::checkin_page($selected,$events); self::assets(); echo '</div>'; return; }
        echo '<div id="imsda-admin-app" data-page="'.esc_attr($page).'" data-selected="'.esc_attr($selected).'" data-nonce="'.esc_attr(self::nonce()).'" data-events="'.esc_attr(wp_json_encode($events)).'"></div>';
        self::assets();
        echo '</div>';
    }
    private static function checkin_page($selected,$events){
        echo '<h1>Check-In</h1>';
        self::event_switcher();
        if(!$selected || empty($events[$selected])) return;
        $event=(object)$events[$selected];
        $token = (string)($event->checkin_token ?? '');
        $pin = (string)($event->checkin_pin ?? '');
        $gas = (string)($event->gas_url ?? '');
        $pwa_url = site_url('/imsda-checkin/').'?event='.rawurlencode($selected).'&gas='.rawurlencode($gas).'&token='.rawurlencode($token);
        $qr_url = 'https://api.qrserver.com/v1/create-qr-code/?data='.rawurlencode($pwa_url).'&size=180x180';
        echo '<div style="background:#fff;border:1px solid #ccd0d4;padding:16px;margin-bottom:20px;">';
        echo '<h3 style="margin-top:0">📱 Check-In PWA</h3><p>For on-site check-in by door volunteers, use the standalone PWA. It runs on any phone, caches registrations locally for speed, and works through spotty WiFi.</p>';
        echo '<p><strong>Check-In Token:</strong> ';
        if($token===''){ echo 'Not generated yet <button class="button" id="imsda-generate-token">Generate Token</button>'; }
        else { echo '<code>'.esc_html(substr($token,0,8)).'...</code> <button class="button" id="imsda-copy-token">Copy Full Token</button> <button class="button" id="imsda-regenerate-token">Regenerate</button>'; }
        echo '</p><p><strong>Check-In PIN:</strong> ';
        if($pin===''){ echo 'Not set <input type="number" id="imsda-checkin-pin-input" min="1000" max="999999" style="width:120px"> <button class="button" id="imsda-set-pin">Set PIN</button>'; }
        else { echo '•••• <button class="button" id="imsda-change-pin">Change PIN</button> <span id="imsda-change-pin-wrap" style="display:none"><input type="number" id="imsda-checkin-pin-input" min="1000" max="999999" style="width:120px"> <button class="button" id="imsda-set-pin">Save PIN</button></span>'; }
        echo '</p><p><strong>PWA Launch URL:</strong><br><input type="text" readonly id="imsda-pwa-url" value="'.esc_attr($pwa_url).'" style="width:100%;max-width:900px"> <button class="button" id="imsda-copy-url">Copy URL</button> <a class="button" target="_blank" rel="noopener" href="'.esc_url($pwa_url).'">Open PWA</a></p>';
        echo '<p><em>Share this URL with volunteers. They will also need the PIN. The PWA works on any phone — no app install required, but it can be saved to the home screen.</em></p>';
        echo '<p><img src="'.esc_url($qr_url).'" alt="Check-In PWA QR code"><br><small>Scan to open PWA on a phone</small></p></div>';
        echo '<div id="imsda-admin-app" data-page="imsda-reg-checkin" data-selected="'.esc_attr($selected).'" data-token="'.esc_attr($token).'" data-nonce="'.esc_attr(self::nonce()).'" data-events="'.esc_attr(wp_json_encode($events)).'"></div>';
    }

    private static function dashboard_page(){
        $events = IMSDA_Reg_Event_Registry::get_all();
        $queue  = IMSDA_Reg_Queue::get_queue();
        $failed = IMSDA_Reg_Queue::get_failed();
        $last_run = get_option('imsda_reg_dispatch_last_run', '');
        $events_url = admin_url('admin.php?page=imsda-reg-events');
        $nonce = self::nonce();
        echo '<h1>IMSDA Registration — Dashboard</h1>';
        if(empty($events)){
            echo '<div class="notice notice-warning"><p>No events configured yet. <a href="'.esc_url($events_url).'">Add your first event →</a></p></div>';
        }
        echo '<style>
            .imsda-stat-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:10px 0 16px;}
            .imsda-stat-card{background:#fff;border:1px solid #ccd0d4;border-radius:4px;padding:12px}
            .imsda-stat-label{display:block;font-size:12px;color:#646970}
            .imsda-stat-value{display:block;font-size:24px;font-weight:600}
            .imsda-events-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
            .imsda-event-card{background:#fff;border:1px solid #ccd0d4;border-radius:4px;padding:18px}
            .imsda-top{display:flex;justify-content:space-between;align-items:center;gap:8px}
            .imsda-status{display:inline-block;padding:3px 9px;border-radius:999px;font-size:.78em;font-weight:600}
            .imsda-meta{color:#646970;font-size:.85em;margin:8px 0 10px}
            .imsda-progress-track{height:10px;border-radius:4px;background:#dde1e7;overflow:hidden}
            .imsda-progress-fill{height:10px;border-radius:4px}
            .imsda-quick-links{font-size:12px;margin-top:10px}
        </style>';
        echo '<h2>Dispatch Queue</h2>';
        echo '<div class="imsda-stat-grid">';
        echo '<div class="imsda-stat-card"><span class="imsda-stat-label">Items in Queue</span><span class="imsda-stat-value" style="color:#2271b1">'.intval(count($queue)).'</span></div>';
        echo '<div class="imsda-stat-card"><span class="imsda-stat-label">Failed</span><span class="imsda-stat-value" style="color:'.(count($failed)>0?'#d63638':'#646970').'">'.intval(count($failed)).'</span></div>';
        echo '<div class="imsda-stat-card"><span class="imsda-stat-label">Last Run</span><span class="imsda-stat-value" style="font-size:18px;color:#646970">'.esc_html(self::format_dashboard_time($last_run)).'</span></div>';
        echo '</div>';
        echo '<p><button class="button button-primary" id="imsda-run-queue">Run Queue Now</button> <span class="spinner" id="imsda-run-queue-spinner" style="float:none;"></span> <span id="imsda-run-queue-msg"></span></p>';
        if(empty($queue)){ echo '<p style="color:#00a32a">✅ Queue is empty.</p>'; }
        else {
            echo '<table class="widefat striped"><thead><tr><th>Event</th><th>Entry ID</th><th>Action</th><th>Queued At</th><th>Attempts</th></tr></thead><tbody>';
            foreach($queue as $item){
                echo '<tr><td><code>'.esc_html($item['event_slug'] ?? '').'</code></td><td>'.intval($item['entry_id'] ?? 0).'</td><td>'.esc_html($item['action'] ?? '').'</td><td>'.esc_html(self::format_dashboard_time($item['queued_at'] ?? '')).'</td><td>'.intval($item['attempts'] ?? 0).'</td></tr>';
            }
            echo '</tbody></table>';
        }
        echo '<h3>Failed Submissions</h3>';
        if(empty($failed)){ echo '<p style="color:#00a32a">✅ No failed submissions.</p>'; }
        else {
            echo '<div class="notice notice-warning inline"><p>⚠ These submissions did not reach Google Apps Script after 5 attempts. Retry after confirming your GAS URL and secret are correct.</p></div>';
            echo '<table class="widefat striped"><thead><tr><th>Event</th><th>Entry ID</th><th>Action</th><th>Error</th><th>Failed At</th><th>Actions</th></tr></thead><tbody>';
            foreach($failed as $idx=>$item){
                $error = (string)($item['error'] ?? '');
                $short = mb_strlen($error) > 60 ? mb_substr($error,0,60).'…' : $error;
                echo '<tr data-index="'.intval($idx).'"><td><code>'.esc_html($item['event_slug'] ?? '').'</code></td><td>'.intval($item['entry_id'] ?? 0).'</td><td>'.esc_html($item['action'] ?? '').'</td><td title="'.esc_attr($error).'">'.esc_html($short).'</td><td>'.esc_html(self::format_dashboard_time($item['failed_at'] ?? '')).'</td><td><button class="button imsda-retry-failed" data-index="'.intval($idx).'">↺ Retry</button> <button class="button imsda-dismiss-failed" data-index="'.intval($idx).'">✕ Dismiss</button></td></tr>';
            }
            echo '</tbody></table>';
        }
        if(!empty($events)){
            echo '<h2>Events</h2><div class="imsda-events-grid">';
            foreach($events as $slug=>$event){
                $status = sanitize_key($event['status'] ?? 'inactive');
                $status_styles = ['active'=>'background:#d1e7dd;color:#0a3622','inactive'=>'background:#e2e3e5;color:#41464b','closed'=>'background:#f8d7da;color:#842029'];
                $status_style = $status_styles[$status] ?? $status_styles['inactive'];
                $registered = IMSDA_Reg_Event_Registry::get_counter($slug,'registered');
                $capacity = intval($event['capacity'] ?? 0);
                $meta = [];
                if(!empty($event['dates'])) $meta[] = $event['dates'];
                if(!empty($event['location'])) $meta[] = $event['location'];
                $event_queue_count = 0; foreach($queue as $q){ if(($q['event_slug'] ?? '') === $slug) $event_queue_count++; }
                echo '<div class="imsda-event-card">';
                echo '<div class="imsda-top"><strong style="font-size:1.05em">'.esc_html($event['name'] ?? $slug).'</strong><span class="imsda-status" style="'.esc_attr($status_style).'">'.esc_html($status).'</span></div>';
                if(!empty($meta)) echo '<div class="imsda-meta">'.esc_html(implode(' | ', $meta)).'</div>';
                if($capacity===0){ echo '<p style="margin:10px 0">Registered: '.intval($registered).' / Unlimited</p>'; }
                else {
                    $pct = min(100, round(($registered / max(1,$capacity)) * 100));
                    $fill = $pct < 70 ? '#00a32a' : ($pct < 90 ? '#d97706' : '#d63638');
                    echo '<p style="text-align:right;margin:10px 0 6px;">Registered: '.intval($registered).' / '.intval($capacity).' ('.intval($pct).'%)</p>';
                    echo '<div class="imsda-progress-track"><div class="imsda-progress-fill" style="width:'.intval($pct).'%;background:'.esc_attr($fill).'"></div></div>';
                }
                if(!empty($event['feature_waitlist'])){
                    $waitlisted = IMSDA_Reg_Event_Registry::get_counter($slug,'waitlist');
                    echo '<p style="margin:8px 0;color:'.($waitlisted>0?'#d97706':'#646970').'">Waitlisted: '.intval($waitlisted).'</p>';
                }
                if($event_queue_count>0) echo '<p style="margin:8px 0;color:#2271b1">📬 '.intval($event_queue_count).' item(s) pending in queue</p>';
                if($status==='active'){
                    $reg_url = admin_url('admin.php?page=imsda-reg-registrations&event_slug='.$slug);
                    $check_url = admin_url('admin.php?page=imsda-reg-checkin&event_slug='.$slug);
                    echo '<div class="imsda-quick-links"><a href="'.esc_url($reg_url).'">→ Registrations</a> &nbsp; <a href="'.esc_url($check_url).'">→ Check-In</a></div>';
                }
                echo '</div>';
            }
            echo '</div>';
        }
        echo '<script>jQuery(function($){var nonce='.wp_json_encode($nonce).'; function doAction(a,data,ok,fail){$.post(ajaxurl,$.extend({action:"imsda_reg_admin_action",nonce:nonce,imsda_action:a},data||{})).done(function(r){if(r&&r.success){ok&&ok(r);}else{fail&&fail((r&&r.data&&r.data.message)?r.data.message:"Request failed");}}).fail(function(){fail&&fail("Request failed");});}
        $("#imsda-run-queue").on("click",function(){var $b=$(this),$s=$("#imsda-run-queue-spinner"),$m=$("#imsda-run-queue-msg");$b.prop("disabled",true);$s.addClass("is-active");$m.text("");doAction("runQueue",{},function(){$m.css("color","#00a32a").text("✅ Queue processed.");setTimeout(function(){location.reload();},1500);},function(msg){$b.prop("disabled",false);$s.removeClass("is-active");$m.css("color","#d63638").text("❌ "+msg);});});
        $(".imsda-retry-failed").on("click",function(){var $btn=$(this),index=$btn.data("index");doAction("retryFailed",{index:index},function(){$btn.closest("tr").remove();},function(msg){alert("❌ "+msg);});});
        $(".imsda-dismiss-failed").on("click",function(){if(!confirm("Remove this failed submission from the list? The registration was not sent to Google Sheets."))return;var $btn=$(this),index=$btn.data("index");doAction("dismissFailed",{index:index},function(){$btn.closest("tr").remove();},function(msg){alert("❌ "+msg);});});});</script>';
    }

    private static function settings_page(){
        $saved = false;
        if (isset($_POST['imsda_reg_save_settings']) && check_admin_referer('imsda_reg_save_settings')) {
            $settings = get_option('imsda_reg_global_settings', []);
            $settings['admin_email'] = sanitize_email($_POST['admin_email'] ?? '');
            $settings['max_attempts'] = max(1, min(10, intval($_POST['max_attempts'] ?? 5)));
            $settings['queue_interval'] = max(1, min(60, intval($_POST['queue_interval'] ?? 5)));
            update_option('imsda_reg_global_settings', $settings);

            wp_clear_scheduled_hook('imsda_reg_process_queue');
            wp_schedule_event(time(), 'imsda_reg_every_' . $settings['queue_interval'] . '_minutes', 'imsda_reg_process_queue');

            $saved = true;
        }

        $settings = get_option('imsda_reg_global_settings', []);
        $admin_email = $settings['admin_email'] ?? get_option('admin_email');
        $max_attempts = $settings['max_attempts'] ?? 5;
        $queue_interval = $settings['queue_interval'] ?? 5;
        $next = wp_next_scheduled('imsda_reg_process_queue');
        $last_run = get_option('imsda_reg_dispatch_last_run', 'Never');
        $events = IMSDA_Reg_Event_Registry::get_all();
        $queue = IMSDA_Reg_Queue::get_queue();
        $failed = IMSDA_Reg_Queue::get_failed();
        $queue_count = count($queue);
        $failed_count = count($failed);

        echo '<h1>Settings</h1>';
        if ($saved) {
            echo '<div class="notice notice-success is-dismissible"><p>✅ Settings saved.</p></div>';
        }

        echo '<form method="post">';
        wp_nonce_field('imsda_reg_save_settings');
        echo '<h2>Queue Settings</h2>';
        echo '<table class="form-table" role="presentation">';
        echo '<tr><th scope="row"><label for="imsda-admin-email">Admin Notification Email</label></th><td><input id="imsda-admin-email" type="email" name="admin_email" value="' . esc_attr($admin_email) . '" class="regular-text" /><p class="description">Receives an email when a submission fails after max attempts. Falls back to WordPress admin email if blank.</p></td></tr>';
        echo '<tr><th scope="row"><label for="imsda-max-attempts">Max Retry Attempts</label></th><td><input id="imsda-max-attempts" type="number" name="max_attempts" value="' . intval($max_attempts) . '" min="1" max="10" class="small-text" /><p class="description">Number of times the queue will retry a failed submission before moving it to failed submissions. Default: 5.</p></td></tr>';
        echo '<tr><th scope="row"><label for="imsda-queue-interval">Queue Interval (minutes)</label></th><td><input id="imsda-queue-interval" type="number" name="queue_interval" value="' . intval($queue_interval) . '" min="1" max="60" class="small-text" /><p class="description">How often the dispatch queue runs. Default: 5 minutes. Lower values mean faster dispatch but more server load.</p></td></tr>';
        $next_text = 'Not scheduled — queue will run on next page load or cron trigger.';
        if ($next) {
            $next_text = wp_date('M j, Y g:i:s a', $next) . ' (' . human_time_diff(time(), $next) . ')';
        }
        echo '<tr><th scope="row">Next Queue Run</th><td>' . esc_html($next_text) . '</td></tr>';
        echo '<tr><th scope="row">Last Queue Run</th><td>' . esc_html((string) $last_run) . '</td></tr>';
        echo '</table>';

        echo '<h2>Plugin Info</h2>';
        echo '<table class="form-table" role="presentation">';
        echo '<tr><th scope="row">Version</th><td>' . esc_html((string) IMSDA_REG_VERSION) . '</td></tr>';
        echo '<tr><th scope="row">Active Events</th><td>' . intval(count($events)) . '</td></tr>';
        echo '<tr><th scope="row">Queue Items</th><td>' . intval($queue_count) . '</td></tr>';
        echo '<tr><th scope="row">Failed Submissions</th><td>' . intval($failed_count) . '</td></tr>';
        echo '</table>';

        echo '<p class="submit"><input type="submit" name="imsda_reg_save_settings" class="button button-primary" value="Save Settings" /></p>';
        echo '</form>';

        echo '<div style="border:1px solid #d63638;border-radius:4px;padding:20px;margin-top:30px;">';
        echo '<h2 style="color:#d63638;margin-top:0">⚠ Danger Zone</h2>';
        echo '<p style="color:#646970;margin-bottom:16px">These actions are irreversible. Use with caution.</p>';

        echo '<table class="widefat" style="max-width:980px"><tbody>';
        echo '<tr><td><strong>Clear Dispatch Queue</strong><p style="margin:6px 0 0;color:#646970">Remove all pending items from the dispatch queue. Submissions will not be sent to Google Apps Script. Use only if queue is stuck and you are resubmitting manually.</p></td><td style="width:180px"><button type="button" class="button" id="imsda-clear-queue">Clear Queue</button></td></tr>';
        echo '<tr><td><strong>Clear Failed Submissions</strong><p style="margin:6px 0 0;color:#646970">Remove all failed submissions from the log. This does not resend them — it only clears the list.</p></td><td><button type="button" class="button" id="imsda-clear-failed">Clear Failed</button></td></tr>';
        echo '<tr><td><strong>Flush Rewrite Rules</strong><p style="margin:6px 0 0;color:#646970">If the check-in PWA URL (/imsda-checkin/) returns a 404, use this to rebuild WordPress rewrite rules.</p></td><td><button type="button" class="button" id="imsda-flush-rules">Flush Rewrite Rules</button><span id="imsda-flush-result" style="margin-left:8px;color:#00a32a"></span></td></tr>';
        echo '</tbody></table>';
        echo '</div>';

        $nonce = self::nonce();
        echo '<script>jQuery(function($){var nonce=' . wp_json_encode($nonce) . ';var queueCount=' . intval($queue_count) . ';var failedCount=' . intval($failed_count) . ';function runAdminAction(action,onSuccess){$.post(ajaxurl,{action:"imsda_reg_admin_action",nonce:nonce,imsda_action:action}).done(function(resp){if(resp&&resp.success){onSuccess&&onSuccess(resp);}else{alert("❌ "+((resp&&resp.data&&resp.data.message)?resp.data.message:"Request failed"));}}).fail(function(){alert("❌ Request failed");});}$("#imsda-clear-queue").on("click",function(){if(!confirm("Clear the entire dispatch queue? "+queueCount+" item(s) will be permanently removed and not sent to Google Apps Script.")){return;}runAdminAction("clearQueue",function(){location.reload();});});$("#imsda-clear-failed").on("click",function(){if(!confirm("Clear all "+failedCount+" failed submission(s)? This cannot be undone.")){return;}runAdminAction("clearFailed",function(){location.reload();});});$("#imsda-flush-rules").on("click",function(){runAdminAction("flushRules",function(){ $("#imsda-flush-result").text("✅ Rewrite rules flushed."); });});});</script>';
    }

    private static function assets(){ ?>
<style>.ims-tabs button{margin-right:6px}.ims-tab{display:none}.ims-tab.active{display:block}.ims-modal{position:fixed;z-index:100000;inset:0;background:rgba(0,0,0,.45);display:none;align-items:center;justify-content:center}.ims-modal .box{background:#fff;padding:16px;max-width:900px;width:95%;max-height:90vh;overflow:auto}.badge{padding:2px 8px;border-radius:999px;color:#fff}.b-active{background:#008a20}.b-inactive{background:#666}.b-closed{background:#b32d2e}.prog{height:10px;background:#eee;border-radius:6px}.prog i{display:block;height:100%;border-radius:6px}</style>
<script>
jQuery(function($){const app=$('#imsda-admin-app'); if(!app.length)return; const nonce=app.data('nonce'),page=app.data('page'),events=JSON.parse(app.attr('data-events')||'{}'); let slug=app.data('selected')||''; const ajax=(a,d,ok)=>$.post(ajaxurl,Object.assign({action:'imsda_reg_admin_action',nonce:nonce,imsda_action:a,event_slug:slug},d||{}),ok);
function status(s){return '<span class="badge b-'+s+'">'+s+'</span>'}
function payCell(r){return (r.paymentStatus||'')+' '+(r.finalAmount?('$'+r.finalAmount):'')}
function paymentPanel(id,b){return `<div><p>Method <select class='pm'><option>cash</option><option>check</option><option>square</option><option>other</option></select> Amount <input class='amt' value='${b||0}' type='number' step='0.01'> <button class='button savepay' data-id='${id}'>Save</button></p><p class='checkrow' style='display:none'>Check # <input class='chk'></p><div class='sq' style='display:none'>Square calc <select class='sqtype'><option value='0.026,0.10'>Tap/Chip/Swipe</option><option value='0.035,0.15'>Manual Key Entry</option></select> <b class='sqamt'></b> <button class='button copyamt'>Copy</button></div><textarea class='notes' placeholder='Notes'></textarea></div>`;}
if(!$('#imsda-payment-modal').length){$('body').append(`<div class='ims-modal' id='imsda-payment-modal'><div class='box'><h3>Record Payment</h3><div id='imsda-payment-body'></div><p><button class='button' id='imsda-payment-close'>Close</button></p></div></div>`);}
window.imsda_open_payment_modal=function(regId,balance){$('#imsda-payment-body').html(paymentPanel(regId,balance||0));$('#imsda-payment-modal').css('display','flex');};
$(document).on('click','#imsda-payment-close',function(){$('#imsda-payment-modal').hide();});
$(document).on('click','.savepay',function(){const id=$(this).data('id');const $w=$(this).closest('div');ajax('recordPayment',{registration_id:id,payment_method:$w.find('.pm').val(),amount_paid:$w.find('.amt').val(),check_number:$w.find('.chk').val(),payment_notes:$w.find('.notes').val()},function(r){if(r&&r.success){$('#imsda-payment-modal').hide();}});});
function renderEvents(){const defaultFieldMap=<?php echo wp_json_encode(IMSDA_Reg_Event_Registry::default_field_map(), JSON_PRETTY_PRINT);?>;let currentState='list',mode='add',editingSlug='';const statusClass={active:'b-active',inactive:'b-inactive',closed:'b-closed'};const esc=s=>String(s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));const slugify=v=>String(v||'').toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'').replace(/-+/g,'-').replace(/^-|-$/g,'');
const eventArray=()=>Object.keys(events).map(k=>events[k]);
const listRows=()=>{const arr=eventArray(); if(!arr.length) return `<tr><td colspan='6'>No events yet. Add your first event using the button above.</td></tr>`; return arr.map(e=>{const cap=parseInt(e.capacity||0,10);const reg=parseInt(e.registered_count||0,10);return `<tr data-slug='${esc(e.slug)}'><td><strong>${esc(e.name)}</strong><br><small style='color:#666'>${esc(e.dates||'')}</small></td><td><code>${esc(e.slug)}</code></td><td>${esc(e.form_id)}</td><td><span class='badge ${statusClass[e.status]||'b-inactive'}'>${esc(e.status||'inactive')}</span></td><td>${reg} / ${cap===0?'∞':cap}</td><td><a href='#' class='ims-edit' data-slug='${esc(e.slug)}'>Edit</a> | <a href='#' class='ims-export' data-slug='${esc(e.slug)}'>Export</a> | <a href='#' class='ims-delete' data-slug='${esc(e.slug)}' data-name='${esc(e.name)}'>Delete</a></td></tr>`}).join('');};
const renderList=()=>{currentState='list';app.html(`<div id='imsda-notice'></div><div style='display:flex;justify-content:space-between;align-items:center;max-width:1100px'><h2 style='margin:8px 0'>Events</h2><div><button class='button button-primary' id='ims-add-event'>Add New Event</button> <button class='button' id='ims-toggle-import'>Import Event</button></div></div><div id='ims-import-panel' style='display:none;background:#fff;border:1px solid #ccc;padding:16px;max-width:700px;margin:10px 0'><h3 style='margin-top:0'>Import Event Profile</h3><p><input type='file' id='ims-import-file' accept='.json'></p><p style='text-align:center;font-weight:600'>— OR —</p><p><textarea id='ims-import-json' rows='8' style='width:100%' placeholder='Paste JSON'></textarea></p><p><button class='button button-primary' id='ims-run-import'>Import</button> <button class='button' id='ims-cancel-import'>Cancel</button></p><div id='ims-import-result'></div></div><table class='widefat striped' style='max-width:1100px'><thead><tr><th>Name</th><th>Slug</th><th>Form ID</th><th>Status</th><th>Registered / Capacity</th><th>Actions</th></tr></thead><tbody>${listRows()}</tbody></table>`);};
const formData=(ev={})=>({name:ev.name||'',slug:ev.slug||'',dates:ev.dates||'',location:ev.location||'',status:ev.status||'active',gas_url:ev.gas_url||'',gas_secret:ev.gas_secret||'',form_id:ev.form_id||'',payment_default:ev.payment_default||'pay_later',edit_page_url:ev.edit_page_url||'',capacity:ev.capacity||0,waitlist_enabled:!!ev.waitlist_enabled,early_bird_price:ev.early_bird_price||'',early_bird_end_date:ev.early_bird_end_date||'',regular_price:ev.regular_price||'',regular_end_date:ev.regular_end_date||'',feature_waitlist:ev.feature_waitlist!==false,feature_promo_codes:ev.feature_promo_codes!==false,feature_checkin:ev.feature_checkin!==false,feature_transfers:ev.feature_transfers!==false,feature_church_rosters:ev.feature_church_rosters!==false,feature_attendees:ev.feature_attendees!==false,field_map:JSON.stringify(ev.field_map||defaultFieldMap,null,2),registered_count:ev.registered_count||0,waitlist_count:ev.waitlist_count||0});
const renderForm=(isEdit,ev)=>{currentState='form';mode=isEdit?'edit':'add';editingSlug=isEdit?ev.slug:'';const d=formData(ev);const secretMask=d.gas_secret?`${d.gas_secret.substring(0,8)}...`:'';app.html(`<div id='imsda-notice'></div><div style='display:flex;justify-content:space-between'><h2>${isEdit?`Edit Event: ${esc(d.name)}`:'Add New Event'}</h2><a href='#' id='ims-cancel-form'>Cancel</a></div><h2 class='nav-tab-wrapper ims-tabs'><a href='#' class='nav-tab nav-tab-active' data-tab='identity'>Identity</a><a href='#' class='nav-tab' data-tab='gas'>GAS Connection</a><a href='#' class='nav-tab' data-tab='formpay'>Form & Payment</a><a href='#' class='nav-tab' data-tab='capacity'>Capacity & Pricing</a><a href='#' class='nav-tab' data-tab='features'>Features</a><a href='#' class='nav-tab' data-tab='fieldmap'>Field Map</a>${isEdit?"<a href='#' class='nav-tab' data-tab='counters'>Counters</a>":''}</h2><div class='ims-tab active' data-name='identity'><p><label>Event Name *<br><input type='text' id='imsda-event-name' class='regular-text' value='${esc(d.name)}'></label></p><p><label>Event Slug *<br>${isEdit?`<code>${esc(d.slug)}</code><input type='hidden' id='imsda-event-slug' value='${esc(d.slug)}'><br><small>Slug cannot be changed after creation.</small>`:`<input type='text' id='imsda-event-slug' pattern='[a-z0-9-]+' class='regular-text' value='${esc(d.slug)}'>`}</label></p><p><label>Dates<br><input type='text' id='imsda-dates' class='regular-text' placeholder='e.g. October 9–11, 2026' value='${esc(d.dates)}'></label></p><p><label>Location<br><input type='text' id='imsda-location' class='regular-text' placeholder='e.g. Des Moines, IA' value='${esc(d.location)}'></label></p><p><label>Status<br><select id='imsda-status'><option value='active'>Active</option><option value='inactive'>Inactive</option><option value='closed'>Closed</option></select></label></p></div><div class='ims-tab' data-name='gas'><p><label>GAS Deployment URL *<br><input type='url' id='imsda-gas-url' class='large-text' placeholder='https://script.google.com/...' value='${esc(d.gas_url)}'></label></p><div id='ims-secret-wrap'>${isEdit?`<p>GAS Secret: <code id='ims-secret-mask'>${esc(secretMask)}</code><input type='hidden' id='imsda-gas-secret' value='${esc(d.gas_secret)}'> <button class='button' id='ims-copy-secret'>Copy Full Secret</button></p><p><small>Copy this into your GAS Config sheet as the SECRET value. Regenerate only if compromised.</small></p><p><button class='button' id='ims-regenerate-secret'>Regenerate Secret</button></p>`:`<p>GAS Secret: Will be generated on save.</p><input type='hidden' id='imsda-gas-secret' value=''>`}</div><p><button class='button' id='ims-test-gas'>Test Connection</button> <span class='spinner' style='float:none'></span></p><div id='ims-test-result'></div></div><div class='ims-tab' data-name='formpay'><p><label>Fluent Form ID *<br><input type='number' min='1' id='imsda-form-id' value='${esc(d.form_id)}'></label></p><p><label>Default Payment Method<br><select id='imsda-payment-default'><option value='pay_later'>Pay Later</option><option value='square'>Square / Card</option><option value='check'>Check</option><option value='cash'>Cash</option></select></label></p><p><label>Edit Registration Page URL<br><input type='url' id='imsda-edit-url' class='large-text' value='${esc(d.edit_page_url)}'></label><br><small>Full URL of the WordPress page with the [imsda_edit_registration event='slug'] shortcode.</small></p></div><div class='ims-tab' data-name='capacity'><p><label>Total Capacity<br><input type='number' min='0' id='imsda-capacity' value='${esc(d.capacity)}'></label> <small>Set to 0 for unlimited.</small></p><p><label><input type='checkbox' id='imsda-waitlist-enabled' ${d.waitlist_enabled?'checked':''}> Enable Waitlist</label></p><p><label>Early Bird Price ($)<br><input type='number' step='0.01' id='imsda-eb-price' value='${esc(d.early_bird_price)}'></label></p><p><label>Early Bird End Date<br><input type='date' id='imsda-eb-end' value='${esc(d.early_bird_end_date)}'></label></p><p><label>Regular Price ($)<br><input type='number' step='0.01' id='imsda-reg-price' value='${esc(d.regular_price)}'></label></p><p><label>Regular End Date<br><input type='date' id='imsda-reg-end' value='${esc(d.regular_end_date)}'></label></p></div><div class='ims-tab' data-name='features'><p><label><input type='checkbox' id='imsda-f-waitlist' ${d.feature_waitlist?'checked':''}> Enable Waitlist</label></p><p><label><input type='checkbox' id='imsda-f-promo' ${d.feature_promo_codes?'checked':''}> Enable Promo Codes</label></p><p><label><input type='checkbox' id='imsda-f-checkin' ${d.feature_checkin?'checked':''}> Enable Check-In</label></p><p><label><input type='checkbox' id='imsda-f-transfer' ${d.feature_transfers?'checked':''}> Enable Transfers</label></p><p><label><input type='checkbox' id='imsda-f-rosters' ${d.feature_church_rosters?'checked':''}> Enable Church Rosters</label></p><p><label><input type='checkbox' id='imsda-f-attendees' ${d.feature_attendees?'checked':''}> Enable Multi-Attendee (flat a1–a5 fields)</label></p></div><div class='ims-tab' data-name='fieldmap'><p><textarea id='imsda-field-map' rows='10' class='large-text code'>${esc(d.field_map)}</textarea></p><p><button class='button' id='ims-validate-map'>Validate JSON</button> <button class='button' id='ims-reset-map'>Reset to Default</button></p><div id='ims-map-result'></div></div>${isEdit?`<div class='ims-tab' data-name='counters'><p><label>Registered Count<br><input type='number' id='imsda-registered-count' value='${esc(d.registered_count)}'></label></p><p><label>Waitlist Count<br><input type='number' id='imsda-waitlist-count' value='${esc(d.waitlist_count)}'></label></p><p><button class='button' id='ims-reset-registered'>Reset Registered to 0</button> <button class='button' id='ims-reset-waitlist'>Reset Waitlist to 0</button></p><p><small>These are local counters used for quick capacity checks. The source of truth is your Google Sheet. Use overrides to correct after manual edits to the sheet.</small></p></div>`:''}<p><button class='button button-primary' id='ims-save-event'>Save Event</button></p><div id='ims-form-error'></div>`);$('#imsda-status').val(d.status);$('#imsda-payment-default').val(d.payment_default);};
renderList();
app.off('click').on('click','#ims-add-event',e=>{e.preventDefault();renderForm(false,{});}).on('click','#ims-cancel-form,#ims-cancel-import',e=>{e.preventDefault();renderList();}).on('click','#ims-toggle-import',()=>$('#ims-import-panel').toggle())
.on('click','.ims-edit',function(e){e.preventDefault();renderForm(true,events[$(this).data('slug')]||{});}).on('click','.ims-delete',function(e){e.preventDefault();const eslug=$(this).data('slug'),name=$(this).data('name');if(confirm(`Delete ${name}? This cannot be undone.`)){ajax('deleteEvent',{event_slug:eslug},r=>{if(r.success){delete events[eslug];renderList();}});}})
.on('click','.ims-export',function(e){e.preventDefault();const eslug=$(this).data('slug');ajax('exportEvent',{event_slug:eslug},response=>{if(response.success){var blob=new Blob([response.data.json],{type:'application/json'});var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=response.data.filename;a.click();URL.revokeObjectURL(a.href);}});})
.on('click','.ims-tabs .nav-tab',function(e){e.preventDefault();$('.ims-tabs .nav-tab').removeClass('nav-tab-active');$(this).addClass('nav-tab-active');$('.ims-tab').removeClass('active');$(`.ims-tab[data-name='${$(this).data('tab')}']`).addClass('active');})
.on('input','#imsda-event-name',function(){if(mode==='add') $('#imsda-event-slug').val(slugify($(this).val()));})
.on('click','#ims-validate-map',function(e){e.preventDefault();try{JSON.parse($('#imsda-field-map').val());$('#ims-map-result').html("<div style='color:green'>✅ Valid JSON</div>");}catch(err){$('#ims-map-result').html(`<div style='color:#b32d2e'>❌ Invalid JSON: ${esc(err.message)}</div>`);}})
.on('click','#ims-reset-map',function(e){e.preventDefault();if(confirm('Reset field map to default? Current map will be lost.')) $('#imsda-field-map').val(JSON.stringify(defaultFieldMap,null,2));})
.on('click','#ims-run-import',function(){const f=$('#ims-import-file')[0].files[0],txt=$('#ims-import-json').val();if(!f&&!txt){$('#ims-import-result').html("<div style='color:#b32d2e'>❌ Provide JSON file or pasted JSON.</div>");return;}const runImport=(confirmOverwrite)=>{const fd=new FormData();fd.append('action','imsda_reg_admin_action');fd.append('nonce',nonce);fd.append('imsda_action','importEvent');if(f)fd.append('event_file',f);fd.append('event_json',txt);if(confirmOverwrite)fd.append('confirm_overwrite','1');$.ajax({url:ajaxurl,type:'POST',data:fd,processData:false,contentType:false,success:r=>{if(r.success){const d=r.data||{};$('#ims-import-result').html(`<div style='background:#ecf7ec;border:1px solid #6aa56a;padding:8px'>✅ Event ${esc(d.slug)} imported successfully.</div><div style='background:#fff8e5;border:1px solid #dba617;padding:8px;margin-top:8px'><strong>⚠ New GAS Secret generated:</strong> <code id='ims-new-secret'>${esc(d.gas_secret||'')}</code> <button class='button' id='ims-copy-new-secret'>Copy</button><div>Copy this into your GAS Config sheet as the SECRET value before testing submissions. It will not be shown again in full.</div></div>`);location.reload();}else if(r.data&&r.data.overwrite_required){if(confirm(`An event with slug ${r.data.slug} already exists (${r.data.name}). Overwrite it?`)) runImport(true);}else $('#ims-import-result').html(`<div style='background:#ffeaea;border:1px solid #b32d2e;padding:8px'>❌ ${esc(r.data?.message||'Import failed')}</div>`);}});};runImport(false);})
.on('click','#ims-copy-new-secret,#ims-copy-secret',function(e){e.preventDefault();const text=$(this).attr('id')==='ims-copy-secret'?$('#imsda-gas-secret').val():$('#ims-new-secret').text();navigator.clipboard.writeText(text||'');})
.on('click','#ims-regenerate-secret',function(e){e.preventDefault();if(!confirm('Regenerate secret? You must update your GAS Config sheet immediately or submissions will fail.')) return;ajax('regenerateSecret',{event_slug:editingSlug},r=>{if(r.success){$('#imsda-gas-secret').val(r.data.secret);$('#ims-secret-mask').text((r.data.secret||'').substring(0,8)+'...');$('#ims-test-result').html(`<div style='background:#fff8e5;border:1px solid #dba617;padding:8px'>⚠ New GAS Secret generated: <code>${esc(r.data.secret)}</code></div>`);}});})
.on('click','#ims-test-gas',function(e){e.preventDefault();const url=$('#imsda-gas-url').val();if(!url){$('#ims-test-result').html("<div style='color:#b32d2e'>❌ GAS URL is required.</div>");return;}const targetSlug=mode==='add'?($('#imsda-event-slug').val()||slugify($('#imsda-event-name').val())):editingSlug;$('.spinner').addClass('is-active');ajax('testConnection',{event_slug:targetSlug,gas_url:url},r=>{$('.spinner').removeClass('is-active');if(r.success)$('#ims-test-result').html("<div style='color:green'>✅ Connected — GAS responded successfully</div>");else $('#ims-test-result').html(`<div style='color:#b32d2e'>❌ ${esc(r.data?.message||'Connection failed')}</div>`);});})
.on('click','#ims-reset-registered,#ims-reset-waitlist',function(e){e.preventDefault();const isReg=this.id==='ims-reset-registered';if(!confirm(isReg?'Reset registered count to 0?':'Reset waitlist count to 0?')) return;ajax('resetCounter',{event_slug:editingSlug,type:isReg?'registered':'waitlist'},r=>{if(r.success) $(isReg?'#imsda-registered-count':'#imsda-waitlist-count').val(0);});})
.on('click','#ims-save-event',function(e){e.preventDefault();let errs=[];const name=$('#imsda-event-name').val().trim(),slugVal=$('#imsda-event-slug').val().trim(),gas=$('#imsda-gas-url').val().trim(),formId=parseInt($('#imsda-form-id').val(),10);let fmText=$('#imsda-field-map').val();let fmObj=null; if(!name) errs.push(['identity','#imsda-event-name','Event name is required']); if(!/^[a-z0-9-]+$/.test(slugVal)) errs.push(['identity','#imsda-event-slug','Slug must match a-z, 0-9, hyphen']); if(!gas) errs.push(['gas','#imsda-gas-url','GAS URL is required']); if(!(formId>0)) errs.push(['formpay','#imsda-form-id','Form ID must be a positive integer']); try{fmObj=JSON.parse(fmText);}catch(err){errs.push(['fieldmap','#imsda-field-map','Invalid JSON: '+err.message]);}
if(errs.length){const f=errs[0];$('.ims-tabs .nav-tab').removeClass('nav-tab-active');$(`.ims-tabs .nav-tab[data-tab='${f[0]}']`).addClass('nav-tab-active');$('.ims-tab').removeClass('active');$(`.ims-tab[data-name='${f[0]}']`).addClass('active');$(f[1]).focus();$('#ims-form-error').html(`<div style='color:#b32d2e'>❌ ${esc(f[2])}</div>`);window.scrollTo({top:0,behavior:'smooth'});return;}const payload={event_slug:mode==='edit'?editingSlug:slugVal,slug:slugVal,name:name,dates:$('#imsda-dates').val(),location:$('#imsda-location').val(),status:$('#imsda-status').val(),gas_url:gas,gas_secret:$('#imsda-gas-secret').val(),form_id:formId,payment_default:$('#imsda-payment-default').val(),edit_page_url:$('#imsda-edit-url').val(),capacity:$('#imsda-capacity').val(),waitlist_enabled:$('#imsda-waitlist-enabled').is(':checked')?1:'',early_bird_price:$('#imsda-eb-price').val(),early_bird_end_date:$('#imsda-eb-end').val(),regular_price:$('#imsda-reg-price').val(),regular_end_date:$('#imsda-reg-end').val(),feature_waitlist:$('#imsda-f-waitlist').is(':checked')?1:'',feature_promo_codes:$('#imsda-f-promo').is(':checked')?1:'',feature_checkin:$('#imsda-f-checkin').is(':checked')?1:'',feature_transfers:$('#imsda-f-transfer').is(':checked')?1:'',feature_church_rosters:$('#imsda-f-rosters').is(':checked')?1:'',feature_attendees:$('#imsda-f-attendees').is(':checked')?1:'',field_map:JSON.stringify(fmObj),registered_count:$('#imsda-registered-count').val(),waitlist_count:$('#imsda-waitlist-count').val()};ajax('saveEvent',payload,r=>{if(r.success){$('#imsda-notice').html(`<div class='notice notice-success'><p>${mode==='add'?`Event ${esc(name)} created. GAS Secret: ${esc(r.data?.secret||payload.gas_secret||'generated')} — copy to your Config sheet.`:'Event updated.'}</p></div>`);location.reload();}else $('#ims-form-error').html(`<div style='color:#b32d2e'>❌ ${esc(r.data?.message||'Save failed')}</div>`);});});
}
function renderDashboard(){ajax('runQueue',{},()=>{});app.html('<div id="dash"></div>');}
function renderGeneric(action,cols,rowFn,actions=''){app.html(`<p><input id='s'> <button class='button r'>Refresh</button></p><table class='widefat'><thead><tr>${cols.map(c=>`<th>${c}</th>`).join('')}</tr></thead><tbody id='tb'></tbody></table><div class='ims-modal' id='m'><div class='box'></div></div>`); const load=()=>ajax(action,{q:$('#s').val(),status:$('#status').val()},r=>{$('#tb').html((r.registrations||[]).map(rowFn).join(''))}); load(); app.on('click','.r',load);}
if(page==='imsda-reg-events') renderEvents();
if(page==='imsda-reg-registrations'){
app.html(`<p><input id='s'> <button class='button r'>Refresh</button></p><table class='widefat'><thead><tr><th>ID</th><th>Name</th><th>Church</th><th>Payment</th><th>Status</th><th>Checked In</th><th>Actions</th></tr></thead><tbody id='tb'></tbody></table>`);
const loadRegistrations=()=>$.post(ajaxurl,{action:'imsda_reg_admin_action',nonce:nonce,imsda_action:'getRegistrations',event_slug:slug,q:$('#s').val()}).done(function(r){var list=r.registrations||[];$('#tb').html(list.map(function(reg){const regJson=JSON.stringify(reg).replace(/'/g,'&#39;');const fullName=((reg.firstName||'')+' '+(reg.lastName||'')).trim();const transferBtn=(reg.status||'')==='active'?` <button class="button button-small imsda-transfer-btn" data-id="${reg.registrationId||''}" data-name="${fullName}">Transfer</button>`:'';const payBtn=(['pending_check','pending_pay_later','unpaid'].includes(reg.paymentStatus||''))?` <button class="button button-small imsda-pay-btn" data-id="${reg.registrationId||''}" data-amount="${reg.finalAmount||0}">Record Payment</button>`:'';return `<tr><td>${reg.registrationId||''}</td><td>${reg.firstName||''} ${reg.lastName||''}<br><small>${reg.email||''}</small></td><td>${reg.church||''}</td><td>${payCell(reg)}</td><td>${reg.status||''}</td><td>${reg.checkedIn?(reg.checkInTime||'Yes'):'No'}</td><td><button class="button button-small imsda-edit-btn" data-id="${reg.registrationId||''}" data-reg='${regJson}'>Edit</button>${transferBtn}${payBtn}</td></tr>`;}).join(''));});};
loadRegistrations();
app.on('click','.r',loadRegistrations).on('click','.imsda-pay-btn',function(){window.imsda_open_payment_modal($(this).data('id'),$(this).data('amount'));});
}
if(page==='imsda-reg-waitlist'){
const selectedEvent=(events&&slug&&events[slug])?events[slug]:null;
if(!selectedEvent){ app.html('<h1>Waitlist</h1><p>Please select an event.</p>'); return; }
if(!selectedEvent.feature_waitlist){
app.html(`<h1>Waitlist</h1><div class="notice notice-warning inline"><p>Waitlist is not enabled for this event. Enable it in Events → ${String(selectedEvent.name||slug).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))} → Features.</p></div>`);
return;
}
app.html(`<h1>Waitlist</h1><div id="imsda-wl-notice"></div><div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;"><button class="button" id="imsda-wl-refresh">↺ Refresh</button><label for="imsda-wl-status" class="screen-reader-text">Status</label><select id="imsda-wl-status"><option value="waiting" selected>Waiting (active)</option><option value="promoted">Promoted</option><option value="removed">Removed</option><option value="">All</option></select><span id="imsda-wl-count" style="color:#646970;font-size:.9em"></span></div><div id="imsda-wl-stats" style="margin-bottom:10px;"></div><div id="imsda-wl-wrap"><p>Loading…</p></div>`);
const wlEsc=s=>String(s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const wlStatus=s=>String(s||'waiting').toLowerCase();
const wlDate=v=>{if(!v)return'—';const d=new Date(v);if(!isNaN(d.getTime()))return d.toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',hour12:true}).replace(',', '');return wlEsc(v);};
const wlGetName=r=>{const fn=r.firstName||r.first_name||'';const ln=r.lastName||r.last_name||'';const full=(fn+' '+ln).trim();return full||r.name||'Unknown';};
const wlGetId=r=>r.waitlistId||'';
const wlGetAdded=r=>r.timestamp||'';
const wlGetRows=r=>r.waitlist||[];
let waitlistRows=[];
const wlPill=(label,count,bg,fg)=>`<span style="display:inline-block;margin-right:8px;padding:4px 10px;border-radius:999px;background:${bg};color:${fg};font-weight:600;">${label}: ${count}</span>`;
function renderWaitlist(){
const filter=$('#imsda-wl-status').val();
const filtered=filter?waitlistRows.filter(r=>wlStatus(r.status)===filter):waitlistRows.slice();
const waitingCount=waitlistRows.filter(r=>wlStatus(r.status)==='waiting').length;
const promotedCount=waitlistRows.filter(r=>wlStatus(r.status)==='promoted').length;
const removedCount=waitlistRows.filter(r=>wlStatus(r.status)==='removed').length;
$('#imsda-wl-stats').html(wlPill('Waiting',waitingCount,waitingCount>0?'#fff4e5':'#f0f0f1',waitingCount>0?'#996800':'#50575e')+wlPill('Promoted',promotedCount,'#edfaef','#008a20')+wlPill('Removed',removedCount,'#f0f0f1','#50575e'));
$('#imsda-wl-count').text(`${filtered.length} result${filtered.length===1?'':'s'}`);
if(!filtered.length){ $('#imsda-wl-wrap').html('<p>No waitlist entries found for this filter.</p>'); return; }
let waitingPos=0;
const rowsHtml=filtered.map(r=>{const st=wlStatus(r.status);const isWaiting=st==='waiting';if(isWaiting) waitingPos++;const name=wlGetName(r);const email=r.email||'';const phone=r.phone||'—';const church=r.church||'—';const id=wlGetId(r);const pos=isWaiting?waitingPos:'—';const statusLabel=st==='promoted'?'<span style="color:#008a20;font-weight:600">Promoted</span>':(st==='removed'?'<span style="color:#646970;font-weight:600">Removed</span>':'<span style="color:#996800;font-weight:600">Waiting</span>');const actions=isWaiting?`<button class="button imsda-wl-promote" data-id="${wlEsc(id)}" data-name="${wlEsc(name)}">✅ Promote</button> <button class="button imsda-wl-remove" data-id="${wlEsc(id)}" data-name="${wlEsc(name)}">✕ Remove</button> <span class="imsda-wl-inline-err" style="color:#d63638;margin-left:6px;"></span>`:'—';return `<tr data-waitlist-id="${wlEsc(id)}"><td>${pos}</td><td><strong>${wlEsc(name)}</strong><br><small style="color:#646970">${wlEsc(email)}</small></td><td>${wlEsc(phone)}</td><td>${wlEsc(church)}</td><td>${wlDate(r.timestamp)}</td><td>${wlDate(r.promotedAt)}</td><td>${wlEsc(r.notes||'—')}</td><td>${statusLabel}</td><td>${actions}</td></tr>`;}).join('');
$('#imsda-wl-wrap').html(`<div style="overflow-x:auto"><table class="widefat striped" style="min-width:720px;"><thead><tr><th>Position</th><th>Name / Email</th><th>Phone</th><th>Church</th><th>Added</th><th>Promoted</th><th>Notes</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>`);
}
function loadWaitlist(){
$('#imsda-wl-wrap').html('<p>Loading…</p>');
$.post(ajaxurl,{action:'imsda_reg_admin_action',nonce:nonce,imsda_action:'getWaitlist',event_slug:slug,status:$('#imsda-wl-status').val()}).done(function(r){
if(!(r&&r.success)){ $('#imsda-wl-wrap').html(`<p style="color:#d63638;">${wlEsc(r?.data?.message||'Failed to load waitlist.')}</p>`); return; }
waitlistRows=wlGetRows(r);
renderWaitlist();
}).fail(function(){ $('#imsda-wl-wrap').html('<p style="color:#d63638;">Failed to load waitlist.</p>');});
}
$('#imsda-wl-refresh').on('click',loadWaitlist);
$('#imsda-wl-status').on('change',function(){renderWaitlist();});
app.on('click','.imsda-wl-promote',function(){
const $btn=$(this),$row=$btn.closest('tr'),id=$btn.data('id'),name=$btn.data('name')||'Registrant',$err=$row.find('.imsda-wl-inline-err');
if(!confirm(`Promote ${name} from the waitlist to a confirmed registration? A confirmation email will be sent to them.`)) return;
$err.text(''); const originalText=$btn.text(); $btn.prop('disabled',true).text('Promoting…');
$.post(ajaxurl,{action:'imsda_reg_admin_action',nonce:nonce,imsda_action:'promoteWaitlist',event_slug:slug,waitlist_id:id}).done(function(resp){
if(resp&&resp.success){
const newId=resp?.data?.newRegistrationId||resp?.data?.new_registration_id||'';
$('#imsda-wl-notice').html(`<div class="notice notice-success inline"><p>✅ ${wlEsc(name)} promoted. Confirmation email sent.${newId?` New registration ID: ${wlEsc(newId)}`:''}</p></div>`);
setTimeout(function(){$('#imsda-wl-notice').empty();},5000);
loadWaitlist();
}else{$btn.prop('disabled',false).text(originalText);$err.text(resp?.data?.message||'Promotion failed.');}
}).fail(function(){$btn.prop('disabled',false).text(originalText);$err.text('Promotion failed.');});
});
app.on('click','.imsda-wl-remove',function(){
const $btn=$(this),$row=$btn.closest('tr'),id=$btn.data('id'),name=$btn.data('name')||'Registrant',$err=$row.find('.imsda-wl-inline-err');
if(!confirm(`Remove ${name} from the waitlist? They will be notified by email if configured. This cannot be undone.`)) return;
$err.text(''); $btn.prop('disabled',true);
$.post(ajaxurl,{action:'imsda_reg_admin_action',nonce:nonce,imsda_action:'removeWaitlist',event_slug:slug,waitlist_id:id}).done(function(resp){
if(resp&&resp.success){ $row.remove(); waitlistRows=waitlistRows.filter(x=>String(wlGetId(x))!==String(id)); renderWaitlist(); }
else {$btn.prop('disabled',false);$err.text(resp?.data?.message||'Remove failed.');}
}).fail(function(){$btn.prop('disabled',false);$err.text('Remove failed.');});
});
loadWaitlist();
}
if(page==='imsda-reg-checkin') app.html(`<h2 class='nav-tab-wrapper ims-tabs'><a href='#' class='nav-tab nav-tab-active' data-tab='manual'>Manual Check-In</a><a href='#' class='nav-tab' data-tab='stats'>Stats</a><a href='#' class='nav-tab' data-tab='recent'>Recent Check-Ins</a></h2>
<div class='ims-tab active' data-name='manual'><p><input id='imsda-ci-search' class='regular-text' placeholder='Search name, email, or church…'> <button class='button' id='imsda-ci-run'>Search</button></p><div id='imsda-ci-results'></div></div>
<div class='ims-tab' data-name='stats'><p><button class='button' id='imsda-ci-refresh-stats'>Refresh Stats</button> <span id='imsda-ci-last'></span></p><div id='imsda-ci-stats'></div><div id='imsda-ci-church'></div></div>
<div class='ims-tab' data-name='recent'><p><button class='button' id='imsda-ci-refresh-recent'>Refresh</button></p><div id='imsda-ci-recent'></div></div>`);
const renderSearchRows=rows=>`<table class='widefat striped'><thead><tr><th>Name + email</th><th>Church</th><th>Payment status</th><th>Checked In</th><th>Actions</th></tr></thead><tbody>${rows.map(reg=>{const done=!!reg.checkedIn;const pay=['paid','paid_onsite'].includes(reg.paymentStatus||'')?'':`<button class='button imsda-ci-pay' data-id='${reg.registrationId}' data-bal='${reg.finalAmount||0}'>💲 Payment</button>`;return `<tr data-id='${reg.registrationId}'><td>${reg.firstName||''} ${reg.lastName||''}<br><small>${reg.email||''}</small></td><td>${reg.church||''}</td><td>${reg.paymentStatus||''}</td><td class='imsda-ci-time'>${reg.checkInTime||''}</td><td><button class='button imsda-ci-checkin' data-id='${reg.registrationId}' ${done?'disabled':''}>${done?'✅ Done':'✓ Check In'}</button> ${pay}<div class='imsda-ci-err' style='color:#b32d2e'></div></td></tr>`;}).join('')}</tbody></table>`;
const searchAndDisplay=()=>ajax('searchRegistrations',{q:$('#imsda-ci-search').val()},r=>{$('#imsda-ci-results').html(renderSearchRows((r.registrations||[])));});
const loadStats=()=>ajax('getCheckInStats',{},r=>{const reg=parseInt((r.stats.total||0),10),inC=parseInt((r.stats.checkedIn||0),10),ny=parseInt((r.stats.notCheckedIn||0),10),pct=String((r.stats.percent||0)+'%'),pending=parseInt((r.stats.paymentsPending||0),10);const pctNum=parseInt(r.stats.percent||0,10);const pcol=pctNum>=80?'#00a32a':(pctNum>=50?'#dba617':'#d63638');$('#imsda-ci-stats').html(`<div style='display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px'><div class='imsda-stat-card'><span class='imsda-stat-label'>Total Registered</span><span class='imsda-stat-value'>${reg}</span></div><div class='imsda-stat-card'><span class='imsda-stat-label'>Checked In</span><span class='imsda-stat-value' style='color:#00a32a'>${inC}</span></div><div class='imsda-stat-card'><span class='imsda-stat-label'>Not Yet</span><span class='imsda-stat-value' style='color:${ny>0?'#d63638':'#646970'}'>${ny}</span></div><div class='imsda-stat-card'><span class='imsda-stat-label'>Check-In %</span><span class='imsda-stat-value' style='color:${pcol}'>${pct}</span></div><div class='imsda-stat-card'><span class='imsda-stat-label'>Payments Pending</span><span class='imsda-stat-value' style='color:${pending>0?'#dba617':'#00a32a'}'>${pending}</span></div></div>`);var byChurch=r.byChurch||[];$('#imsda-ci-church').html(`<table class='widefat striped' style='margin-top:12px'><thead><tr><th>Church</th><th>Registered</th><th>Checked In</th><th>%</th></tr></thead><tbody>${byChurch.map(c=>{const cp=Math.round((c.checkedIn/(c.total||1))*100);const cc=cp>=80?'#00a32a':(cp>=50?'#dba617':'#d63638');return `<tr><td>${c.church||''}</td><td>${c.total||0}</td><td>${c.checkedIn||0}</td><td style='color:${cc};font-weight:600'>${cp}%</td></tr>`;}).join('')}</tbody></table>`);$('#imsda-ci-last').text('Last updated: '+(new Date()).toLocaleTimeString());});
const loadRecent=()=>ajax('getRecentCheckIns',{},r=>{const rows=(r.checkIns||[]);$('#imsda-ci-recent').html(`<table class='widefat striped'><thead><tr><th>Time</th><th>Name</th><th>Church</th><th>Method</th><th>Admin/Device</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${x.timestamp||''}</td><td>${x.name||''}</td><td>${x.church||''}</td><td>${x.method||''}</td><td>${x.adminUser||''}</td></tr>`).join('')}</tbody></table>`);});
app.on('click','.ims-tabs .nav-tab',function(e){e.preventDefault();$('.ims-tabs .nav-tab').removeClass('nav-tab-active');$(this).addClass('nav-tab-active');$('.ims-tab').removeClass('active');$(`.ims-tab[data-name='${$(this).data('tab')}']`).addClass('active');});
app.on('keypress','#imsda-ci-search',e=>{if(e.which===13){e.preventDefault();searchAndDisplay();}}).on('click','#imsda-ci-run',searchAndDisplay).on('click','.imsda-ci-checkin',function(){const $b=$(this),id=$b.data('id');ajax('checkinById',{registration_id:id},r=>{if(r&&r.success){$b.prop('disabled',true).text('✅ Done');$b.closest('tr').find('.imsda-ci-time').text((new Date()).toLocaleTimeString());}else{$b.siblings('.imsda-ci-err').text((r&&r.data&&r.data.message)?r.data.message:'Check-in failed');}});}).on('click','.imsda-ci-pay',function(){window.imsda_open_payment_modal($(this).data('id'),$(this).data('bal'));}).on('click','#imsda-ci-refresh-stats',loadStats).on('click','#imsda-ci-refresh-recent',loadRecent);
$(document).on('click','#imsda-copy-url',function(){navigator.clipboard.writeText($('#imsda-pwa-url').val()||'');}).on('click','#imsda-copy-token',function(){navigator.clipboard.writeText(app.data('token')||'');}).on('click','#imsda-change-pin',function(){$('#imsda-change-pin-wrap').show();})
.on('click','#imsda-generate-token,#imsda-regenerate-token',function(){if(this.id==='imsda-regenerate-token'&&!confirm('Regenerate check-in token? Anyone currently using the PWA will need the new token to continue.')) return;ajax('generateCheckinToken',{},function(){location.reload();});})
.on('click','#imsda-set-pin',function(){const pin=$('#imsda-checkin-pin-input').val();ajax('setCheckinPin',{pin:pin},function(r){if(r&&r.success){location.reload();}else{alert((r&&r.data&&r.data.message)?r.data.message:'PIN error');}});});
searchAndDisplay();loadStats();loadRecent();setInterval(()=>{if($(".ims-tab[data-name='stats']").hasClass('active')) loadStats();},60000);setInterval(()=>{if($(".ims-tab[data-name='recent']").hasClass('active')) loadRecent();},30000);
if(page==='imsda-reg-rosters'){
const selectedEvent=(events&&slug&&events[slug])?events[slug]:null;
if(!selectedEvent){ app.html('<h1>Church Rosters</h1><p>Please select an event.</p>'); return; }
app.html(`<style>@media print {#wpcontent > *:not(#wpbody) { display: none; } .wrap > h1, .wrap > .nav-tab-wrapper, #imsda-event-switcher-wrap, #imsda-roster-load, #imsda-roster-print, #imsda-roster-filter, .notice { display: none !important; } .imsda-roster-card { border: 1px solid #999 !important; margin-bottom: 24px !important; page-break-inside: avoid !important; } body { font-size: 11px; } table { font-size: 10px; }}</style><h1>Church Rosters</h1><div id="imsda-roster-notice"></div><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:16px;"><button class="button button-primary" id="imsda-roster-load">↺ Load Rosters</button><button class="button" id="imsda-roster-print">🖨 Print</button><input type="text" id="imsda-roster-filter" placeholder="Filter by church name…" style="min-width:200px"></div><div id="imsda-roster-summary" style="color:#646970;font-size:.9em;margin-bottom:12px;"></div><div id="imsda-rosters-wrap">Click Load Rosters to view church-by-church attendance.</div>`);
if(!selectedEvent.feature_church_rosters){
const safeName=String(selectedEvent.name||slug).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
$('#imsda-roster-notice').html(`<div class="notice notice-warning inline"><p>Church Rosters are not enabled for this event. Enable in Events → ${safeName} → Features.</p></div>`);
return;
}
let allRosters=[];
const rsEsc=s=>String(s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const fmtMoney=v=>{const n=parseFloat(v||0); return isNaN(n)?'$0.00':`$${n.toFixed(2)}`;};
const payColor=s=>({paid:'#008a20',paid_onsite:'#008a20',pending_check:'#dba617',pending_pay_later:'#dba617',unpaid:'#d63638',refunded:'#646970'}[String(s||'').toLowerCase()]||'#646970');
const statusLabel=s=>{const k=String(s||'').toLowerCase(); if(k==='paid') return 'Paid'; if(k==='paid_onsite') return 'Paid Onsite'; if(k==='pending_check') return 'Pending Check'; if(k==='pending_pay_later') return 'Pending Pay Later'; if(k==='unpaid') return 'Unpaid'; if(k==='refunded') return 'Refunded'; return s||'—';};
function updateSummary(rosters){
const churches=Array.isArray(rosters)?rosters.length:0;
const total=(Array.isArray(rosters)?rosters:[]).reduce((sum,r)=>sum+(Array.isArray(r.members)?r.members.length:0),0);
$('#imsda-roster-summary').text(`${churches} churches | ${total} total registrations`);
}
function renderRosters(rosters){
const q=String($('#imsda-roster-filter').val()||'').toLowerCase().trim();
const source=Array.isArray(rosters)?rosters:[];
const filtered=q?source.filter(r=>String(r&&r.name||'').toLowerCase().indexOf(q)!==-1):source;
if(!filtered.length&&q){ $('#imsda-rosters-wrap').html(`<p>No churches match '${rsEsc(q)}'.</p>`); return; }
if(!filtered.length){ $('#imsda-rosters-wrap').html('<p>No church roster data found.</p>'); return; }
const html=filtered.map(church=>{const name=rsEsc(church&&church.name||'Unnamed Church');const members=Array.isArray(church&&church.members)?church.members:[];const checked=members.filter(m=>!!m.checkedIn).length;const hasCheckin=checked>0;const pct=members.length?Math.round((checked/members.length)*100):0;const header=`<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;"><div><span style="font-size:1.1em;font-weight:600">${name}</span> <span style="color:#646970">(${members.length} registered)</span></div>${hasCheckin?`<div style="display:flex;align-items:center;gap:8px;color:#1d2327;"><span>${checked} / ${members.length} checked in</span><span style="display:inline-block;width:100px;height:6px;background:#dde1e7;border-radius:999px;overflow:hidden;vertical-align:middle;"><i style="display:block;height:6px;width:${pct};background:#00a32a;"></i></span></div>`:''}</div>`;if(!members.length){return `<div class="imsda-roster-card" style="background:#fff;border:1px solid #ccd0d4;border-radius:4px;padding:14px 18px;margin-bottom:20px;page-break-inside:avoid;">${header}<p style="margin-top:10px;">No active registrations.</p></div>`;}const rows=members.map(m=>{const fullName=rsEsc(`${m.firstName||''} ${m.lastName||''}`.trim());const phone=rsEsc(m.phone||'');const ps=rsEsc(m.paymentStatus||'');const amount=parseFloat(m.finalAmount||0);const arrival=rsEsc(m.arrivalDate||'—');const departure=rsEsc(m.departureDate||'—');const checkTime=m.checkedIn?`✅ ${rsEsc(m.checkInTime||'')}`:'—';return `<tr><td><strong>${fullName||'—'}</strong></td><td><small style="color:#646970;">${phone||'—'}</small></td><td><span style="color:${payColor(ps)};font-weight:600;">${rsEsc(statusLabel(ps))}</span></td><td>${amount>0?rsEsc(fmtMoney(amount)):'—'}</td><td>${arrival} | ${departure}</td><td>${checkTime}</td></tr>`;}).join('');return `<div class="imsda-roster-card" style="background:#fff;border:1px solid #ccd0d4;border-radius:4px;padding:14px 18px;margin-bottom:20px;page-break-inside:avoid;">${header}<table class="widefat striped" style="margin-top:10px;"><thead><tr><th>Name</th><th>Phone</th><th>Payment Status</th><th>Amount</th><th>Arrival | Departure</th><th>Checked In</th></tr></thead><tbody>${rows}</tbody></table></div>`;}).join('');
$('#imsda-rosters-wrap').html(html);
}
function filterRosters(){
const q=String($('#imsda-roster-filter').val()||'').toLowerCase().trim();
const filtered=q?allRosters.filter(r=>String(r&&r.name||'').toLowerCase().indexOf(q)!==-1):allRosters;
renderRosters(filtered);
}
function normalizeRosters(rosters){
if(Array.isArray(rosters)) return rosters;
if(!Array.isArray(rosters)&&rosters&&typeof rosters==='object'){
rosters=Object.keys(rosters).sort().map(function(k){
return { name: k, members: rosters[k] };
});
}
return Array.isArray(rosters)?rosters:[];
}
function loadRosters(){
$('#imsda-rosters-wrap').html('<p>Loading…</p>');
$.post(ajaxurl,{action:'imsda_reg_admin_action',nonce:nonce,imsda_action:'getChurchRosters',event_slug:slug}).done(function(r){
if(!(r&&r.success)){ $('#imsda-rosters-wrap').html(`<p style="color:#d63638;">${rsEsc(r?.data?.message||'Failed to load rosters.')}</p>`); return; }
var rosters=r.rosters||[];
allRosters=normalizeRosters(rosters);
renderRosters(allRosters);
updateSummary(allRosters);
}).fail(function(){$('#imsda-rosters-wrap').html('<p style="color:#d63638;">Failed to load rosters.</p>');});
}
$('#imsda-roster-load').on('click',loadRosters);
$('#imsda-roster-print').on('click',function(){window.print();});
$('#imsda-roster-filter').on('input',filterRosters);
}
if(page==='imsda-reg-promo'){
const selectedEvent=(events&&slug&&events[slug])?events[slug]:null;
if(!selectedEvent){ app.html('<h1>Promo Codes</h1><p>Please select an event.</p>'); return; }
if(!selectedEvent.feature_promo_codes){
const promoEsc=s=>String(s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
app.html(`<h1>Promo Codes</h1><div class="notice notice-warning inline"><p>Promo Codes are not enabled for this event. Enable in Events → ${promoEsc(selectedEvent.name||slug)} → Features.</p></div>`);
return;
}
app.html(`<h1>Promo Codes</h1><div style="display:flex;gap:8px;margin-bottom:16px;"><button class="button button-primary" id="imsda-promo-new">+ New Promo Code</button><button class="button" id="imsda-promo-refresh">↺ Refresh</button></div><div id="imsda-promo-form-panel" style="display:none;background:#fff;border:1px solid #ccd0d4;border-radius:4px;padding:20px;max-width:580px;margin-bottom:20px;"><h3 id="imsda-promo-form-title" style="margin-top:0">New Promo Code</h3><table class="form-table"><tbody><tr><th scope="row"><label for="imsda-promo-code">Code *</label></th><td><input type="text" id="imsda-promo-code" placeholder="e.g. HALFRETREAT" style="text-transform:uppercase;letter-spacing:0.05em" /><p class="description">Registrants type this exactly at checkout.</p></td></tr><tr><th scope="row"><label for="imsda-promo-desc">Description</label></th><td><input type="text" id="imsda-promo-desc" class="regular-text" placeholder="e.g. Half-off Early Bird" /></td></tr><tr><th scope="row"><label for="imsda-promo-type">Discount Type</label></th><td><select id="imsda-promo-type"><option value="percent">Percent (% off)</option><option value="fixed">Fixed Amount ($ off)</option></select></td></tr><tr><th scope="row"><label for="imsda-promo-amount">Discount Amount *</label></th><td><input type="number" id="imsda-promo-amount" step="0.01" min="0" /> <span id="imsda-promo-amount-suffix">%</span></td></tr><tr><th scope="row"><label for="imsda-promo-max">Max Uses</label></th><td><input type="number" id="imsda-promo-max" min="0" value="0" /><p class="description">0 = unlimited uses.</p></td></tr><tr><th scope="row"><label for="imsda-promo-min">Min Purchase ($)</label></th><td><input type="number" id="imsda-promo-min" step="0.01" min="0" value="0" /><p class="description">Registration must cost at least this amount to use the code. Set to 0 for no minimum.</p></td></tr><tr><th scope="row"><label for="imsda-promo-expiry">Expiry Date</label></th><td><input type="date" id="imsda-promo-expiry" /><p class="description">Leave blank for no expiry.</p></td></tr><tr><th scope="row"><label for="imsda-promo-active">Active</label></th><td><select id="imsda-promo-active"><option value="true" selected>✅ Yes (active)</option><option value="false">❌ No</option></select></td></tr></tbody></table><span id="imsda-promo-form-status" style="color:#d63638;display:block;margin-top:8px;"></span><p><button class="button button-primary" id="imsda-promo-save">Save Code</button> <button class="button" id="imsda-promo-cancel">Cancel</button></p></div><div id="imsda-promo-notice" style="margin-bottom:12px;"></div><div id="imsda-promo-summary" style="color:#646970;font-size:.9em;margin-bottom:10px;"></div><div id="imsda-promos-wrap">Loading promo codes…</div>`);
const pEsc=s=>String(s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const resetPromoForm=()=>{$('#imsda-promo-code').val('');$('#imsda-promo-desc').val('');$('#imsda-promo-type').val('percent');$('#imsda-promo-amount').val('');$('#imsda-promo-max').val(0);$('#imsda-promo-min').val(0);$('#imsda-promo-expiry').val('');$('#imsda-promo-active').val('true');$('#imsda-promo-amount-suffix').text('%');$('#imsda-promo-form-status').text('');};
const renderPromoTable=rows=>{const list=Array.isArray(rows)?rows:[];const total=list.length;const activeCount=list.filter(r=>String(r.active)==='true'||r.active===true).length;const totalUses=list.reduce((sum,r)=>sum+(parseInt(r.currentUses||0,10)||0),0);$('#imsda-promo-summary').text(`Total codes: ${total} | Active: ${activeCount} | Total uses: ${totalUses}`);if(!list.length){$('#imsda-promos-wrap').html('<p>No promo codes yet. Create one using the button above.</p>');return;}const today=new Date();today.setHours(0,0,0,0);const rowsHtml=list.map(r=>{const code=pEsc(r.code||'');const desc=r.description?pEsc(r.description):'<span style="color:#646970;">—</span>';const type=String(r.discountType||'percent').toLowerCase();const amount=parseFloat(r.discountAmount||0);const discount=type==='percent'?(r.discountAmount+'%'):('$'+parseFloat(r.discountAmount||0).toFixed(2));const min=parseFloat(r.minPurchase||0);const minCell=min>0?`$${min.toFixed(2)}`:'—';const current=parseInt(r.currentUses||0,10)||0;const max=parseInt(r.maxUses||0,10)||0;const maxed=max>0&&current>=max;const uses=`<span style="${maxed?'color:#d63638;font-weight:600;':''}">${(r.currentUses||0)} / ${(r.maxUses==0||r.maxUses==='0'?'∞':r.maxUses)}</span>`;const expRaw=String(r.expiryDate||'').trim();let expiry='<span style="color:#646970;">No expiry</span>';if(expRaw){const expDate=new Date(expRaw+'T00:00:00');const expired=!isNaN(expDate.getTime())&&expDate<today;expiry=`<span style="${expired?'color:#d63638;font-weight:600;':''}">${pEsc(expRaw)}</span>`;}const isActive=r.active===true||r.active==='TRUE'||r.active==='true';const active=isActive?'<span style="color:#008a20;">✅ Active</span>':'<span style="color:#646970;">❌ Inactive</span>';return `<tr data-code="${code}"><td><code style="font-size:1em;">${code}</code></td><td>${desc}</td><td>${discount}</td><td>${minCell}</td><td>${uses}</td><td>${expiry}</td><td>${active}</td><td><button class="button button-small imsda-promo-delete" data-code="${code}">Delete</button><span class="imsda-promo-inline-err" style="color:#d63638;margin-left:6px;"></span></td></tr>`;}).join('');$('#imsda-promos-wrap').html(`<table class="widefat striped"><thead><tr><th>Code</th><th>Description</th><th>Discount</th><th>Min Purchase</th><th>Uses</th><th>Expiry</th><th>Active</th><th>Actions</th></tr></thead><tbody>${rowsHtml}</tbody></table>`);};
const loadPromoCodes=()=>{$('#imsda-promos-wrap').html('<p>Loading promo codes…</p>');$.post(ajaxurl,{action:'imsda_reg_admin_action',nonce:nonce,imsda_action:'getPromoCodes',event_slug:slug}).done(function(r){if(!(r&&r.success)){$('#imsda-promos-wrap').html(`<p style="color:#d63638;">${pEsc(r?.data?.message||'Failed to load promo codes.')}</p>`);$('#imsda-promo-summary').text('');return;}var list=r.promoCodes||[];renderPromoTable(list);}).fail(function(){$('#imsda-promos-wrap').html('<p style="color:#d63638;">Failed to load promo codes.</p>');$('#imsda-promo-summary').text('');});};
$('#imsda-promo-new').on('click',function(){$('#imsda-promo-form-panel').toggle();$('#imsda-promo-form-status').text('');});
$('#imsda-promo-refresh').on('click',loadPromoCodes);
$('#imsda-promo-type').on('change',function(){$('#imsda-promo-amount-suffix').text($(this).val()==='fixed'?'$':'%');});
$('#imsda-promo-code').on('input',function(){const clean=String($(this).val()||'').replace(/[^a-z0-9]/gi,'').toUpperCase();$(this).val(clean);});
$('#imsda-promo-cancel').on('click',function(e){e.preventDefault();resetPromoForm();$('#imsda-promo-form-panel').hide();});
$('#imsda-promo-save').on('click',function(e){e.preventDefault();const code=String($('#imsda-promo-code').val()||'').trim().toUpperCase();const amount=parseFloat($('#imsda-promo-amount').val());if(!code||!/^[A-Z0-9]+$/.test(code)){$('#imsda-promo-form-status').text('Code is required and must contain only A-Z and 0-9.');return;}if(!(amount>0)){$('#imsda-promo-form-status').text('Discount amount must be greater than 0.');return;}$('#imsda-promo-form-status').text('');const payload={action:'imsda_reg_admin_action',nonce:nonce,imsda_action:'savePromoCode',event_slug:slug,code:code,description:$('#imsda-promo-desc').val(),discount_type:$('#imsda-promo-type').val(),discount_amount:amount,max_uses:parseInt($('#imsda-promo-max').val(),10)||0,min_purchase:parseFloat($('#imsda-promo-min').val())||0,expiry_date:$('#imsda-promo-expiry').val(),active:$('#imsda-promo-active').val()};$.post(ajaxurl,payload).done(function(resp){if(resp&&resp.success){resetPromoForm();$('#imsda-promo-form-panel').hide();loadPromoCodes();$('#imsda-promo-notice').html(`<div style="background:#edfaef;border:1px solid #6aa56a;padding:8px;border-radius:4px;">✅ Promo code ${pEsc(code)} saved.</div>`);setTimeout(function(){$('#imsda-promo-notice').empty();},4000);}else{$('#imsda-promo-form-status').text(resp?.data?.message||'Failed to save promo code.');}}).fail(function(){$('#imsda-promo-form-status').text('Failed to save promo code.');});});
app.on('click','.imsda-promo-delete',function(){const $btn=$(this),code=String($btn.data('code')||''),$err=$btn.siblings('.imsda-promo-inline-err');if(!confirm(`Delete promo code '${code}'? This marks it inactive and it can no longer be used. Usage history is preserved in the Google Sheet.`)) return;$btn.prop('disabled',true);$err.text('');$.post(ajaxurl,{action:'imsda_reg_admin_action',nonce:nonce,imsda_action:'deletePromoCode',event_slug:slug,code:code}).done(function(resp){if(resp&&resp.success){$btn.closest('tr').remove();loadPromoCodes();}else{$btn.prop('disabled',false);$err.text(resp?.data?.message||'Delete failed.');}}).fail(function(){$btn.prop('disabled',false);$err.text('Delete failed.');});});
loadPromoCodes();
}
});
</script>
<?php }
}
