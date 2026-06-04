<?php
/**
 * Plugin Name: WR26 Registration Portal
 * Description: Companion portal for the legacy WR26 Registration plugin. Adds magic-link registrant editing and a staff registration manager without replacing the working Fluent Forms intake flow.
 * Version: 0.1.0
 * Author: IMSDA
 */

if (!defined('ABSPATH')) {
    exit;
}

define('WR26_PORTAL_VERSION', '0.1.0');

function wr26p_gas_request($payload, $include_secret = true, $timeout = 30) {
    $url = esc_url_raw(get_option('wr26_gas_url', ''));
    if (!$url) {
        return array('success' => false, 'message' => 'Missing WR26 GAS URL. Configure WR26 → Settings first.');
    }

    if ($include_secret) {
        $payload['secret'] = get_option('wr26_gas_secret', '');
    }

    $payload['site'] = site_url();
    $payload['version'] = WR26_PORTAL_VERSION;

    $response = wp_remote_post($url, array(
        'timeout' => intval($timeout),
        'headers' => array('Content-Type' => 'application/json'),
        'body' => wp_json_encode($payload),
    ));

    if (is_wp_error($response)) {
        return array('success' => false, 'message' => $response->get_error_message());
    }

    $decoded = json_decode(wp_remote_retrieve_body($response), true);
    if (!is_array($decoded)) {
        return array('success' => false, 'message' => 'Invalid GAS response.');
    }

    return $decoded;
}

function wr26p_json_error($message, $status = 400) {
    wp_send_json(array('success' => false, 'message' => $message), $status);
}

function wr26p_request_ip() {
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    return sanitize_text_field($ip);
}

add_action('wp_ajax_nopriv_wr26p_request_magic_link', 'wr26p_ajax_request_magic_link');
add_action('wp_ajax_wr26p_request_magic_link', 'wr26p_ajax_request_magic_link');
function wr26p_ajax_request_magic_link() {
    $nonce = sanitize_text_field($_POST['nonce'] ?? '');
    if (!wp_verify_nonce($nonce, 'wr26p_public')) {
        wr26p_json_error('Security check failed.', 403);
    }

    $email = sanitize_email($_POST['email'] ?? '');
    if (!$email) {
        wr26p_json_error('Please enter a valid email address.');
    }

    $portal_url = esc_url_raw($_POST['portal_url'] ?? '');
    if (!$portal_url) {
        $portal_url = esc_url_raw(get_permalink());
    }

    $payload = array(
        'action' => 'portalRequestMagicLink',
        'email' => $email,
        'portalUrl' => $portal_url,
        'purpose' => 'registrant_edit',
        'requestIp' => wr26p_request_ip(),
    );

    wp_send_json(wr26p_gas_request($payload, false, 30));
}

add_action('wp_ajax_nopriv_wr26p_get_by_magic', 'wr26p_ajax_get_by_magic');
add_action('wp_ajax_wr26p_get_by_magic', 'wr26p_ajax_get_by_magic');
function wr26p_ajax_get_by_magic() {
    $nonce = sanitize_text_field($_POST['nonce'] ?? '');
    if (!wp_verify_nonce($nonce, 'wr26p_public')) {
        wr26p_json_error('Security check failed.', 403);
    }

    $token = sanitize_text_field($_POST['token'] ?? '');
    if (!$token) {
        wr26p_json_error('Missing registration link token.');
    }

    wp_send_json(wr26p_gas_request(array(
        'action' => 'portalGetRegistrationByMagicToken',
        'token' => $token,
    ), false, 30));
}

