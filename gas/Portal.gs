function ensureMagicLinksSheet_(){
  var ss=getSS();
  var sh=ss.getSheetByName('MagicLinks');
  var headers=['Token','Timestamp','Email','Registration ID','Expires At','Last Used At','Status','Purpose','Request IP','Notes'];
  if(!sh){
    sh=ss.insertSheet('MagicLinks');
    sh.getRange(1,1,1,headers.length).setValues([headers]);
    return sh;
  }
  if(sh.getLastRow()===0){
    sh.getRange(1,1,1,headers.length).setValues([headers]);
  }
  return sh;
}

// Mint a MagicLinks token for a specific registration and return the full PWA
// portal URL that opens it. This is what GAS-sent emails (confirmation, transfer,
// waitlist promotion, payment reminder) embed so their links work with the PWA
// portal's token validation — the editToken alone does NOT open the portal.
// Falls back to '' if no portal base URL is configured, so callers can degrade.
function portalMintLinkForRegistration_(reg,purpose,portalUrlOverride){
  try{
    if(!reg||!reg.registrationId)return '';
    var cfg=getConfig()||{};
    var base=String(portalUrlOverride||cfg.PORTAL_URL||'').trim();
    if(!base)return '';
    var email=String(reg.email||'').trim().toLowerCase();
    var token=Utilities.getUuid()+'-'+Utilities.getUuid();
    var ttlDays=Number(cfg.PORTAL_LINK_TTL_DAYS||60);if(isNaN(ttlDays)||ttlDays<=0)ttlDays=60;
    var expires=new Date(Date.now()+ttlDays*24*60*60*1000);
    ensureMagicLinksSheet_().appendRow([token,new Date(),email,reg.registrationId,expires,'','active',String(purpose||'email_link'),'','Auto-issued for '+String(purpose||'email')]);
    return base+(base.indexOf('?')>-1?'&':'?')+'token='+encodeURIComponent(token);
  }catch(e){Logger.log('portalMintLinkForRegistration_ failed: '+e.message);return '';}
}

function portalFindRegistrationsByEmail_(email){
  var target=String(email||'').trim().toLowerCase();
  if(!target)return [];
  return getAllRegistrations({status:'active'}).filter(function(r){
    return String(r.email||'').trim().toLowerCase()===target;
  });
}

