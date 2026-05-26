<?php
if (!defined('ABSPATH')) { exit; }

class IMSDA_Reg_Event_Registry {
    public static function get_all() { $events = get_option('imsda_reg_events', []); return is_array($events) ? $events : []; }
    public static function get($slug) { $events = self::get_all(); $slug = sanitize_key($slug); return isset($events[$slug]) ? (object)$events[$slug] : null; }
    public static function generate_secret() { return wp_generate_password(32, false, false); }
    public static function generate_checkin_token() { return wp_generate_password(32, false, false); }
    public static function default_field_map() { return ["first_name"=>["first_name"],"last_name"=>["last_name"],"email"=>["email"],"phone"=>["phone"],"church"=>["church","home_church","church_name"],"arrival_date"=>["arrival_date","check_in"],"departure_date"=>["departure_date","check_out"],"dietary_needs"=>["dietary_needs","dietary","a1_dietary_needs"],"emergency_contact_name"=>["emergency_contact_name","emergency_name"],"emergency_contact_phone"=>["emergency_contact_phone","emergency_phone"],"special_needs"=>["special_needs","special_requests","notes"],"promo_code"=>["promo_code","discount_code","coupon_code","coupon"],"payment_method"=>["payment_method","payment","pay_method"],"attendee_count"=>["attendee_count"]]; }
    public static function save($slug, $data) {
        $slug = sanitize_title($slug ?: ($data['slug'] ?? ''));
        if (!$slug || !preg_match('/^[a-z0-9-]+$/', $slug)) return new WP_Error('bad_slug', 'Invalid slug');
        $events = self::get_all(); $existing = $events[$slug] ?? [];
        $secret = sanitize_text_field($data['gas_secret'] ?? '');
        if ($secret === '') $secret = sanitize_text_field($existing['gas_secret'] ?? self::generate_secret());
        $checkin_pin = sanitize_text_field($data['checkin_pin'] ?? ($existing['checkin_pin'] ?? ''));
        $item = array_merge($existing, [
            'slug'=>$slug,'name'=>sanitize_text_field($data['name'] ?? ''),'dates'=>sanitize_text_field($data['dates'] ?? ''),'location'=>sanitize_text_field($data['location'] ?? ''),
            'status'=>in_array(($data['status'] ?? 'inactive'),['active','inactive','closed'],true)?$data['status']:'inactive','gas_url'=>esc_url_raw($data['gas_url'] ?? ''),
            'gas_secret'=>$secret,'form_id'=>intval($data['form_id'] ?? 0),
            'checkin_token'=>sanitize_text_field($data['checkin_token'] ?? ($existing['checkin_token'] ?? '')),
            'checkin_pin'=>preg_match('/^\d{4,6}$/', $checkin_pin) ? $checkin_pin : '',
            'payment_default'=>sanitize_key($data['payment_default'] ?? 'pay_later'),'capacity'=>intval($data['capacity'] ?? 0),'waitlist_enabled'=>!empty($data['waitlist_enabled']),
            'early_bird_price'=>floatval($data['early_bird_price'] ?? 0),'early_bird_end_date'=>sanitize_text_field($data['early_bird_end_date'] ?? ''),'regular_price'=>floatval($data['regular_price'] ?? 0),
            'regular_end_date'=>sanitize_text_field($data['regular_end_date'] ?? ''),'edit_page_url'=>esc_url_raw($data['edit_page_url'] ?? ''),
            'feature_waitlist'=>!empty($data['feature_waitlist']),'feature_promo_codes'=>!empty($data['feature_promo_codes']),'feature_checkin'=>!empty($data['feature_checkin']),
            'feature_transfers'=>!empty($data['feature_transfers']),'feature_church_rosters'=>!empty($data['feature_church_rosters']),'feature_attendees'=>!empty($data['feature_attendees']),
            'field_map'=>is_array($data['field_map'] ?? null) ? $data['field_map'] : self::default_field_map(),'created_at'=>$existing['created_at'] ?? current_time('mysql'),'updated_at'=>current_time('mysql'),
            'created_by'=>$existing['created_by'] ?? wp_get_current_user()->user_login,
        ]);
        if (!$item['name'] || !$item['gas_url'] || !$item['form_id']) return new WP_Error('missing_fields', 'Missing required fields');
        $events[$slug] = $item; update_option('imsda_reg_events', $events, false); return true;
    }
    public static function update($slug, $fields){
        $all = self::get_all();
        if (!isset($all[$slug])) return new WP_Error('not_found', 'Event not found: ' . $slug);
        foreach ((array)$fields as $key => $value) $all[$slug][$key] = $value;
        $all[$slug]['updated_at'] = current_time('mysql');
        update_option('imsda_reg_events', $all, false);
        return true;
    }
    public static function delete($slug) {
        global $wpdb; $events = self::get_all(); unset($events[$slug]); update_option('imsda_reg_events', $events, false);
        delete_option("imsda_reg_{$slug}_registered_count"); delete_option("imsda_reg_{$slug}_waitlist_count");
        $like = $wpdb->esc_like("imsda_reg_pending_pay_{$slug}_") . '%';
        $rows = $wpdb->get_col($wpdb->prepare("SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE %s", $like));
        foreach ((array)$rows as $opt) delete_option($opt); IMSDA_Reg_Queue::clear_queue_for_event($slug); return true;
    }
    public static function get_by_form_id($form_id) { foreach (self::get_all() as $e) if (intval($e['form_id'] ?? 0)===intval($form_id)) return (object)$e; return null; }
    public static function increment_counter($slug,$type){$key="imsda_reg_{$slug}_{$type}_count"; $v=intval(get_option($key,0))+1; update_option($key,$v,false); return $v;}
    public static function get_counter($slug,$type){ return intval(get_option("imsda_reg_{$slug}_{$type}_count",0)); }
    public static function reset_counter($slug,$type){ update_option("imsda_reg_{$slug}_{$type}_count",0,false); return true; }
    public static function export_event($slug){ $e=self::get($slug); if(!$e) return ''; $arr=(array)$e; unset($arr['gas_secret'],$arr['registered_count'],$arr['waitlist_count']); $arr['_note']='GAS secret not exported. A new secret will be generated on import. Copy it to your GAS Config sheet.'; return wp_json_encode($arr, JSON_PRETTY_PRINT); }
    public static function import_event($json_string){ $data=json_decode(wp_unslash($json_string),true); if(!is_array($data)) return ['success'=>false,'message'=>'Invalid JSON']; unset($data['registered_count'],$data['waitlist_count']); $data['gas_secret']=self::generate_secret(); $slug=sanitize_title($data['slug']??''); $res=self::save($slug,$data); if(is_wp_error($res)) return ['success'=>false,'message'=>$res->get_error_message()]; return ['success'=>true,'slug'=>$slug,'gas_secret'=>$data['gas_secret']]; }
}