function wr26p_sanitize_attendees($raw) {
    if (is_string($raw)) {
        $raw = json_decode(stripslashes($raw), true);
    }
    if (!is_array($raw)) {
        return array();
    }

    $attendees = array();
    foreach (array_slice($raw, 0, 5) as $item) {
        if (!is_array($item)) {
            continue;
        }
        $prefs = isset($item['seminar_preferences']) && is_array($item['seminar_preferences']) ? $item['seminar_preferences'] : array();
        $safe_prefs = array();
        foreach ($prefs as $slot => $pref_group) {
            if (!is_array($pref_group)) {
                continue;
            }
            $safe_group = array();
            foreach ($pref_group as $key => $value) {
                $safe_group[sanitize_key($key)] = sanitize_text_field($value);
            }
            $safe_prefs[sanitize_key($slot)] = $safe_group;
        }

        $attendees[] = array(
            'attendee_id' => sanitize_text_field($item['attendee_id'] ?? ''),
            'first_name' => sanitize_text_field($item['first_name'] ?? ''),
            'last_name' => sanitize_text_field($item['last_name'] ?? ''),
            'phone' => sanitize_text_field($item['phone'] ?? ''),
            'email' => sanitize_email($item['email'] ?? ''),
            'church' => sanitize_text_field($item['church'] ?? ''),
            'attendee_type' => sanitize_text_field($item['attendee_type'] ?? ''),
            'meal_preference' => sanitize_text_field($item['meal_preference'] ?? ''),
            'dietary_needs' => sanitize_textarea_field($item['dietary_needs'] ?? ''),
            'childcare_needed' => sanitize_text_field($item['childcare_needed'] ?? ''),
            // Only keep a children count while childcare is actually requested, so turning
            // childcare off clears a stale number (mirrors the PWA portal + roster behavior).
            'childcare_children' => (strtolower(sanitize_text_field($item['childcare_needed'] ?? '')) === 'yes') ? sanitize_text_field($item['childcare_children'] ?? '') : '',
            'volunteer' => sanitize_text_field($item['volunteer'] ?? ''),
            'seminar_preferences' => $safe_prefs,
            'notes' => sanitize_textarea_field($item['notes'] ?? ''),
        );
    }

    return $attendees;
}

function wr26p_sanitize_public_fields($raw) {
    if (is_string($raw)) {
        $raw = json_decode(stripslashes($raw), true);
    }
    if (!is_array($raw)) {
        return array();
    }

    return array(
        'firstName' => sanitize_text_field($raw['firstName'] ?? ''),
        'lastName' => sanitize_text_field($raw['lastName'] ?? ''),
        'phone' => sanitize_text_field($raw['phone'] ?? ''),
        'church' => sanitize_text_field($raw['church'] ?? ''),
        'dietaryNeeds' => sanitize_textarea_field($raw['dietaryNeeds'] ?? ''),
        'emergencyContactName' => sanitize_text_field($raw['emergencyContactName'] ?? ''),
        'emergencyContactPhone' => sanitize_text_field($raw['emergencyContactPhone'] ?? ''),
        'specialNeeds' => sanitize_textarea_field($raw['specialNeeds'] ?? ''),
        'arrivalDate' => sanitize_text_field($raw['arrivalDate'] ?? ''),
        'departureDate' => sanitize_text_field($raw['departureDate'] ?? ''),
    );
}

add_action('wp_ajax_nopriv_wr26p_save_by_magic', 'wr26p_ajax_save_by_magic');
add_action('wp_ajax_wr26p_save_by_magic', 'wr26p_ajax_save_by_magic');
function wr26p_ajax_save_by_magic() {
    $nonce = sanitize_text_field($_POST['nonce'] ?? '');
    if (!wp_verify_nonce($nonce, 'wr26p_public')) {
        wr26p_json_error('Security check failed.', 403);
    }

    $token = sanitize_text_field($_POST['token'] ?? '');
    if (!$token) {
        wr26p_json_error('Missing registration link token.');
    }

    wp_send_json(wr26p_gas_request(array(
        'action' => 'portalSaveRegistrationByMagicToken',
        'token' => $token,
        'fields' => wr26p_sanitize_public_fields($_POST['fields'] ?? array()),
        'attendees' => wr26p_sanitize_attendees($_POST['attendees'] ?? array()),
    ), false, 45));
}