function portalRequestMagicLink(payload){
  try{
    var email=String((payload&&payload.email)||'').trim().toLowerCase();
    var portalUrl=String((payload&&payload.portalUrl)||'').trim();
    var purpose=String((payload&&payload.purpose)||'registrant_edit');
    if(!email)return {success:false,message:'Email is required'};
    if(!portalUrl)return {success:false,message:'Portal URL is required'};

    var regs=portalFindRegistrationsByEmail_(email);
    // Do not reveal whether an email exists in the registration sheet.
    if(!regs.length)return {success:true,message:'If a registration exists for that email, a link has been sent.'};

    var sh=ensureMagicLinksSheet_();
    // Per-email cooldown: if a link was issued to this address very recently, return
    // the same privacy-safe message without sending another (basic anti-spam).
    var cooldownSec=Number((getConfig()||{}).MAGIC_LINK_COOLDOWN_SECONDS||60);
    if(cooldownSec>0){var existingVals=sh.getDataRange().getValues();var lastTs=0;for(var ci=1;ci<existingVals.length;ci++){if(String(existingVals[ci][2]||'').trim().toLowerCase()===email){var t=existingVals[ci][1] instanceof Date?existingVals[ci][1].getTime():new Date(existingVals[ci][1]).getTime();if(!isNaN(t)&&t>lastTs)lastTs=t;}}if(lastTs&&(Date.now()-lastTs)<cooldownSec*1000){Logger.log('portalRequestMagicLink: cooldown active for '+email);return {success:true,message:'If a registration exists for that email, a link has been sent.',cooldown:true};}}
    var expires=new Date(Date.now()+14*24*60*60*1000);
    var links=[];
    regs.forEach(function(reg){
      var token=Utilities.getUuid()+'-'+Utilities.getUuid();
      sh.appendRow([token,new Date(),email,reg.registrationId,expires,'','active',purpose,String(payload.requestIp||''),'']);
      links.push({registrationId:reg.registrationId,name:(reg.firstName+' '+reg.lastName).trim(),url:portalUrl+(portalUrl.indexOf('?')>-1?'&':'?')+'token='+encodeURIComponent(token)});
    });

    var cfg=getConfig()||{};
    var html='<p>Hello,</p><p>Use the secure link below to review or update your Women\'s Retreat 2026 registration.</p>'+
      links.map(function(l){return '<p><a href="'+l.url+'">Manage '+(l.name||l.registrationId)+'</a></p>';}).join('')+
      '<p>This link expires in 14 days. If you did not request this, you can ignore this email.</p>';
    var emailResult=sendEmailSafe_({
      to:email,
      subject:(cfg.EVENT_NAME||"Women's Retreat 2026")+' registration management link',
      htmlBody:html,
      body:'Use this link to manage your registration:\n\n'+links.map(function(l){return (l.name||l.registrationId)+': '+l.url;}).join('\n')+'\n\nThis link expires in 14 days.'
    });
    if(emailResult&&emailResult.sent===false)Logger.log('portalRequestMagicLink: link rows written but email not sent ('+(emailResult.reason||'unknown')+') for '+email);
    // Privacy-safe generic message regardless of email outcome; failure is logged for staff.
    return {success:true,message:'If a registration exists for that email, a link has been sent.',emailSent:!!(emailResult&&emailResult.sent)};
  }catch(e){return {success:false,message:e.message};}
}

function portalValidateToken_(token,requestIp){
  token=String(token||'').trim();
  if(!token)return {success:false,message:'Missing token'};
  var sh=ensureMagicLinksSheet_();
  var vals=sh.getDataRange().getValues();
  for(var i=1;i<vals.length;i++){
    if(String(vals[i][0])!==token)continue;
    var status=String(vals[i][6]||'active').toLowerCase();
    if(status==='revoked')return {success:false,message:'This link has been revoked'};
    var exp=vals[i][4] instanceof Date?vals[i][4]:new Date(vals[i][4]);
    if(exp && !isNaN(exp.getTime()) && exp.getTime()<Date.now())return {success:false,message:'This link has expired'};
    // Optional IP binding (off by default to avoid locking out mobile/forwarded users).
    if((getConfig()||{}).MAGIC_LINK_ENFORCE_IP){var storedIp=String(vals[i][8]||'').trim();var curIp=String(requestIp||'').trim();if(storedIp&&curIp&&storedIp!==curIp){Logger.log('portalValidateToken_: IP mismatch for token (stored '+storedIp+' vs '+curIp+')');return {success:false,message:'This link cannot be used from a different network'};}}
    sh.getRange(i+1,6).setValue(new Date());
    return {success:true,row:i+1,email:vals[i][2],registrationId:vals[i][3],purpose:vals[i][7]};
  }
  return {success:false,message:'Invalid link'};
}

function rowToAttendee_(r){
  return {
    attendee_id:r[0],
    registrationId:r[1],
    first_name:r[2],
    last_name:r[3],
    phone:r[4],
    email:r[5],
    church:r[6],
    attendee_type:r[7],
    meal_preference:r[8],
    dietary_needs:r[9],
    childcare_needed:r[10],
    seminar_preferences_complete:r[11],
    notes:r[12],
    childcare_children:r[13],
    volunteer:r[14]
  };
}

function getAttendeesForRegistration_(registrationId){
  var sh=getSS().getSheetByName('Attendees');
  if(!sh)return [];
  var vals=sh.getDataRange().getValues();
  if(vals.length<=1)return [];
  return vals.slice(1).filter(function(r){return String(r[1])===String(registrationId);}).map(rowToAttendee_);
}

