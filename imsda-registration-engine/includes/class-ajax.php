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

        if($a==='clearQueue'){
            update_option('imsda_reg_dispatch_queue', [], false);
            wp_send_json_success(['message' => 'Queue cleared']);
        }
        if($a==='clearFailed'){
            update_option('imsda_reg_failed_submissions', [], false);
            wp_send_json_success(['message' => 'Failed submissions cleared']);
        }
        if($a==='flushRules'){
            flush_rewrite_rules();
            wp_send_json_success(['message' => 'Rewrite rules flushed']);
        }
        if($a==='dismissFailed'){ wp_send_json_success(IMSDA_Reg_Queue::dismiss_failed(intval($_POST['index']??-1))); }
        if($a==='retryFailed'){ wp_send_json_success(IMSDA_Reg_Queue::retry_failed(intval($_POST['index']??-1))); }
        if($a==='saveEvent'){ $data=$_POST; if(isset($data['field_map']) && is_string($data['field_map'])) $data['field_map']=json_decode(wp_unslash($data['field_map']),true); $res=IMSDA_Reg_Event_Registry::save($slug?:($data['slug']??''),$data); is_wp_error($res)?wp_send_json_error(['message'=>$res->get_error_message()]):wp_send_json_success(); }
        if($a==='deleteEvent'){ wp_send_json_success(IMSDA_Reg_Event_Registry::delete($slug)); }
        if($a==='regenerateSecret'){
            $event = IMSDA_Reg_Event_Registry::get($slug);
            if(!$event) wp_send_json_error(['message'=>'Not found']);
            $new_secret = IMSDA_Reg_Event_Registry::generate_secret();
            $result = IMSDA_Reg_Event_Registry::update($slug, ['gas_secret'=>$new_secret]);
            if (is_wp_error($result)) wp_send_json_error(['message'=>$result->get_error_message()]);
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
            IMSDA_Reg_Event_Registry::update($slug, [$type . '_count' => 0]);
            wp_send_json_success();
        }
        if($a==='generateCheckinToken'){
            $token = IMSDA_Reg_Event_Registry::generate_checkin_token();
            $result = IMSDA_Reg_Event_Registry::update($slug, ['checkin_token'=>$token]);
            if (is_wp_error($result)) wp_send_json_error(['message'=>$result->get_error_message()]);
            wp_send_json_success(['token'=>$token]);
        }
        if($a==='setCheckinPin'){
            $pin = sanitize_text_field($_POST['pin'] ?? '');
            if(!preg_match('/^\d{4,6}$/', $pin)) wp_send_json_error(['message'=>'PIN must be 4-6 digits']);
            $result = IMSDA_Reg_Event_Registry::update($slug, ['checkin_pin'=>$pin]);
            if (is_wp_error($result)) wp_send_json_error(['message'=>$result->get_error_message()]);
            wp_send_json_success();
        }

        if($a==='testConnection'){ $slug=sanitize_text_field($_POST['event_slug'] ?? ''); $result = IMSDA_Reg_Dispatcher::gas_request($slug,['action'=>'getAvailability']); if(!empty($result['success'])){ wp_send_json_success(['message'=>'Connected']); } else { wp_send_json_error(['message'=>$result['message'] ?? 'Connection failed']); } }
        if($a==='getRegistrations'){ $payload=['action'=>'getRegistrations','event_slug'=>$slug,'q'=>sanitize_text_field(wp_unslash($_POST['q'] ?? $_POST['search'] ?? '')),'status'=>sanitize_key($_POST['status'] ?? '')]; wp_send_json(IMSDA_Reg_Dispatcher::gas_request($slug,$payload)); }
        if($a==='adminEditRegistration'){ $allowed_fields=['firstName','lastName','email','phone','church','arrivalDate','departureDate','dietaryNeeds','emergencyContactName','emergencyContactPhone','specialNeeds','promoCode','discountAmount','originalAmount','finalAmount','paymentMethod','paymentStatus','squarePaymentId','status','transferNotes','adminNotes']; $fields=[]; foreach((array)($_POST['fields'] ?? []) as $k=>$v){ if(is_string($k) && in_array($k,$allowed_fields,true)) $fields[$k]=sanitize_textarea_field(wp_unslash($v)); } $payload=['action'=>'adminEditRegistration','event_slug'=>$slug,'registrationId'=>sanitize_text_field(wp_unslash($_POST['registration_id'] ?? '')),'fields'=>$fields,'adminUser'=>wp_get_current_user()->user_login]; wp_send_json(IMSDA_Reg_Dispatcher::gas_request($slug,$payload)); }
        if($a==='transferRegistration'){ $payload=['action'=>'transferRegistration','event_slug'=>$slug,'registrationId'=>sanitize_text_field(wp_unslash($_POST['registration_id'] ?? '')),'newFirstName'=>sanitize_text_field(wp_unslash($_POST['new_first_name'] ?? '')),'newLastName'=>sanitize_text_field(wp_unslash($_POST['new_last_name'] ?? '')),'newEmail'=>sanitize_email(wp_unslash($_POST['new_email'] ?? '')),'newPhone'=>sanitize_text_field(wp_unslash($_POST['new_phone'] ?? '')),'newChurch'=>sanitize_text_field(wp_unslash($_POST['new_church'] ?? '')),'reason'=>sanitize_textarea_field(wp_unslash($_POST['reason'] ?? '')),'refundNotes'=>sanitize_textarea_field(wp_unslash($_POST['refund_notes'] ?? '')),'adminNotes'=>sanitize_textarea_field(wp_unslash($_POST['admin_notes'] ?? '')),'adminUser'=>wp_get_current_user()->user_login]; wp_send_json(IMSDA_Reg_Dispatcher::gas_request($slug,$payload)); }
        if($a==='recordPayment'){ $payload=['action'=>'recordPayment','event_slug'=>$slug,'registrationId'=>sanitize_text_field(wp_unslash($_POST['registration_id'] ?? '')),'paymentMethod'=>sanitize_text_field(wp_unslash($_POST['payment_method'] ?? '')),'amountPaid'=>floatval($_POST['amount_paid'] ?? 0),'checkNumber'=>sanitize_text_field(wp_unslash($_POST['check_number'] ?? '')),'paymentNotes'=>sanitize_textarea_field(wp_unslash($_POST['payment_notes'] ?? '')),'adminUser'=>wp_get_current_user()->user_login]; wp_send_json(IMSDA_Reg_Dispatcher::gas_request($slug,$payload)); }
        if($a==='getRecentCheckIns'){
            $payload=['action'=>'getRecentCheckIns','event_slug'=>$slug,'limit'=>50];
            wp_send_json(IMSDA_Reg_Dispatcher::gas_request($slug,$payload));
        }
        if($a==='getWaitlist'){
            $payload = [
                'action' => 'getWaitlist',
                'event_slug' => $slug,
                'status' => sanitize_text_field(wp_unslash($_POST['status'] ?? '')),
            ];
            wp_send_json(IMSDA_Reg_Dispatcher::gas_request($slug,$payload));
        }
        if($a==='promoteWaitlist'){
            $payload = [
                'action' => 'promoteWaitlist',
                'event_slug' => $slug,
                'waitlistId' => sanitize_text_field(wp_unslash($_POST['waitlist_id'] ?? '')),
                'adminUser' => wp_get_current_user()->user_login,
            ];
            wp_send_json(IMSDA_Reg_Dispatcher::gas_request($slug,$payload));
        }
        if($a==='removeWaitlist'){
            $payload = [
                'action' => 'removeWaitlist',
                'event_slug' => $slug,
                'waitlistId' => sanitize_text_field(wp_unslash($_POST['waitlist_id'] ?? '')),
                'adminUser' => wp_get_current_user()->user_login,
            ];
            wp_send_json(IMSDA_Reg_Dispatcher::gas_request($slug,$payload));
        }
        if($a==='getChurchRosters'){
            $payload = [
                'action' => 'getChurchRosters',
                'event_slug' => $slug,
            ];
            wp_send_json(IMSDA_Reg_Dispatcher::gas_request($slug,$payload));
        }
        if($a==='getPromoCodes'){
            $payload = [
                'action' => 'getPromoCodes',
                'event_slug' => $slug,
            ];
            wp_send_json(IMSDA_Reg_Dispatcher::gas_request($slug,$payload));
        }
        if($a==='savePromoCode'){
            $discount_type = sanitize_text_field(wp_unslash($_POST['discount_type'] ?? ''));
            if(!in_array($discount_type, ['percent','fixed'], true)) $discount_type = 'percent';
            $active = sanitize_text_field(wp_unslash($_POST['active'] ?? 'true'));
            if(!in_array($active, ['true','false'], true)) $active = 'true';
            $payload = [
                'action' => 'savePromoCode',
                'event_slug' => $slug,
                'code' => strtoupper(sanitize_text_field(wp_unslash($_POST['code'] ?? ''))),
                'description' => sanitize_text_field(wp_unslash($_POST['description'] ?? '')),
                'discountType' => $discount_type,
                'discountAmount' => floatval($_POST['discount_amount'] ?? 0),
                'maxUses' => intval($_POST['max_uses'] ?? 0),
                'minPurchase' => floatval($_POST['min_purchase'] ?? 0),
                'expiryDate' => sanitize_text_field(wp_unslash($_POST['expiry_date'] ?? '')),
                'active' => $active,
            ];
            wp_send_json(IMSDA_Reg_Dispatcher::gas_request($slug,$payload));
        }
        if($a==='deletePromoCode'){
            $payload = [
                'action' => 'deletePromoCode',
                'event_slug' => $slug,
                'code' => strtoupper(sanitize_text_field(wp_unslash($_POST['code'] ?? ''))),
            ];
            wp_send_json(IMSDA_Reg_Dispatcher::gas_request($slug,$payload));
        }
        $pass=['checkinByToken','checkinById','searchRegistrations','getChurchRosters','getCheckInStats'];
        if(in_array($a,$pass,true)){ $payload=$_POST; $payload['action']=$a; if(isset($payload['registration_id'])){ $payload['registrationId']=sanitize_text_field(wp_unslash($payload['registration_id'])); unset($payload['registration_id']); } unset($payload['nonce']); wp_send_json(IMSDA_Reg_Dispatcher::gas_request($slug,$payload)); }
        wp_send_json_error(['message'=>'Unknown action']);
    }
}