function wr26p_admin_guard() {
    if (!current_user_can('manage_options')) {
        wr26p_json_error('Unauthorized.', 403);
    }
    $nonce = sanitize_text_field($_POST['nonce'] ?? '');
    if (!wp_verify_nonce($nonce, 'wr26p_admin')) {
        wr26p_json_error('Security check failed.', 403);
    }
}

add_action('wp_ajax_wr26p_admin_search', function() {
    wr26p_admin_guard();
    wp_send_json(wr26p_gas_request(array(
        'action' => 'portalSearchRegistrations',
        'q' => sanitize_text_field($_POST['q'] ?? ''),
        'status' => sanitize_text_field($_POST['status'] ?? ''),
    ), true, 30));
});

add_action('wp_ajax_wr26p_admin_get_bundle', function() {
    wr26p_admin_guard();
    wp_send_json(wr26p_gas_request(array(
        'action' => 'portalGetRegistrationBundle',
        'registrationId' => sanitize_text_field($_POST['registration_id'] ?? ''),
    ), true, 30));
});

add_action('wp_ajax_wr26p_admin_save_bundle', function() {
    wr26p_admin_guard();
    wp_send_json(wr26p_gas_request(array(
        'action' => 'portalAdminSaveRegistration',
        'registrationId' => sanitize_text_field($_POST['registration_id'] ?? ''),
        'fields' => wr26p_sanitize_public_fields($_POST['fields'] ?? array()),
        'attendees' => wr26p_sanitize_attendees($_POST['attendees'] ?? array()),
        'adminUser' => wp_get_current_user()->user_email,
    ), true, 45));
});

add_shortcode('wr26_magic_link_request', function($atts) {
    $atts = shortcode_atts(array(
        'portal_url' => get_permalink(),
    ), $atts, 'wr26_magic_link_request');

    $ajax_url = esc_js(admin_url('admin-ajax.php'));
    $nonce = esc_js(wp_create_nonce('wr26p_public'));
    $portal_url = esc_js(esc_url_raw($atts['portal_url']));

    return '<div class="wr26p-card" style="max-width:680px;margin:0 auto;padding:22px;border:1px solid #ddd;border-radius:14px;background:#fff">'
        . '<h2 style="margin-top:0">Manage Your Women\'s Retreat Registration</h2>'
        . '<p>Enter the email used on your registration. We will send you a secure link to review or update your information.</p>'
        . '<label>Email<br><input id="wr26p-email" type="email" style="width:100%;padding:12px;border:1px solid #ccc;border-radius:8px"></label>'
        . '<p><button id="wr26p-request" type="button" style="background:#1a7efb;color:white;border:0;border-radius:8px;padding:12px 18px;font-weight:700">Send My Link</button></p>'
        . '<p id="wr26p-request-status"></p>'
        . '<script>jQuery(function($){$("#wr26p-request").on("click",function(){var b=$(this),s=$("#wr26p-request-status");b.prop("disabled",true).text("Sending…");s.text("");$.post("'.$ajax_url.'",{action:"wr26p_request_magic_link",nonce:"'.$nonce.'",email:$("#wr26p-email").val(),portal_url:"'.$portal_url.'"},function(r){s.text((r&&r.message)||"Check your email for your registration link.").css("color",(r&&r.success)?"#0a7f3f":"#b32d2e");}).fail(function(){s.text("Connection error. Please try again.").css("color","#b32d2e");}).always(function(){b.prop("disabled",false).text("Send My Link");});});});</script>'
        . '</div>';
});

function wr26p_portal_script($is_admin = false) {
    $ajax_url = esc_js(admin_url('admin-ajax.php'));
    $nonce = esc_js(wp_create_nonce($is_admin ? 'wr26p_admin' : 'wr26p_public'));
    $mode = $is_admin ? 'admin' : 'public';
    return '<script>window.WR26P={ajax:"'.$ajax_url.'",nonce:"'.$nonce.'",mode:"'.$mode.'"};</script>';
}