function getSeminarPreferencesForRegistration_(registrationId){
  var sh=getSS().getSheetByName('SeminarPreferences');
  if(!sh)return [];
  var vals=sh.getDataRange().getValues();
  if(vals.length<=1)return [];
  return vals.slice(1).filter(function(r){return String(r[1])===String(registrationId);}).map(function(r){
    return {preferenceId:r[0],registrationId:r[1],attendeeId:r[2],attendeeName:r[3],sessionSlot:r[4],preferenceRank:r[5],seminarTitle:r[6],seminarId:r[7],assignedSeminar:r[8],assignmentStatus:r[9],notes:r[10]};
  });
}

function attachSeminarPreferencesToAttendees_(attendees,prefs){
  var byAttendee={};
  prefs.forEach(function(p){
    var aid=String(p.attendeeId||'');
    if(!byAttendee[aid])byAttendee[aid]={};
    var slot=String(p.sessionSlot||'');
    if(!byAttendee[aid][slot])byAttendee[aid][slot]={};
    byAttendee[aid][slot]['pref_'+String(p.preferenceRank||1)]=p.seminarTitle||'';
  });
  attendees.forEach(function(a){
    a.seminar_preferences=byAttendee[String(a.attendee_id||'')]||{};
  });
  return attendees;
}

function portalGetRegistrationBundle(registrationId){
  try{
    var reg=getRegistrationById(registrationId);
    if(!reg)return {success:false,message:'Registration not found'};
    var attendees=getAttendeesForRegistration_(registrationId);
    var prefs=getSeminarPreferencesForRegistration_(registrationId);
    // Outstanding-balance pay link (Square hosted checkout) so the portal can show
    // a "Pay by Card" button, mirroring the confirmation email. Null when paid in
    // full or when Square Script Properties aren't configured.
    var pay=null;try{var info=squarePaymentInfoForRegistration_(reg);if(info&&info.url)pay={url:info.url,base:info.base,fee:info.fee,total:info.total};}catch(e){}
    return {success:true,registration:reg,attendees:attachSeminarPreferencesToAttendees_(attendees,prefs),seminarPreferences:prefs,payLink:pay};
  }catch(e){return {success:false,message:e.message};}
}

function portalGetRegistrationByMagicToken(payload){
  try{
    var v=portalValidateToken_((payload&&payload.token)||'',payload&&payload.requestIp);
    if(!v.success)return v;
    return portalGetRegistrationBundle(v.registrationId);
  }catch(e){return {success:false,message:e.message};}
}

function normalizePortalAttendees_(registrationId,attendees){
  attendees=Array.isArray(attendees)?attendees:[];
  return attendees.slice(0,WR26_MAX_ATTENDEES).map(function(a,idx){
    var first=String(a.first_name||a.firstName||'').trim();
    var last=String(a.last_name||a.lastName||'').trim();
    return {
      attendee_id:String(a.attendee_id||a.attendeeId||('A-'+registrationId+'-'+(idx+1))).trim(),
      first_name:first,
      last_name:last,
      phone:String(a.phone||'').trim(),
      email:String(a.email||'').trim(),
      church:String(a.church||'').trim(),
      attendee_type:String(a.attendee_type||a.attendeeType||'').trim(),
      meal_preference:String(a.meal_preference||a.mealPreference||'').trim(),
      dietary_needs:String(a.dietary_needs||a.dietaryNeeds||'').trim(),
      childcare_needed:String(a.childcare_needed||a.childcareNeeded||'').trim(),
      childcare_children:String(a.childcare_children||a.childcareChildren||'').trim(),
      volunteer:String(a.volunteer||'').trim(),
      seminar_preferences:a.seminar_preferences||a.seminarPreferences||{},
      notes:String(a.notes||'').trim()
    };
  }).filter(function(a){return a.first_name||a.last_name||a.phone||a.email;});
}

