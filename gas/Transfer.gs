function transferRegistration(payload){try{if(!payload||!payload.registrationId)return {success:false,message:'registrationId is required'};if(!payload.newFirstName||!payload.newLastName||!payload.newEmail)return {success:false,message:'newFirstName, newLastName, and newEmail are required'};if(!/^\S+@\S+\.\S+$/.test(String(payload.newEmail||'')))return {success:false,message:'newEmail is invalid'};var old=getRegistrationById(payload.registrationId);if(!old)return {success:false,message:'Not found'};if(old.status!=='active')return {success:false,message:'Registration is '+old.status};var nr=Object.assign({},old,{registrationId:generateRegistrationId(),firstName:payload.newFirstName,lastName:payload.newLastName,email:payload.newEmail,phone:payload.newPhone,church:payload.newChurch,paymentStatus:'transferred_registration',qrToken:Utilities.getUuid(),editToken:Utilities.getUuid(),status:'active',adminNotes:'Transferred from '+old.firstName+' '+old.lastName+' ('+old.registrationId+')'});var w=writeRegistration(nr);if(!w.success)return w;updateRegistration(old.registrationId,{status:'transferred',transferNotes:'Transferred to '+nr.firstName+' '+nr.lastName+' ('+nr.registrationId+') on '+formatDate(new Date())+'. Reason: '+(payload.reason||'')+'. Refund: '+(payload.refundNotes||'')});getSS().getSheetByName('TransferLog').appendRow(['TR-'+Date.now(),new Date(),old.registrationId,nr.registrationId,old.firstName+' '+old.lastName,nr.firstName+' '+nr.lastName,old.email,nr.email,payload.reason||'',payload.refundNotes||'',payload.adminNotes||'',payload.adminUser||'']);sendTransferEmail(old,nr,payload.reason,payload.refundNotes,payload.edit_page_url);logAudit_('transfer',old.registrationId,payload.adminUser||'admin','Transferred to '+nr.registrationId+' ('+nr.firstName+' '+nr.lastName+')');return {success:true,originalRegId:old.registrationId,newRegId:nr.registrationId};}catch(e){return {success:false,message:e.message};}}
function getTransferLog(){var v=getSS().getSheetByName('TransferLog').getDataRange().getValues();return {success:true,rows:v.slice(1)};}

// Individual-attendee transfer (in-place substitution): replace ONE attendee in a
// registration with a new person, keeping the seat, party, and payment. The new
// person's identity replaces the old; personal/medical fields and seminar choices
// are reset because they belonged to the prior person. The registration's primary
// contact/payer is intentionally NOT changed — use transferRegistration for that.
// Shared by the admin (secret) and self-serve (magic-link) entry points.
function transferAttendeeCore_(registrationId,payload,opts){
  opts=opts||{};
  try{
    registrationId=String(registrationId||'').trim();
    if(!registrationId)return {success:false,message:'registrationId is required'};
    var attendeeId=String((payload&&(payload.attendeeId||payload.attendee_id))||'').trim();
    if(!attendeeId)return {success:false,message:'attendeeId is required'};
    var newFirst=String((payload&&payload.newFirstName)||'').trim();
    var newLast=String((payload&&payload.newLastName)||'').trim();
    var newEmail=String((payload&&payload.newEmail)||'').trim();
    if(!newFirst||!newLast)return {success:false,message:'newFirstName and newLastName are required'};
    if(!isValidEmail_(newEmail))return {success:false,message:'A valid newEmail is required'};
    var lock=LockService.getScriptLock();
    if(!lock.tryLock(10000))return {success:false,message:'System busy, please try again'};
    try{
      var reg=getRegistrationById(registrationId);
      if(!reg)return {success:false,message:'Registration not found'};
      if(reg.status&&reg.status!=='active')return {success:false,message:'Registration is '+reg.status};
      var attendees=attachSeminarPreferencesToAttendees_(getAttendeesForRegistration_(registrationId),getSeminarPreferencesForRegistration_(registrationId));
      var target=null;
      for(var i=0;i<attendees.length;i++){if(String(attendees[i].attendee_id)===attendeeId){target=attendees[i];break;}}
      if(!target)return {success:false,message:'Attendee not found in this registration'};
      var oldName=(String(target.first_name||'').trim()+' '+String(target.last_name||'').trim()).trim();
      var oldEmail=String(target.email||'').trim();
      // In-place substitution: swap identity, reset what belonged to the prior person.
      target.first_name=newFirst;
      target.last_name=newLast;
      target.email=newEmail;
      target.phone=String((payload&&payload.newPhone)||'').trim();
      if(payload&&payload.newChurch!==undefined&&String(payload.newChurch).trim())target.church=String(payload.newChurch).trim();
      target.meal_preference='';
      target.dietary_needs='';
      target.childcare_needed='no';
      target.childcare_children='';
      target.volunteer='no';
      target.seminar_preferences={};
      var rep=replaceAttendeesForRegistration_(reg,attendees);
      var warnings=(rep&&rep.warnings)||[];
      var newName=(newFirst+' '+newLast).trim();
      try{getSS().getSheetByName('TransferLog').appendRow(['TR-A-'+Date.now(),new Date(),registrationId,registrationId,oldName,newName,oldEmail,newEmail,String((payload&&payload.reason)||''),'','Attendee transfer (attendee '+attendeeId+') via '+(opts.source||'admin'),String(opts.actor||'admin')]);}catch(e){Logger.log('attendee transfer log failed: '+e.message);}
      logAudit_('attendeeTransfer',registrationId,opts.actor||'admin','Attendee '+attendeeId+' transferred from '+(oldName||'(blank)')+' to '+newName+(opts.source?(' via '+opts.source):''),payload&&payload.requestIp);
      if(opts.notify!==false){
        try{sendAttendeeTransferEmail_(reg,oldName,oldEmail,{firstName:newFirst,lastName:newLast,email:newEmail,phone:target.phone},String((payload&&payload.reason)||''));}catch(e){Logger.log('attendee transfer email failed: '+e.message);}
      }
      if(rep&&rep.success===false)return {success:false,message:'Attendee changes could not be fully written: '+warnings.join(' '),warnings:warnings};
      return {success:true,registrationId:registrationId,attendeeId:attendeeId,oldName:oldName,newName:newName,warnings:warnings};
    }finally{lock.releaseLock();}
  }catch(e){return {success:false,message:e.message};}
}

// Admin (secret-authorized) entry point.
function transferAttendee(payload){return transferAttendeeCore_(String((payload&&payload.registrationId)||''),payload,{source:'admin',actor:(payload&&payload.adminUser)||'admin',notify:!(payload&&payload.notify===false)});}

