function doGet(e){return jsonResponse({status:'ok',version:'1.0.0',event:"Women's Retreat 2026"});}
function doPost(e){
  try{
    var cfg=getConfig()||{};
    var p=JSON.parse((e&&e.postData&&e.postData.contents)||'{}');
    var a=p.action;
    var pwaAllowed={validatePin:true,getAllRegistrations:true,recordCheckin:true,recordPayment:true,getCheckinStats:true,getRecentCheckIns:true};
    var publicPortalAllowed={portalRequestMagicLink:true,portalGetRegistrationByMagicToken:true,portalSaveRegistrationByMagicToken:true,portalTransferAttendeeByMagicToken:true};
    var hasSecret=!!p.secret;
    var authorizedBySecret=!!cfg.SECRET && hasSecret && p.secret===cfg.SECRET;
    var authorizedByCheckinToken=false;
    if(!hasSecret&&p.checkin_token&&cfg.CHECKIN_TOKEN&&String(p.checkin_token)===String(cfg.CHECKIN_TOKEN)&&pwaAllowed[a])authorizedByCheckinToken=true;
    var authorizedPublicPortal=!!publicPortalAllowed[a];
    if(!authorizedBySecret&&!authorizedByCheckinToken&&!authorizedPublicPortal){
      if(!cfg.SECRET&&!cfg.CHECKIN_TOKEN)return jsonResponse({success:false,message:'Unauthorized: no auth configured'});
      return jsonResponse({success:false,message:'Unauthorized'});
    }
    var res={success:false,message:'Unknown action'};
    if(a==='register')res=handleRegister(p); else if(a==='waitlist')res=handleWaitlist(p); else if(a==='getRegistrations')res={success:true,registrations:getAllRegistrations({status:p.status,search:p.q||p.search})}; else if(a==='adminEditRegistration')res=adminEditRegistration(p.registrationId,p.fields,p.adminUser); else if(a==='editRegistrationByToken')res=editRegistrationByToken(p.editToken||p.token,p.fields||{}); else if(a==='getRegistrationByEditToken'){var r=getRegistrationByEditToken(p.token||p.editToken);res=r?{success:true,registration:r}:{success:false,message:'Not found'};} else if(a==='transferRegistration')res=transferRegistration(p); else if(a==='transferAttendee')res=transferAttendee(p); else if(a==='portalTransferAttendeeByMagicToken')res=portalTransferAttendeeByMagicToken(p); else if(a==='getTransferLog')res=getTransferLog(); else if(a==='getWaitlist')res=getWaitlist(); else if(a==='promoteWaitlist')res=promoteWaitlist(p.waitlistId,p.adminUser,p.edit_page_url); else if(a==='removeWaitlist')res=removeWaitlist(p.waitlistId,p.adminUser); else if(a==='checkinByToken')res=checkinByToken(p.token,p.adminUser); else if(a==='checkinById')res=checkinById(p.registrationId,p.adminUser); else if(a==='searchRegistrations')res=searchRegistrationsActive(p.q); else if(a==='getAvailability')res=checkCapacity(); else if(a==='getChurchRosters')res={success:true,rosters:getChurchRosters()}; else if(a==='getCheckInStats' || a==='getCheckinStats')res=getCheckInStats(); else if(a==='recordPayment')res=recordPayment(p); else if(a==='getPromoCodes')res=getPromoCodes(); else if(a==='savePromoCode')res=savePromoCode(p.promo||p); else if(a==='deletePromoCode')res=deletePromoCode(p.code); else if(a==='validatePin')res=validatePin(p); else if(a==='getAllRegistrations')res=getAllRegistrationsPwa(p); else if(a==='recordCheckin')res=recordCheckin(p); else if(a==='getRecentCheckIns')res=getRecentCheckIns(p); else if(a==='getPaymentStats')res={success:true,stats:getPaymentStats()}; else if(a==='getPaymentsByStatus')res={success:true,registrations:getPaymentsByStatus(p.status||'')}; else if(a==='getCouponStats')res={success:true,coupons:getCouponStats()}; else if(a==='portalRequestMagicLink')res=portalRequestMagicLink(p); else if(a==='portalGetRegistrationByMagicToken')res=portalGetRegistrationByMagicToken(p); else if(a==='portalSaveRegistrationByMagicToken')res=portalSaveRegistrationByMagicToken(p); else if(a==='portalGetRegistrationBundle')res=portalGetRegistrationBundle(p.registrationId); else if(a==='portalAdminSaveRegistration')res=portalAdminSaveRegistration(p); else if(a==='portalSearchRegistrations')res=portalSearchRegistrations(p); else if(a==='portalGetCacheSnapshot')res=portalGetCacheSnapshot(p); else if(a==='recordSquareLinkPayment')res=recordSquareLinkPayment(p); else if(a==='recordRefund')res=recordRefund(p); else if(a==='getRefunds')res=getRefunds(); else if(a==='getSeminars')res=getSeminars(); else if(a==='saveSeminar')res=saveSeminar(p.seminar||p); else if(a==='deleteSeminar')res=deleteSeminar(p); else if(a==='assignSeminars')res=assignSeminars(p); else if(a==='getSeminarRoster')res=getSeminarRoster(p); else if(a==='getSeminarAvailability')res=getSeminarAvailability(); else if(a==='sendPendingChargeReminders')res=sendPendingChargeReminders(p); else if(a==='getStaffUsers')res=getStaffUsers(); else if(a==='saveStaffUser')res=saveStaffUser(p); else if(a==='deactivateStaffUser')res=deactivateStaffUser(p); else if(a==='staffRequestMagicLink')res=staffRequestMagicLink(p); else if(a==='staffValidateMagicToken')res=staffValidateMagicToken(p); else if(a==='workerRegister')res=handleWorkerRegistration(p); else if(a==='resendConfirmationEmail')res=resendConfirmationEmail(p); else if(a==='checkEntryProcessed')res=checkEntryProcessed(p);
    return jsonResponse(res);
  }catch(err){return jsonResponse({success:false,message:err.message});}
}