function deleteRowsByRegistrationId_(sheetName,registrationId,registrationColumn){
  var sh=getSS().getSheetByName(sheetName);
  if(!sh)return;
  var vals=sh.getDataRange().getValues();
  for(var i=vals.length-1;i>=1;i--){
    if(String(vals[i][registrationColumn-1])===String(registrationId))sh.deleteRow(i+1);
  }
}

// Carry over attendee fields the registrant portal never submits (email, church)
// from the existing rows, keyed by attendee_id, so a save does not blank them.
// Must run BEFORE the old rows are deleted.
function preserveExistingAttendeeFields_(registrationId,normalized){
  try{
    var existing=getAttendeesForRegistration_(registrationId);
    if(!existing.length)return;
    var byId={};
    existing.forEach(function(a){byId[String(a.attendee_id||'')]=a;});
    normalized.forEach(function(a){
      var prev=byId[String(a.attendee_id||'')];
      if(!prev)return;
      if(!a.email)a.email=prev.email||'';
      if(!a.church)a.church=prev.church||'';
      // Only carry over the children count when childcare is still requested. This lets the
      // portal clear it when childcare is turned off, while protecting surfaces that don't
      // submit the count (e.g. the staff app) from wiping it when childcare stays "yes".
      if(!a.childcare_children&&String(a.childcare_needed||'').toLowerCase()==='yes')a.childcare_children=prev.childcare_children||'';
      if(!a.volunteer)a.volunteer=prev.volunteer||'';
    });
  }catch(e){Logger.log('preserveExistingAttendeeFields_ failed: '+e.message);}
}

// Per-lady promo/scholarship gate for a roster edit. Resolves the discount for the
// NEW attendee count and, for a FIXED (per-lady) scholarship, enforces Max-Uses on
// growth and adjusts the promo counter (consume on growth, RELEASE on shrink).
// Returns {ok:true,discount[,warning]} or {ok:false,message}. Must run under the
// caller's lock so the cap check + counter write are atomic (both portal save paths
// already hold one). The Max-Uses cap is checked BEFORE writing Current Uses, so a
// rejected save consumes nothing.
function promoApplyDeltaForEdit_(reg,oldCount,newCount,newOriginal){
  try{
    var effOld=Math.max(Number(oldCount||0),1);
    var effNew=Math.max(Number(newCount||0),1);
    var orig=Number(newOriginal||0);
    var storedDiscount=Number((reg&&reg.discountAmount)||0);
    // Default: rescale the stored discount linearly with the count (cap at original).
    var rescaled=Math.min(Math.round((storedDiscount/effOld*effNew)*100)/100,orig);
    var code=String((reg&&reg.promoCode)||'').trim();
    if(!code)return {ok:true,discount:rescaled};
    var s=getSS().getSheetByName('PromoCodes');
    var v=s.getDataRange().getValues();
    for(var i=1;i<v.length;i++){
      if(String(v[i][0]).toUpperCase()!==code.toUpperCase())continue;
      var dtype=normalizeDiscountType(v[i][2]);
      var rate=promoNumber_(v[i][3]);
      if(dtype==='percent'){
        // One transaction on the whole party total; the count change consumes no uses.
        return {ok:true,discount:Math.min(orig*rate/100,orig)};
      }
      if(dtype==='fixed'){
        var max=promoNumber_(v[i][4]),cur=promoNumber_(v[i][5]);
        var delta=Number(newCount||0)-Number(oldCount||0);
        // Only growth can breach the cap; check it BEFORE writing Current Uses so a
        // rejected save consumes nothing.
        if(delta>0&&max>0&&(cur+delta)>max){
          var remain=Math.max(max-cur,0);
          return {ok:false,message:'Scholarship code "'+code+'" has only '+remain+' of the '+delta+' added slot(s) remaining. Please remove '+(delta-remain)+' attendee(s) from this party, or contact the conference office to raise the limit.'};
        }
        // Consume on growth, RELEASE on shrink (negative delta lowers Current Uses).
        s.getRange(i+1,6).setValue(cur+delta);
        return {ok:true,discount:Math.min(rate*effNew,orig)};
      }
      // Code still on file but with an unrecognized discount type: rescale + warn.
      return {ok:true,discount:rescaled,warning:'Promo code "'+code+'" has an unrecognized discount type; the discount was scaled proportionally.'};
    }
    // Code no longer in the sheet: rescale + warn.
    return {ok:true,discount:rescaled,warning:'Promo code "'+code+'" is no longer on file; the discount was scaled proportionally.'};
  }catch(e){return {ok:false,message:'Could not apply the scholarship change: '+e.message};}
}

