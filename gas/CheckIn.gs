function checkinByToken(token,adminUser){try{var f=getRegistrationByQRToken(token);if(!f)return {success:false,message:'QR code not recognized'};var r=f.data;if(r.status!=='active')return {success:false,message:'Registration is '+r.status};if(String(r.checkedIn).toUpperCase()==='TRUE')return {success:true,alreadyCheckedIn:true,registration:r};var s=getSS().getSheetByName('Registrations');s.getRange(f.row,24).setValue(true);s.getRange(f.row,25).setValue(new Date());s.getRange(f.row,26).setValue(adminUser);getSS().getSheetByName('CheckIns').appendRow(['CI-'+Date.now(),new Date(),r.registrationId,r.firstName+' '+r.lastName,r.church,'qr',adminUser]);return {success:true,alreadyCheckedIn:false,registration:getRegistrationById(r.registrationId)};}catch(e){return {success:false,message:e.message};}}
function checkinById(registrationId,adminUser){var r=getRegistrationById(registrationId);if(!r)return {success:false,message:'Registration not found'};return checkinByToken(r.qrToken,adminUser);}
function searchRegistrationsActive(q){return {success:true,registrations:searchRegistrations(q).filter(function(r){return r.status==='active';})};}
function getCheckInStats(){try{var a=getAllRegistrations({status:'active'});var t=a.length,c=a.filter(function(r){return String(r.checkedIn).toUpperCase()==='TRUE';}).length;var paymentsPending=a.filter(function(r){return r.paymentStatus!=='paid'&&r.paymentStatus!=='paid_onsite';}).length;var by={};a.forEach(function(r){var ch=r.church||'Unspecified';if(!by[ch])by[ch]={church:ch,total:0,checkedIn:0};by[ch].total++;if(String(r.checkedIn).toUpperCase()==='TRUE')by[ch].checkedIn++;});return {success:true,stats:{total:t,checkedIn:c,notCheckedIn:t-c,percent:t?Math.round((c/t)*1000)/10:0,paymentsPending:paymentsPending},byChurch:Object.keys(by).sort().map(function(k){return by[k];})};}catch(e){return {success:false,message:e.message};}}
function calculateSquareFee(baseAmount){var cfg=getConfig();var base=Number(baseAmount||0);if(!cfg.SQUARE_FEE_ENABLED||base<=0)return {base:base,fee:0,total:base};var fee=(base*(Number(cfg.SQUARE_FEE_PERCENT||0)/100))+Number(cfg.SQUARE_FEE_FIXED||0);fee=Math.round(fee*100)/100;return {base:base,fee:fee,total:Math.round((base+fee)*100)/100};}
function recordPayment(payload){try{var registrationId=String((payload&&payload.registrationId)||'');if(!registrationId)return {success:false,message:'Registration not found'};var existing=getRegistrationById(registrationId);if(!existing)return {success:false,message:'Registration not found'};var method=String(payload.paymentMethod||'').toLowerCase();var allowed={cash:true,check:true,square_onsite:true,other:true};if(!allowed[method])method='other';var enteredAmount=Number(payload.amountPaid||0);var baseAmount=enteredAmount>0?enteredAmount:Number(existing.finalAmount||0);var feeInfo=(method==='square_onsite')?calculateSquareFee(baseAmount):{base:baseAmount,fee:0,total:baseAmount};var recordedAmount=feeInfo.total;var notes=[];notes.push('['+new Date().toISOString()+'] On-site payment recorded: '+method);notes.push('Amount: $'+recordedAmount+'.');if(feeInfo.fee>0)notes.push('Includes Square fee. Base: $'+feeInfo.base+', Fee: $'+feeInfo.fee+', Total: $'+feeInfo.total+'.');if(payload.checkNumber)notes.push('Check #: '+payload.checkNumber+'.');if(payload.paymentNotes)notes.push('Notes: '+payload.paymentNotes+'.');notes.push('By: '+(payload.adminUser||'admin')+'.');
// Preserve the server-owed amount (finalAmount) and record what was collected in
// amountPaid, so a short payment is flagged partial rather than silently marked paid.
var owed=Number(existing.finalAmount||0);var status=(owed>0&&recordedAmount<owed-0.01)?'partial_onsite':'paid_onsite';if(status==='partial_onsite')notes.push('Balance remaining: $'+(Math.round((owed-recordedAmount)*100)/100)+'.');
var updateFields={paymentStatus:status,paymentMethod:method,adminNotes:(existing.adminNotes?existing.adminNotes+'\n':'')+notes.join(' '),amountPaid:recordedAmount};var updated=updateRegistration(registrationId,updateFields);if(!updated.success)return updated;return {success:true,registration:getRegistrationById(registrationId),fee:feeInfo.fee,baseAmount:feeInfo.base,totalCollected:feeInfo.total,status:status};}catch(e){return {success:false,message:e.message};}}

function validatePin(payload){
  var cfg=getConfig();
  var storedPin=String(cfg.CHECKIN_PIN||'');
  var submitted=String((payload&&payload.pin)||'');
  if(!storedPin)return {success:false,message:'No PIN configured. Set CHECKIN_PIN in Config.'};
  if(submitted===storedPin)return {success:true};
  return {success:false,message:'Invalid PIN'};
}

function getAllRegistrationsPwa(payload){
  try{
    var registrations=getAllRegistrations({status:'active'});
    return {success:true,registrations:registrations,timestamp:new Date().toISOString(),count:registrations.length};
  }catch(e){return {success:false,message:e.message};}
}

function getRecentCheckIns(payload){
  try{
    var maxRows=Number((payload&&payload.limit)||50);
    var sh=getSS().getSheetByName('CheckIns');
    var vals=sh.getDataRange().getValues();
    if(vals.length<=1)return {success:true,checkIns:[]};
    var rows=vals.slice(1).map(function(r){return {checkInId:r[0],timestamp:r[1],registrationId:r[2],name:r[3],church:r[4],method:r[5],adminUser:r[6]};});
    rows.sort(function(a,b){return new Date(b.timestamp)-new Date(a.timestamp);});
    return {success:true,checkIns:rows.slice(0,maxRows)};
  }catch(e){return {success:false,message:e.message};}
}

function recordCheckin(payload){
  return checkinById(payload.registrationId,'PWA-'+((payload&&payload.deviceId)||'unknown'));
}