function normalizePaymentMethod(method){var m=String(method||'').toLowerCase().trim();if(!m)m=getConfig().PAYMENT_DEFAULT||'pay_later';if(m==='offline')return 'pay_later';if(m.indexOf('later')>-1)return 'pay_later';if(m.indexOf('square')>-1||m.indexOf('card')>-1||m.indexOf('credit')>-1)return 'square';if(m.indexOf('check')>-1)return 'check';if(m.indexOf('cash')>-1)return 'cash';return m;}
function parseAmountFromPayload(payload){var keys=['amount','total','payment_total','registration_total','final_amount','calculated_total','order_total'];for(var i=0;i<keys.length;i++){var raw=payload&&payload[keys[i]];if(raw===undefined||raw===null||raw==='')continue;var n=Number(String(raw).replace(/[$,]/g,''));if(!isNaN(n)&&n>0)return n;}return 0;}
function normalizeConfigDateEndOfDay(value,fallback){var raw=(value===undefined||value===null||value==='')?fallback:value;var d=null;if(raw instanceof Date&&!isNaN(raw.getTime())){d=new Date(raw.getFullYear(),raw.getMonth(),raw.getDate(),23,59,59,999);}else{var text=String(raw||'').trim();var m=text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);if(m){d=new Date(Number(m[1]),Number(m[2])-1,Number(m[3]),23,59,59,999);}else if(text){var parsed=new Date(text);if(!isNaN(parsed.getTime()))d=new Date(parsed.getFullYear(),parsed.getMonth(),parsed.getDate(),23,59,59,999);}}if((!d||isNaN(d.getTime()))&&fallback!==undefined&&fallback!==null&&fallback!==''&&raw!==fallback)return normalizeConfigDateEndOfDay(fallback);return d;}
function resolveRegistrationAmount(payload,attendeeCount,preferConfig,currentDate){if(!preferConfig){var detected=parseAmountFromPayload(payload);if(detected>0)return {amount:detected,source:'payload'};}var cfg=getConfig()||{};var ab=Number(attendeeCount||0);if(ab===0)return {amount:0,source:'none'};var today=currentDate?new Date(currentDate):new Date();var early=normalizeConfigDateEndOfDay(cfg.EARLY_BIRD_END_DATE,'2026-08-14');var regular=normalizeConfigDateEndOfDay(cfg.REGULAR_END_DATE,'2026-09-17');var currentPrice=0,source='unknown';if(early&&today<=early){currentPrice=Number(cfg.EARLY_BIRD_PRICE||125);source=ab>1?'config_early_bird_multi':'config_early_bird';}else if(regular&&today<=regular){currentPrice=Number(cfg.REGULAR_PRICE||145);source=ab>1?'config_regular_multi':'config_regular';}else{currentPrice=Number(cfg.REGULAR_PRICE||145);source=ab>1?'config_regular_after_deadline_multi':'config_regular';}
if(isNaN(currentPrice)||currentPrice<0)return {amount:null,source:'invalid_config'};return {amount:ab>1?ab*currentPrice:currentPrice,source:source,earlyBirdEndDate:early,regularEndDate:regular};}
function wr26DebugPricing(attendeeCount,asOfDate){var cfg=getConfig()||{};var early=normalizeConfigDateEndOfDay(cfg.EARLY_BIRD_END_DATE,'2026-08-14');var regular=normalizeConfigDateEndOfDay(cfg.REGULAR_END_DATE,'2026-09-17');var amountInfo=resolveRegistrationAmount({},attendeeCount||1,true,asOfDate);return {attendeeCount:Number(attendeeCount||1),asOfDate:asOfDate?new Date(asOfDate):new Date(),earlyBirdEndDate:early,regularEndDate:regular,earlyBirdPrice:Number(cfg.EARLY_BIRD_PRICE||125),regularPrice:Number(cfg.REGULAR_PRICE||145),amount:amountInfo.amount,source:amountInfo.source};}
function buildAttendees(payload,registrationId){var attendees=(payload&&payload.attendees)||[];
// The fallback below is a legacy safety net for payloads that arrive without an
// attendees array. In normal operation the WordPress plugin always populates
// payload.attendees from a{N}_* form fields, so this branch should never fire.
// It intentionally does NOT borrow name/phone from the primary contact because
// the primary contact (registration manager) may not be an attendee.
if(!Array.isArray(attendees)||!attendees.length){Logger.log('buildAttendees: no attendees array in payload for entry '+String(payload.entry_id||registrationId)+'; emitting empty-name placeholder.');attendees=[{attendee_id:'A-'+String(payload.entry_id||registrationId)+'-1',first_name:'',last_name:'',phone:'',email:payload.email||'',church:payload.church||'',attendee_type:'',meal_preference:'',dietary_needs:'',childcare_needed:'',childcare_children:'',volunteer:'',seminar_preferences:{}}];}
return attendees.map(function(a,idx){return {attendee_id:a.attendee_id||('A-'+registrationId+'-'+(idx+1)),first_name:a.first_name||'',last_name:a.last_name||'',phone:a.phone||'',email:a.email||'',church:a.church||'',attendee_type:a.attendee_type||'',meal_preference:a.meal_preference||'',dietary_needs:a.dietary_needs||'',childcare_needed:a.childcare_needed||'',childcare_children:a.childcare_children||'',volunteer:a.volunteer||'',seminar_preferences:a.seminar_preferences||{}};});}
function handleRegister(payload){try{
  var payloadAttendees=(payload&&payload.attendees)||[];var attendeeCount=Array.isArray(payloadAttendees)&&payloadAttendees.length?payloadAttendees.length:1;
  // Server-authoritative pricing: the owed amount is computed from Config pricing
  // (early-bird vs regular by date) x attendee count, NOT the form's client-side
  // total — that JS can drift after the early-bird deadline or with an unsynced promo.
  var amountInfo=resolveRegistrationAmount(payload,attendeeCount,true);
  if(amountInfo.amount===null||amountInfo.amount===undefined||isNaN(Number(amountInfo.amount)))return {success:false,message:'Unable to determine registration amount: '+amountInfo.source};
  // Critical section: duplicate guard + capacity check + write must be atomic so two
  // simultaneous submissions cannot both pass checkCapacity() and exceed CAPACITY.
  var locked=withScriptLock_(function(){
    if(isDuplicateEntry(payload.entry_id))return {success:true,duplicate:true};
    var cap=checkCapacity();
    if(!cap.success)return {success:false,message:'Capacity check failed: '+(cap.message||'Unknown error'),capacityCheckFailed:true};
    if(cap.full)return {success:false,message:'Capacity reached',capacityFull:true};
    var originalAmount=Number(amountInfo.amount||0),discount=0,promo='',amountPaid=null,couponUsed='',reconNote='';
    var isPaid=payload.payment_status==='paid';
    if(isPaid){
      // FF already charged the card. Record the actual amount charged, and reconcile
      // it against the server-computed expected base so drift is flagged for staff.
      amountPaid=Number(payload.amount_paid||0);couponUsed=String(payload.coupon_used||'');promo=couponUsed||String(payload.promo_code||'');discount=Math.max(originalAmount-amountPaid,0);
      // Only flag genuine underpayment with no coupon on record. Card payments
      // legitimately exceed the base by the processing fee, so overpayment is expected.
      if(!couponUsed&&(amountPaid-originalAmount)<-0.01)reconNote='[reconcile '+new Date().toISOString()+'] Charged $'+amountPaid+' is below expected base $'+originalAmount+' (no coupon recorded) — review.';
    }else if(payload.promo_code){
      var pr=validateAndApplyPromoCode(payload.promo_code,originalAmount);
      if(pr.valid){discount=Number(pr.discount||0);promo=payload.promo_code;}
    }
    var paymentMethod=normalizePaymentMethod(payload.payment_method||'');
    var paymentStatus;if(payload.payment_status==='paid'||payload.payment_status==='pending_offline'){paymentStatus=payload.payment_status;}else{paymentStatus='pending_pay_later';if(paymentMethod==='check')paymentStatus='pending_check';else if(paymentMethod==='square')paymentStatus='pending_square';else if(paymentMethod!=='pay_later')paymentStatus='pending_other';}
    var squarePaymentId=isPaid?(payload.square_charge_id||payload.square_payment_id||''):(payload.square_payment_id||'');
    var reg={registrationId:generateRegistrationId(),firstName:payload.first_name||'',lastName:payload.last_name||'',email:payload.email||'',phone:payload.phone||'',church:payload.church||'',arrivalDate:payload.arrival_date||'',departureDate:payload.departure_date||'',dietaryNeeds:payload.dietary_needs||'',emergencyContactName:payload.emergency_contact_name||'',emergencyContactPhone:payload.emergency_contact_phone||'',specialNeeds:payload.special_needs||'',promoCode:promo,discountAmount:discount,originalAmount:originalAmount,finalAmount:isPaid?amountPaid:Math.max(originalAmount-discount,0),paymentMethod:paymentMethod,paymentStatus:paymentStatus,squarePaymentId:squarePaymentId,ffEntryId:payload.entry_id||'',status:'active',transferNotes:'',checkedIn:false,checkInTime:'',checkInBy:'',qrToken:Utilities.getUuid(),editToken:Utilities.getUuid(),adminNotes:reconNote,amountPaid:amountPaid,couponUsed:couponUsed};
    var w=writeRegistration(reg);if(!w.success)return w;
    return {success:true,reg:reg};
  });
  if(!locked.success)return locked;
  if(locked.duplicate)return locked;
  var reg=locked.reg;
  // Non-critical follow-up work runs outside the lock so emails/attendee writes do
  // not serialize concurrent registrations.
  var attendees=buildAttendees(payload,reg.registrationId);
  var attendeeResult=writeAttendeesForRegistration(reg,attendees);
  var seminarResult=writeSeminarPreferencesForRegistration(reg,attendees);
  try{recomputeSeminarAssignedCounts_();}catch(e){Logger.log('seminar count refresh failed: '+e.message);}
  if(payload.worker_flag)Logger.log('Worker/non-paying flag received for '+reg.registrationId+': '+payload.worker_flag+'; use worker form URL: '+getConfig().WORKER_REGISTRATION_URL);
  var warnings=[attendeeResult.warning,seminarResult.warning].filter(Boolean);
  var emailResult=sendConfirmationEmail(reg,payload.edit_page_url||getConfig().EDIT_PAGE_URL,{attendees:attendees,warnings:warnings});
  if(emailResult&&emailResult.sent===false)warnings.push('Confirmation email not sent ('+(emailResult.reason||'unknown')+'); registration saved.');
  return {success:true,registrationId:reg.registrationId,warnings:warnings,message:'Your registration has been received. Your confirmation, payment details, and edit-registration link are below.'};
}catch(e){return {success:false,message:e.message};}}
function handleWaitlist(payload){try{if(isDuplicateWaitlistEntry(payload.entry_id))return {success:true,duplicate:true};var pos=getWaitlistPosition();var d={waitlistId:generateWaitlistId(),firstName:payload.first_name||'',lastName:payload.last_name||'',email:payload.email||'',phone:payload.phone||'',church:payload.church||'',ffEntryId:payload.entry_id||'',position:pos,notes:''};var w=writeWaitlistEntry(d);if(!w.success)return w;sendWaitlistEmail(d);return {success:true,waitlistId:d.waitlistId,position:pos};}catch(e){return {success:false,message:e.message};}}