// Capacity + pricing guard for portal/staff roster edits. Detail-only edits
// (attendee count unchanged) never touch price. When the count CHANGES we
// recompute the server-authoritative amount (N x per-head, keeping the original
// discount); when it GROWS we also reject the save if the added seats would
// exceed remaining capacity. Must run under the caller's lock (both portal save
// paths hold one) so the capacity check is atomic. Returns {ok} or {ok:false,message}.
function applyRosterCapacityAndPricing_(reg,oldCount,newCount){
  try{
    var effOld=Math.max(Number(oldCount||0),1);
    var effNew=Math.max(Number(newCount||0),1);
    if(newCount>oldCount){
      var cap=checkCapacity();
      if(cap&&cap.success){
        var avail=Number(cap.available||0);
        var delta=effNew-effOld;
        if(delta>avail)return {ok:false,message:'Adding attendees would exceed capacity; only '+avail+' seat(s) remain.'};
      }
    }
    if(newCount!==oldCount&&newCount>=1){
      // Keep the price TIER the registration was originally sold at: derive the
      // per-head rate from the stored originalAmount (e.g. early-bird) and scale it
      // to the new count, rather than re-quoting today's tier. Otherwise editing
      // the roster after the early-bird deadline would silently reprice the whole
      // party — including existing seats — at the regular rate. A $0 comp stays $0.
      var perHead=Number(reg.originalAmount||0)/effOld;
      if(!isFinite(perHead)||perHead<0)perHead=0;
      var newOriginal=Math.round(perHead*newCount*100)/100;
      // Per-lady scholarship gate: resolves the discount for the new count and, for a
      // FIXED code, enforces Max-Uses on growth (and adjusts the promo counter). A cap
      // rejection here must abort the whole save, so bubble {rejected:true}.
      var gate=promoApplyDeltaForEdit_(reg,oldCount,newCount,newOriginal);
      if(!gate.ok)return {ok:false,rejected:true,message:gate.message};
      var discount=Number(gate.discount||0);
      var newFinal=Math.max(newOriginal-discount,0);
      var fields={originalAmount:newOriginal,discountAmount:discount,finalAmount:newFinal};
      var paid=Number(reg.amountPaid||0);
      // If a previously-settled registration now owes for added seats, reopen its
      // balance so reminders / the Square pay link collect the difference.
      if(newFinal>paid+0.01&&(reg.paymentStatus==='paid'||reg.paymentStatus==='paid_onsite'))fields.paymentStatus='partial_onsite';
      updateRegistration(reg.registrationId,fields);
      reg.originalAmount=newOriginal;reg.discountAmount=discount;reg.finalAmount=newFinal;if(fields.paymentStatus)reg.paymentStatus=fields.paymentStatus;
      if(gate.warning)return {ok:true,warning:gate.warning};
    }
    return {ok:true};
  }catch(e){Logger.log('applyRosterCapacityAndPricing_ failed: '+e.message);return {ok:true};}
}

