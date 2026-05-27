function rowToObject(r){return {registrationId:r[0],timestamp:r[1],firstName:r[2],lastName:r[3],email:r[4],phone:r[5],church:r[6],arrivalDate:r[7],departureDate:r[8],dietaryNeeds:r[9],emergencyContactName:r[10],emergencyContactPhone:r[11],specialNeeds:r[12],promoCode:r[13],discountAmount:Number(r[14]||0),originalAmount:Number(r[15]||0),finalAmount:Number(r[16]||0),paymentMethod:r[17],paymentStatus:r[18],squarePaymentId:r[19],ffEntryId:r[20],status:r[21],transferNotes:r[22],checkedIn:r[23],checkInTime:r[24],checkInBy:r[25],qrToken:r[26],editToken:r[27],adminNotes:r[28],amountPaid:(r[29]!==''&&r[29]!==null&&r[29]!==undefined)?Number(r[29]):null,couponUsed:r[30]||''};}
function writeRegistration(d){try{getSS().getSheetByName('Registrations').appendRow([d.registrationId,new Date(),d.firstName,d.lastName,d.email,d.phone,d.church,d.arrivalDate,d.departureDate,d.dietaryNeeds,d.emergencyContactName,d.emergencyContactPhone,d.specialNeeds,d.promoCode,d.discountAmount,d.originalAmount,d.finalAmount,d.paymentMethod,d.paymentStatus,d.squarePaymentId,d.ffEntryId,d.status||'active',d.transferNotes||'',d.checkedIn||false,d.checkInTime||'',d.checkInBy||'',d.qrToken,d.editToken,d.adminNotes||'',(d.amountPaid!==null&&d.amountPaid!==undefined)?d.amountPaid:'',d.couponUsed||'']);return {success:true};}catch(e){return {success:false,message:e.message};}}
function getRegistrationById(id){var s=getSS().getSheetByName('Registrations');var v=s.getDataRange().getValues();for(var i=1;i<v.length;i++)if(String(v[i][0])===String(id))return rowToObject(v[i]);return null;}
function getRegistrationByEditToken(t){var s=getSS().getSheetByName('Registrations');var v=s.getDataRange().getValues();for(var i=1;i<v.length;i++)if(String(v[i][27])===String(t))return rowToObject(v[i]);return null;}
function getRegistrationByQRToken(t){var s=getSS().getSheetByName('Registrations');var v=s.getDataRange().getValues();for(var i=1;i<v.length;i++)if(String(v[i][26])===String(t))return {row:i+1,data:rowToObject(v[i])};return null;}
function updateRegistration(id,fields){try{var s=getSS().getSheetByName('Registrations');var v=s.getDataRange().getValues();var map={firstName:3,lastName:4,email:5,phone:6,church:7,arrivalDate:8,departureDate:9,dietaryNeeds:10,emergencyContactName:11,emergencyContactPhone:12,specialNeeds:13,promoCode:14,discountAmount:15,originalAmount:16,finalAmount:17,paymentMethod:18,paymentStatus:19,squarePaymentId:20,status:22,transferNotes:23,checkedIn:24,checkInTime:25,checkInBy:26,adminNotes:29,amountPaid:30,couponUsed:31};for(var i=1;i<v.length;i++){if(String(v[i][0])===String(id)){Object.keys(fields||{}).forEach(function(k){if(map[k])s.getRange(i+1,map[k]).setValue(fields[k]);});return {success:true};}}return {success:false,message:'Registration not found'};}catch(e){return {success:false,message:e.message};}}
function editRegistrationByToken(token,fields){try{if(!token)return {success:false,message:'Missing edit token'};var reg=getRegistrationByEditToken(token);if(!reg)return {success:false,message:'Registration not found'};var allowed={firstName:true,lastName:true,phone:true,church:true,dietaryNeeds:true,emergencyContactName:true,emergencyContactPhone:true,specialNeeds:true,arrivalDate:true,departureDate:true};var updates={};Object.keys(fields||{}).forEach(function(k){if(allowed[k])updates[k]=fields[k];});var stamp='['+new Date().toISOString()+'] Updated by public edit link.';updates.adminNotes=(reg.adminNotes?reg.adminNotes+'\n':'')+stamp;var result=updateRegistration(reg.registrationId,updates);if(!result.success)return result;var updated=getRegistrationById(reg.registrationId);try{sendEditConfirmationEmail(updated);}catch(e){Logger.log('Edit confirmation email failed: '+e.message);}return {success:true,registration:updated};}catch(e){return {success:false,message:e.message};}}
function adminEditRegistration(registrationId,fields,adminUser){try{if(!registrationId)return {success:false,message:'Registration ID is required'};var reg=getRegistrationById(registrationId);if(!reg)return {success:false,message:'Registration not found'};var allowed={firstName:true,lastName:true,email:true,phone:true,church:true,arrivalDate:true,departureDate:true,dietaryNeeds:true,emergencyContactName:true,emergencyContactPhone:true,specialNeeds:true,promoCode:true,discountAmount:true,originalAmount:true,finalAmount:true,paymentMethod:true,paymentStatus:true,squarePaymentId:true,status:true,transferNotes:true,adminNotes:true};var updates={};Object.keys(fields||{}).forEach(function(k){if(allowed[k])updates[k]=fields[k];});var actor=adminUser||'admin';var note='['+new Date().toISOString()+'] Admin edit by '+actor+'.';updates.adminNotes=(updates.adminNotes!==undefined?String(updates.adminNotes):String(reg.adminNotes||''));updates.adminNotes=(updates.adminNotes?updates.adminNotes+'\n':'')+note;var result=updateRegistration(registrationId,updates);if(!result.success)return result;return {success:true,registration:getRegistrationById(registrationId)};}catch(e){return {success:false,message:e.message};}}
function getAllRegistrations(filters){var s=getSS().getSheetByName('Registrations');var rows=s.getDataRange().getValues().slice(1).map(rowToObject);return rows.filter(function(r){if(filters&&filters.status&&r.status!==filters.status)return false;var q=(filters&&filters.search?String(filters.search).toLowerCase():'');if(q && [r.firstName,r.lastName,r.email,r.church].join(' ').toLowerCase().indexOf(q)===-1)return false;return true;});}
function searchRegistrations(q){q=String(q||'').toLowerCase();return getAllRegistrations({}).filter(function(r){return [r.firstName,r.lastName,r.email,r.church].join(' ').toLowerCase().indexOf(q)>-1;}).slice(0,20);}
function getChurchRosters(){var groups={};getAllRegistrations({status:'active'}).forEach(function(r){var c=r.church||'Unspecified';if(!groups[c])groups[c]=[];groups[c].push(r);});return Object.keys(groups).sort().map(function(c){return {name:c,members:groups[c]};});}
function writeAttendeesForRegistration(reg,attendees){
  try{
    var sh=getSS().getSheetByName('Attendees');
    if(!sh)return {success:true,warning:'Attendees tab missing; attendee rows skipped.'};
    (attendees||[]).forEach(function(a){
      sh.appendRow([a.attendee_id,reg.registrationId,a.first_name,a.last_name,a.phone,a.email,a.church,a.attendee_type,a.meal_preference,a.dietary_needs,a.childcare_needed,a.seminar_preferences&&Object.keys(a.seminar_preferences).length?'yes':'no','']);
    });
    return {success:true};
  }catch(e){return {success:true,warning:'Attendees write warning: '+e.message};}
}
function flattenSeminarPreferences(pref) {
  var out = [];
  if (!pref) return out;

  Object.keys(pref).forEach(function(slot) {
    var v = pref[slot];

    if (Array.isArray(v)) {
      // Legacy array: [pref1, pref2]
      v.forEach(function(item, idx) {
        if (String(item || '').trim()) {
          out.push({ slot: slot, rank: idx + 1, title: item });
        }
      });

    } else if (v && typeof v === 'object') {
      // New format: { pref_1: "value", pref_2: "value" }
      Object.keys(v).sort().forEach(function(k) {
        var title = String(v[k] || '').trim();
        if (!title) return;
        var rankMatch = k.match(/(\d+)$/);
        var rank = rankMatch ? parseInt(rankMatch[1], 10) : 1;
        out.push({ slot: slot, rank: rank, title: title });
      });

    } else if (String(v || '').trim()) {
      // Legacy scalar
      out.push({ slot: slot, rank: 1, title: v });
    }
  });

  return out;
}
function writeSeminarPreferencesForRegistration(reg,attendees){
  try{
    var sh=getSS().getSheetByName('SeminarPreferences');
    if(!sh)return {success:true,warning:'SeminarPreferences tab missing; preferences skipped.'};
    (attendees||[]).forEach(function(a){
      flattenSeminarPreferences(a.seminar_preferences).forEach(function(p){
        sh.appendRow(['P-'+Date.now()+'-'+Math.floor(Math.random()*10000),reg.registrationId,a.attendee_id,(a.first_name+' '+a.last_name).trim(),p.slot,p.rank,p.title,'','','pending_review','']);
      });
    });
    return {success:true};
  }catch(e){return {success:true,warning:'Seminar preference write warning: '+e.message};}
}