function wr26p_portal_ui($is_admin = false) {
    $admin_notice = $is_admin ? '<p style="color:#646970">Staff manager: search, open a registration, edit contact and attendee details, then save back to Google Sheets.</p>' : '<p style="color:#646970">Use the link from your email to review and update your registration details.</p>';
    $search_ui = $is_admin ? '<div id="wr26p-search-panel"><input id="wr26p-q" placeholder="Search name, email, or church" style="padding:10px;width:280px;max-width:100%;border:1px solid #ccc;border-radius:8px"> <button id="wr26p-search" type="button" class="wr26p-btn">Search</button><div id="wr26p-results"></div></div>' : '';

    return '<div id="wr26p-portal" style="max-width:1100px;margin:0 auto;font-family:system-ui,-apple-system,sans-serif">'
        . '<style>.wr26p-btn{background:#1a7efb;color:white;border:0;border-radius:8px;padding:10px 14px;font-weight:700;cursor:pointer}.wr26p-btn.secondary{background:#e5e7eb;color:#111}.wr26p-card{background:#fff;border:1px solid #ddd;border-radius:14px;padding:16px;margin:14px 0}.wr26p-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.wr26p-grid label{font-weight:700}.wr26p-grid input,.wr26p-grid textarea,.wr26p-grid select{width:100%;box-sizing:border-box;padding:10px;border:1px solid #ccc;border-radius:8px;margin-top:4px}.wr26p-attendee{border:1px solid #e5e7eb;border-radius:12px;padding:12px;margin:12px 0;background:#fafafa}.wr26p-row{cursor:pointer;padding:10px;border-bottom:1px solid #eee}.wr26p-row:hover{background:#f3f6ff}</style>'
        . '<h2>WR26 Registration Portal</h2>'.$admin_notice.$search_ui
        . '<div id="wr26p-status" class="wr26p-card">Loading…</div>'
        . '<div id="wr26p-editor" style="display:none"></div>'
        . '</div>'
        . wr26p_portal_script($is_admin)
        . '<script>
(function(){
const $=jQuery; let bundle=null; const qs=(s)=>document.querySelector(s); const esc=(s)=>String(s==null?"":s).replace(/[&<>"\']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","\'":"&#39;"}[c]));
function post(action,data){return $.post(WR26P.ajax,Object.assign({action,nonce:WR26P.nonce},data||{}));}
function status(msg,bad){$("#wr26p-status").show().text(msg).css("color",bad?"#b32d2e":"#1d2327");}
function getToken(){return new URL(location.href).searchParams.get("token")||"";}
function field(name,label,value,type){type=type||"text";return `<label>${label}<br>${type==="textarea"?`<textarea data-field="${name}" rows="2">${esc(value)}</textarea>`:`<input data-field="${name}" value="${esc(value)}">`}</label>`;}
function attendeeHtml(a,i){const prefs=a.seminar_preferences||{};function pref(slot,key){return esc((prefs[slot]&&prefs[slot][key])||"");}return `<div class="wr26p-attendee" data-i="${i}"><h4>Attendee ${i+1}</h4><div class="wr26p-grid"><label>First Name<br><input data-a="first_name" value="${esc(a.first_name)}"></label><label>Last Name<br><input data-a="last_name" value="${esc(a.last_name)}"></label><label>Phone<br><input data-a="phone" value="${esc(a.phone)}"></label><label>Email<br><input data-a="email" value="${esc(a.email)}"></label><label>Church<br><input data-a="church" value="${esc(a.church)}"></label><label>Adult/Child<br><input data-a="attendee_type" value="${esc(a.attendee_type)}"></label><label>Meal Preference<br><input data-a="meal_preference" value="${esc(a.meal_preference)}"></label><label>Childcare Needed<br><select data-a="childcare_needed" class="wr26p-cc-toggle"><option value="no"${String(a.childcare_needed).toLowerCase()==="yes"?"":" selected"}>No</option><option value="yes"${String(a.childcare_needed).toLowerCase()==="yes"?" selected":""}>Yes</option></select></label><label class="wr26p-cc-count" data-cc-count ${String(a.childcare_needed).toLowerCase()==="yes"?"":"hidden"}>How Many Children Need Care?<br><input type="number" min="1" step="1" inputmode="numeric" data-a="childcare_children" value="${esc(a.childcare_children)}"></label><label>Willing to Volunteer to Help?<br><select data-a="volunteer"><option value="no"${String(a.volunteer).toLowerCase()==="yes"?"":" selected"}>No</option><option value="yes"${String(a.volunteer).toLowerCase()==="yes"?" selected":""}>Yes</option></select></label><label>Dietary Needs<br><textarea data-a="dietary_needs" rows="2">${esc(a.dietary_needs)}</textarea></label><label>Notes<br><textarea data-a="notes" rows="2">${esc(a.notes)}</textarea></label></div><h5>Seminar Preferences</h5><div class="wr26p-grid"><label>Friday 4 PM Pref 1<br><input data-pref="session_1.pref_1" value="${pref("session_1","pref_1")}"></label><label>Friday 4 PM Pref 2<br><input data-pref="session_1.pref_2" value="${pref("session_1","pref_2")}"></label><label>Sat 2 PM Pref 1<br><input data-pref="session_2.pref_1" value="${pref("session_2","pref_1")}"></label><label>Sat 2 PM Pref 2<br><input data-pref="session_2.pref_2" value="${pref("session_2","pref_2")}"></label><label>Sat 3:30 Pref 1<br><input data-pref="session_3.pref_1" value="${pref("session_3","pref_1")}"></label><label>Sat 3:30 Pref 2<br><input data-pref="session_3.pref_2" value="${pref("session_3","pref_2")}"></label><label>Sunday 8:15<br><input data-pref="session_4.pref_1" value="${pref("session_4","pref_1")}"></label></div><input type="hidden" data-a="attendee_id" value="${esc(a.attendee_id)}"></div>`;}
function render(){const r=bundle.registration||{}, attendees=bundle.attendees||[];$("#wr26p-status").hide();$("#wr26p-editor").show().html(`<div class="wr26p-card"><h3>${esc(r.firstName)} ${esc(r.lastName)} <small>${esc(r.registrationId)}</small></h3><p><b>Payment:</b> ${esc(r.paymentStatus)} | <b>Balance/Final Amount:</b> $${esc(r.finalAmount)} | <b>Checked In:</b> ${esc(r.checkedIn)}</p><div class="wr26p-grid">${field("firstName","First Name",r.firstName)}${field("lastName","Last Name",r.lastName)}${field("phone","Phone",r.phone)}${field("church","Church",r.church)}${field("arrivalDate","Arrival Date",r.arrivalDate)}${field("departureDate","Departure Date",r.departureDate)}${field("emergencyContactName","Emergency Contact Name",r.emergencyContactName)}${field("emergencyContactPhone","Emergency Contact Phone",r.emergencyContactPhone)}${field("dietaryNeeds","Dietary Needs",r.dietaryNeeds,"textarea")}${field("specialNeeds","Special Needs",r.specialNeeds,"textarea")}</div></div><div class="wr26p-card"><h3>Attendees</h3><div id="wr26p-attendees">${attendees.map(attendeeHtml).join("")}</div><button type="button" class="wr26p-btn secondary" id="wr26p-add">Add Attendee</button></div><p><button type="button" class="wr26p-btn" id="wr26p-save">Save Changes</button></p>`);}
function collect(){const fields={};document.querySelectorAll("[data-field]").forEach(el=>fields[el.dataset.field]=el.value);const attendees=[];document.querySelectorAll(".wr26p-attendee").forEach(box=>{const a={seminar_preferences:{}};box.querySelectorAll("[data-a]").forEach(el=>a[el.dataset.a]=el.value);box.querySelectorAll("[data-pref]").forEach(el=>{const parts=el.dataset.pref.split(".");a.seminar_preferences[parts[0]]=a.seminar_preferences[parts[0]]||{};a.seminar_preferences[parts[0]][parts[1]]=el.value;});attendees.push(a);});return {fields,attendees};}
function loadPublic(){const token=getToken();if(!token){status("No token found. Use the link from your email or request a new one.",true);return;}status("Loading registration…");post("wr26p_get_by_magic",{token}).done(r=>{if(!r||!r.success){status((r&&r.message)||"Could not load registration.",true);return;}bundle=r;render();}).fail(()=>status("Connection error.",true));}
function loadBundle(id){status("Loading registration…");post("wr26p_admin_get_bundle",{registration_id:id}).done(r=>{if(!r||!r.success){status((r&&r.message)||"Could not load registration.",true);return;}bundle=r;render();}).fail(()=>status("Connection error.",true));}
$(document).on("click","#wr26p-add",function(){const count=document.querySelectorAll(".wr26p-attendee").length;if(count>=5){alert("Maximum 5 attendees.");return;}$("#wr26p-attendees").append(attendeeHtml({},count));});
$(document).on("click","#wr26p-save",function(){const data=collect();const btn=$(this).prop("disabled",true).text("Saving…");if(WR26P.mode==="admin"){post("wr26p_admin_save_bundle",{registration_id:bundle.registration.registrationId,fields:JSON.stringify(data.fields),attendees:JSON.stringify(data.attendees)}).done(doneSave).fail(()=>status("Connection error.",true)).always(()=>btn.prop("disabled",false).text("Save Changes"));}else{post("wr26p_save_by_magic",{token:getToken(),fields:JSON.stringify(data.fields),attendees:JSON.stringify(data.attendees)}).done(doneSave).fail(()=>status("Connection error.",true)).always(()=>btn.prop("disabled",false).text("Save Changes"));}});
function doneSave(r){if(!r||!r.success){status((r&&r.message)||"Save failed.",true);return;}bundle=r;render();status("Saved successfully.",false);}
$(document).on("click","#wr26p-search",function(){status("Searching…");post("wr26p_admin_search",{q:$("#wr26p-q").val()}).done(r=>{if(!r||!r.success){status((r&&r.message)||"Search failed.",true);return;}const rows=(r.registrations||[]).map(x=>`<div class="wr26p-row" data-id="${esc(x.registrationId)}"><b>${esc(x.firstName)} ${esc(x.lastName)}</b> <span>${esc(x.registrationId)}</span><br><small>${esc(x.email)} | ${esc(x.church)} | ${esc(x.paymentStatus)} | Attendees: ${esc(x.attendeeCount)}</small></div>`).join("");$("#wr26p-results").html(rows||"<p>No results.</p>");status("Search complete.");}).fail(()=>status("Connection error.",true));});
$(document).on("change",".wr26p-cc-toggle",function(){var box=$(this).closest(".wr26p-attendee").find(".wr26p-cc-count");if(String(this.value).toLowerCase()==="yes"){box.removeAttr("hidden");}else{box.attr("hidden","hidden").find("input").val("");}});
$(document).on("click",".wr26p-row",function(){loadBundle(this.dataset.id);});
if(WR26P.mode==="admin"){status("Search for a registration to begin.");}else{loadPublic();}
})();
</script>';
}

add_shortcode('wr26_registration_portal', function() {
    return wr26p_portal_ui(false);
});

add_shortcode('wr26_staff_registration_manager', function() {
    if (!current_user_can('manage_options')) {
        return '<p>You do not have permission to view this registration manager.</p>';
    }
    return wr26p_portal_ui(true);
});