function replaceAttendeesForRegistration_(reg,attendees){
  var ss=getSS();
  var attSh=ss.getSheetByName('Attendees');
  var semSh=ss.getSheetByName('SeminarPreferences');
  var warnings=[];
  var normalized=normalizePortalAttendees_(reg.registrationId,attendees);
  // Enforce capacity for roster growth and re-price for any count change BEFORE
  // touching any rows, so a rejected save leaves the existing roster intact.
  var gate=applyRosterCapacityAndPricing_(reg,getAttendeesForRegistration_(reg.registrationId).length,normalized.length);
  // Carry the rejected flag (scholarship cap) and any warning up to the save paths.
  // The roster stays untouched on a rejection because we return before deleting rows.
  if(!gate.ok)return {success:false,rejected:!!gate.rejected,warnings:[gate.message]};
  if(gate.warning)warnings.push(gate.warning);
  // Preserve non-submitted fields before we delete anything.
  preserveExistingAttendeeFields_(reg.registrationId,normalized);
  // Only clear rows from sheets we can actually rewrite, so a missing/renamed tab
  // never wipes data without writing a replacement.
  if(attSh){deleteRowsByRegistrationId_('Attendees',reg.registrationId,2);}
  else{warnings.push('Attendees tab missing; attendee changes were NOT saved.');}
  if(semSh){deleteRowsByRegistrationId_('SeminarPreferences',reg.registrationId,2);}
  else{warnings.push('SeminarPreferences tab missing; seminar choices were NOT saved.');}
  var ok=true;
  if(attSh){var attendeeResult=writeAttendeesForRegistration(reg,normalized);if(attendeeResult.warning)warnings.push(attendeeResult.warning);if(attendeeResult.success===false)ok=false;}
  if(semSh){var seminarResult=writeSeminarPreferencesForRegistration(reg,normalized);if(seminarResult.warning)warnings.push(seminarResult.warning);if(seminarResult.success===false)ok=false;
    try{recomputeSeminarAssignedCounts_();}catch(e){Logger.log('seminar count refresh failed: '+e.message);}}
  return {success:ok,attendees:normalized,warnings:warnings};
}

function portalAllowedRegistrationFields_(fields,actor){
  var allowed={firstName:true,lastName:true,phone:true,church:true,dietaryNeeds:true,emergencyContactName:true,emergencyContactPhone:true,specialNeeds:true,arrivalDate:true,departureDate:true,adminNotes:true};
  var out={};
  Object.keys(fields||{}).forEach(function(k){if(allowed[k])out[k]=fields[k];});
  out.adminNotes=(fields&&fields.adminNotes?String(fields.adminNotes)+'\n':'')+'['+new Date().toISOString()+'] Updated via '+actor+'.';
  return out;
}

function portalSaveRegistrationByMagicToken(payload){
  var lock=LockService.getScriptLock();
  if(!lock.tryLock(10000))return {success:false,message:'System busy, please try again'};
  try{
    var v=portalValidateToken_((payload&&payload.token)||'',payload&&payload.requestIp);
    if(!v.success)return v;
    var reg=getRegistrationById(v.registrationId);
    if(!reg)return {success:false,message:'Registration not found'};
    var fields=portalAllowedRegistrationFields_(payload.fields||{},'registrant portal');
    var result=updateRegistration(reg.registrationId,fields);
    if(!result.success)return result;
    reg=getRegistrationById(reg.registrationId);
    var warnings=[];
    var repFailed=false;
    var repRejected=false;
    if(Array.isArray(payload.attendees)){
      var rep=replaceAttendeesForRegistration_(reg,payload.attendees);
      warnings=rep.warnings||[];
      if(rep.success===false){repFailed=true;repRejected=!!rep.rejected;}
    }
    logAudit_('portalEdit',reg.registrationId,v.email||'registrant',repFailed?'Magic-link self-service edit FAILED (attendee/seminar write)':'Magic-link self-service edit',payload&&payload.requestIp);
    // Only confirm "saved" by email when the attendee/seminar rewrite succeeded.
    if(!repFailed){try{sendEditConfirmationEmail(getRegistrationById(reg.registrationId));}catch(e){Logger.log('Portal edit confirmation failed: '+e.message);}}
    var bundle=portalGetRegistrationBundle(reg.registrationId);
    bundle.warnings=warnings;
    // A failed rewrite must not be reported as a successful save, even though the
    // registrant fields above did persist. Surface it so the caller/UI shows an error.
    // A scholarship cap rejection left the roster untouched, so surface ONLY that
    // message; any other write failure keeps the generic "try again" copy.
    if(repFailed){bundle.success=false;bundle.message=repRejected?warnings.join(' '):('Your registrant details were saved, but attendee or seminar choices could not be written: '+warnings.join(' ')+' Please try again or contact us so nothing is lost.');}
    return bundle;
  }catch(e){return {success:false,message:e.message};}
  finally{lock.releaseLock();}
}

