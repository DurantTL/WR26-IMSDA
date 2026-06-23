// Group / Church registration — one coordinator registers a large party of
// attendees that pays together (one mailed check OR one card link) on a
// pay-later basis. This is a non-form intake path served by a dedicated /group/
// page on the PWA Node server (NOT Fluent Forms), so it mirrors Workers.gs: it
// builds the same Registrations / Attendees / SeminarPreferences rows through
// the shared write helpers and sends the standard confirmation email — which
// already embeds a single Square pay link for the whole group balance (or
// check-payment copy when Square is unconfigured).
//
// Differences from the worker path: a group is PAID, so it (a) respects venue
// capacity counted in PEOPLE (a group of N consumes N seats) and (b) is priced
// N x per-head via the same server-authoritative pricing as the main form.
// Per-lady details (meal, dietary, childcare, seminars) are typically blank at
// import and completed later by the coordinator via the portal magic link.

function handleGroupRegistration(payload){
  return withScriptLock_(function(){
    try{
      var first=String((payload&&payload.first_name)||'').trim();
      var last=String((payload&&payload.last_name)||'').trim();
      var email=String((payload&&payload.email)||'').trim();
      if(!first||!last)return {success:false,message:'Coordinator first and last name are required'};
      if(!isValidEmail_(email))return {success:false,message:'A valid coordinator email is required'};
      var attendeesIn=(payload&&Array.isArray(payload.attendees))?payload.attendees:[];
      if(!attendeesIn.length)return {success:false,message:'At least one attendee is required'};
      if(attendeesIn.length>WR26_MAX_ATTENDEES)return {success:false,message:'A group can have at most '+WR26_MAX_ATTENDEES+' attendees per submission'};
      if(payload.entry_id&&isDuplicateEntry(payload.entry_id))return {success:true,duplicate:true};

      var attendeeCount=attendeesIn.length;

      // People-aware capacity: a group of N consumes N seats. checkCapacity()
      // now counts people, so reject when the party would overflow the seats left.
      var cap=checkCapacity();
      if(!cap.success)return {success:false,message:'Capacity check failed: '+(cap.message||'Unknown error'),capacityCheckFailed:true};
      if(cap.full||attendeeCount>cap.available)return {success:false,message:'Only '+cap.available+' seat(s) remain; this group needs '+attendeeCount+'.',capacityFull:true,available:cap.available,requested:attendeeCount};

      // Server-authoritative pricing: N x per-head (early-bird vs regular by date).
      var amountInfo=resolveRegistrationAmount(payload,attendeeCount,true);
      if(amountInfo.amount===null||amountInfo.amount===undefined||isNaN(Number(amountInfo.amount)))return {success:false,message:'Unable to determine registration amount: '+amountInfo.source};
      var originalAmount=Number(amountInfo.amount||0),discount=0,promo='',couponUsed='';
      // Apply the promo once for the whole party, passing attendeeCount so the code
      // type decides the scope: a FIXED code scales per-lady (discount x N, N slots
      // consumed) while a PERCENT code stays one transaction (one use).
      // validateAndApplyPromoCode owns that decision, so read pr.discount directly.
      // couponUsed is set (mirroring the main form) so the group promo shows in
      // getCouponStats and Max-Uses tracking.
      var promoReject='';
      if(payload.promo_code){var pr=validateAndApplyPromoCode(payload.promo_code,originalAmount,attendeeCount);if(pr.valid){discount=Number(pr.discount||0);promo=payload.promo_code;couponUsed=promo;}else{promoReject=' | [promo] Code "'+String(payload.promo_code)+'" entered but NOT applied: '+(pr.message||'rejected')+'. Billed full $'+originalAmount+' — review.';}}

      var paymentMethod=normalizePaymentMethod(payload.payment_method||'pay_later');
      var paymentStatus='pending_pay_later';
      if(paymentMethod==='check')paymentStatus='pending_check';
      else if(paymentMethod==='square')paymentStatus='pending_square';
      else if(paymentMethod!=='pay_later')paymentStatus='pending_other';

      var coordinatorName=(first+' '+last).trim();
      var reg={
        registrationId:generateRegistrationId(),
        firstName:first,lastName:last,email:email,
        phone:String(payload.phone||''),church:String(payload.church||''),
        arrivalDate:'',departureDate:'',
        dietaryNeeds:'',emergencyContactName:String(payload.emergency_contact_name||''),
        emergencyContactPhone:String(payload.emergency_contact_phone||''),specialNeeds:String(payload.special_needs||''),
        promoCode:promo,discountAmount:discount,originalAmount:originalAmount,
        finalAmount:Math.max(originalAmount-discount,0),
        paymentMethod:paymentMethod,paymentStatus:paymentStatus,
        squarePaymentId:'',ffEntryId:String(payload.entry_id||''),status:'active',
        transferNotes:'',checkedIn:false,checkInTime:'',checkInBy:'',
        qrToken:Utilities.getUuid(),editToken:Utilities.getUuid(),
        adminNotes:'[group] coordinator: '+coordinatorName+'; '+attendeeCount+' attendee(s)'+promoReject,
        amountPaid:null,couponUsed:couponUsed
      };
      var w=writeRegistration(reg);if(!w.success)return w;

      // Default each attendee's church to the coordinator's when the import row
      // omitted it, then write through the same canonical helpers as every path.
      var built=buildAttendees({attendees:attendeesIn,email:reg.email,church:reg.church},reg.registrationId).map(function(a){
        if(!a.church)a.church=reg.church;
        return a;
      });
      var attendeeResult=writeAttendeesForRegistration(reg,built);
      var seminarResult=writeSeminarPreferencesForRegistration(reg,built);
      try{recomputeSeminarAssignedCounts_();}catch(e){Logger.log('seminar count refresh failed: '+e.message);}
      var warnings=[attendeeResult.warning,seminarResult.warning].filter(Boolean);

      var emailResult=sendConfirmationEmail(reg,payload.edit_page_url||getConfig().EDIT_PAGE_URL,{attendees:built,warnings:warnings});
      if(emailResult&&emailResult.sent===false)warnings.push('Confirmation email not sent ('+(emailResult.reason||'unknown')+'); registration saved.');

      logAudit_('groupRegister',reg.registrationId,(payload&&payload.adminUser)||'coordinator','Group registration: '+attendeeCount+' attendee(s), '+paymentMethod);
      return {success:true,registrationId:reg.registrationId,attendeeCount:attendeeCount,finalAmount:reg.finalAmount,paymentMethod:paymentMethod,paymentStatus:paymentStatus,warnings:warnings,message:'Group registration received for '+attendeeCount+' attendee(s). A confirmation has been sent to '+email+'.'};
    }catch(e){return {success:false,message:e.message};}
  });
}
