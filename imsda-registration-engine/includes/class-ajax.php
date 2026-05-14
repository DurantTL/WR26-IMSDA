<?php
if (!defined('ABSPATH')) { exit; }
class IMSDA_Reg_Ajax {
    public static function init(){
        foreach(['imsda_reg_get_availability'=>'getAvailability','imsda_reg_get_reg_by_token'=>'getRegistrationByEditToken','imsda_reg_save_edit'=>'editRegistrationByToken'] as $hook=>$action){ add_action('wp_ajax_nopriv_'.$hook,function() use($action){self::public_call($action);}); add_action('wp_ajax_'.$hook,function() use($action){self::public_call($action);}); }
        add_action('wp_ajax_imsda_reg_admin_action',[__CLASS__,'admin_action']);
    }
    private static function public_call($action){ $slug=sanitize_key($_POST['event_slug']??''); $payload=['action'=>$action]; if(isset($_POST['token'])) $payload['token']=sanitize_text_field(wp_unslash($_POST['token'])); if(isset($_POST['edit_token'])) $payload['edit_token']=sanitize_text_field(wp_unslash($_POST['edit_token'])); foreach(['first_name','last_name','phone','church','dietary_needs','emergency_contact_name','emergency_contact_phone','special_needs'] as $f){ if(isset($_POST[$f])) $payload[$f]=sanitize_text_field(wp_unslash($_POST[$f])); }
        wp_send_json(IMSDA_Reg_Dispatcher::gas_request($slug,$payload)); }
    public static function admin_action(){ if(!current_user_can('manage_options')) wp_send_json_error(['message'=>'Unauthorized']); if(!wp_verify_nonce($_POST['nonce']??'','imsda_reg_admin_nonce')) wp_send_json_error(['message'=>'Bad nonce']); $slug=sanitize_key($_POST['event_slug']??''); $a=sanitize_key($_POST['imsda_action']??'');
        if($a==='runQueue'){ IMSDA_Reg_Queue::process(); wp_send_json_success(['message'=>'Queue processed']); }
        if($a==='dismissFailed'){ wp_send_json_success(IMSDA_Reg_Queue::dismiss_failed(intval($_POST['index']??-1))); }
        if($a==='retryFailed'){ wp_send_json_success(IMSDA_Reg_Queue::retry_failed(intval($_POST['index']??-1))); }
        if($a==='saveEvent'){ $data=$_POST; if(isset($data['field_map']) && is_string($data['field_map'])) $data['field_map']=json_decode(wp_unslash($data['field_map']),true); $res=IMSDA_Reg_Event_Registry::save($slug?:($data['slug']??''),$data); is_wp_error($res)?wp_send_json_error(['message'=>$res->get_error_message()]):wp_send_json_success(); }
        if($a==='deleteEvent'){ wp_send_json_success(IMSDA_Reg_Event_Registry::delete($slug)); }
        if($a==='regenerateSecret'){
            $event = IMSDA_Reg_Event_Registry::get($slug);
            if(!$event) wp_send_json_error(['message'=>'Not found']);
            $new_secret = IMSDA_Reg_Event_Registry::generate_secret();
            IMSDA_Reg_Event_Registry::save($slug, ['gas_secret'=>$new_secret]);
            wp_send_json_success(['secret'=>$new_secret]);
        }
        if($a==='exportEvent'){
            $json = IMSDA_Reg_Event_Registry::export_event($slug);
            if(!$json) wp_send_json_error(['message'=>'Not found']);
            wp_send_json_success(['json'=>$json, 'filename'=>$slug.'-event-profile.json']);
        }
        if($a==='importEvent'){
            $json = '';
            if(!empty($_FILES['event_file']['tmp_name'])) $json = file_get_contents($_FILES['event_file']['tmp_name']);
            if(!$json) $json = wp_unslash($_POST['event_json'] ?? '');
            $preview = json_decode($json, true);
            if(!is_array($preview)) wp_send_json_error(['message'=>'Invalid JSON']);
            $preview_slug = sanitize_title($preview['slug'] ?? '');
            if($preview_slug && IMSDA_Reg_Event_Registry::get($preview_slug) && empty($_POST['confirm_overwrite'])){
                wp_send_json_error(['message'=>'Overwrite confirmation required', 'overwrite_required'=>true, 'slug'=>$preview_slug, 'name'=>sanitize_text_field($preview['name'] ?? $preview_slug)]);
            }
            $r = IMSDA_Reg_Event_Registry::import_event($json);
            $r['success'] ? wp_send_json_success($r) : wp_send_json_error($r);
        }
        if($a==='resetCounter'){
            $type = sanitize_text_field($_POST['type'] ?? '');
            if(!in_array($type, ['registered','waitlist'], true)) wp_send_json_error(['message'=>'Invalid counter type']);
            IMSDA_Reg_Event_Registry::reset_counter($slug,$type);
            wp_send_json_success();
        }

        if($a==='testConnection'){ $slug=sanitize_text_field($_POST['event_slug'] ?? ''); $result = IMSDA_Reg_Dispatcher::gas_request($slug,['action'=>'getAvailability']); if(!empty($result['success'])){ wp_send_json_success(['message'=>'Connected']); } else { wp_send_json_error(['message'=>$result['message'] ?? 'Connection failed']); } }
        $pass=['getRegistrations','adminEditRegistration','transferRegistration','getWaitlist','promoteWaitlist','removeWaitlist','checkinByToken','checkinById','searchRegistrations','getChurchRosters','getCheckInStats','getPromoCodes','savePromoCode','deletePromoCode','recordPayment'];
        if(in_array($a,$pass,true)){ $payload=$_POST; $payload['action']=$a; unset($payload['nonce']); wp_send_json(IMSDA_Reg_Dispatcher::gas_request($slug,$payload)); }
        wp_send_json_error(['message'=>'Unknown action']);
    }
}