// Self-serve individual-attendee transfer: the registrant uses their magic link to
// substitute one attendee in THEIR registration with a new person. The token pins
// the registrationId, so a registrant can only transfer attendees in their own party.
// Returns the refreshed bundle on success so the portal can re-render.
function portalTransferAttendeeByMagicToken(payload){
  try{
    var v=portalValidateToken_((payload&&payload.token)||'',payload&&payload.requestIp);
    if(!v.success)return v;
    var result=transferAttendeeCore_(v.registrationId,payload,{source:'portal',actor:(v.email||'registrant'),notify:true});
    if(!result.success)return result;
    var bundle=portalGetRegistrationBundle(v.registrationId);
    bundle.transfer=result;
    return bundle;
  }catch(e){return {success:false,message:e.message};}
}

function portalAdminSaveRegistration(payload){
  var lock=LockService.getScriptLock();
  if(!lock.tryLock(10000))return {success:false,message:'System busy, please try again'};
  try{
    var registrationId=String((payload&&payload.registrationId)||'');
    var reg=getRegistrationById(registrationId);
    if(!reg)return {success:false,message:'Registration not found'};
    var result=adminEditRegistration(registrationId,payload.fields||{},payload.adminUser||'portal_admin');
    if(!result.success)return result;
    reg=getRegistrationById(registrationId);
    var prevFinal=Number(reg.finalAmount||0);
    var warnings=[];
    var repFailed=false;
    var repRejected=false;
    if(Array.isArray(payload.attendees)){
      var rep=replaceAttendeesForRegistration_(reg,payload.attendees);
      warnings=rep.warnings||[];
      if(rep.success===false){repFailed=true;repRejected=!!rep.rejected;}
    }
    // If a staff-entered change raised the balance (e.g. attendees added on the
    // registrant's behalf), notify the payer with the new amount due + pay link.
    if(!repFailed){
      var afterReg=getRegistrationById(registrationId);
      if(afterReg&&Number(afterReg.finalAmount||0)>prevFinal+0.01){
        try{sendEditConfirmationEmail(afterReg);}catch(e){Logger.log('Admin-edit balance email failed: '+e.message);}
      }
    }
    var bundle=portalGetRegistrationBundle(registrationId);
    bundle.warnings=warnings;
    // A failed attendee/seminar rewrite must not be reported as a successful save.
    // A scholarship cap rejection left the roster untouched, so surface ONLY that
    // message; any other write failure keeps the generic "try again" copy.
    if(repFailed){bundle.success=false;bundle.message=repRejected?warnings.join(' '):('Registration fields saved, but attendee or seminar choices could not be written: '+warnings.join(' ')+' Please try again.');}
    return bundle;
  }catch(e){return {success:false,message:e.message};}
  finally{lock.releaseLock();}
}

function portalSearchRegistrations(payload){
  try{
    var regs=getAllRegistrations({status:(payload&&payload.status)||'',search:(payload&&payload.q)||''});
    var attendeeRows=getSS().getSheetByName('Attendees')?getSS().getSheetByName('Attendees').getDataRange().getValues().slice(1):[];
    var counts={};
    attendeeRows.forEach(function(r){var id=String(r[1]||'');counts[id]=(counts[id]||0)+1;});
    regs=regs.map(function(r){r.attendeeCount=counts[String(r.registrationId)]||0;return r;});
    return {success:true,registrations:regs,count:regs.length};
  }catch(e){return {success:false,message:e.message};}
}
