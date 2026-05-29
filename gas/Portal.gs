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
    notes:r[12]
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
    return {success:true,registration:reg,attendees:attachSeminarPreferencesToAttendees_(attendees,prefs),seminarPreferences:prefs};
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
  return attendees.slice(0,5).map(function(a,idx){
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

function replaceAttendeesForRegistration_(reg,attendees){
  deleteRowsByRegistrationId_('Attendees',reg.registrationId,2);
  deleteRowsByRegistrationId_('SeminarPreferences',reg.registrationId,2);
  var normalized=normalizePortalAttendees_(reg.registrationId,attendees);
  var attendeeResult=writeAttendeesForRegistration(reg,normalized);
  var seminarResult=writeSeminarPreferencesForRegistration(reg,normalized);
  return {success:true,attendees:normalized,warnings:[attendeeResult.warning,seminarResult.warning].filter(Boolean)};
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
    if(Array.isArray(payload.attendees)){
      var rep=replaceAttendeesForRegistration_(reg,payload.attendees);
      warnings=rep.warnings||[];
    }
    logAudit_('portalEdit',reg.registrationId,v.email||'registrant','Magic-link self-service edit',payload&&payload.requestIp);
    try{sendEditConfirmationEmail(getRegistrationById(reg.registrationId));}catch(e){Logger.log('Portal edit confirmation failed: '+e.message);}
    var bundle=portalGetRegistrationBundle(reg.registrationId);
    bundle.warnings=warnings;
    return bundle;
  }catch(e){return {success:false,message:e.message};}
  finally{lock.releaseLock();}
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
    var warnings=[];
    if(Array.isArray(payload.attendees)){
      var rep=replaceAttendeesForRegistration_(reg,payload.attendees);
      warnings=rep.warnings||[];
    }
    var bundle=portalGetRegistrationBundle(registrationId);
    bundle.warnings=warnings;
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
