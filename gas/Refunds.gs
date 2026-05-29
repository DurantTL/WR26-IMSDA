// Refunds are stored in a dedicated Refunds sheet (additive — does NOT touch the
// fixed Registrations column map). A refund updates the registration's payment
// status to 'partial_refund' or 'refunded' based on how much has been collected,
// appends a dated Admin Note, and is audit-logged. Multiple partial refunds on the
// same registration accumulate.
var WR26_REFUND_METHODS={cash:true,check:true,square:true,square_onsite:true,card:true,other:true};

function ensureRefundsSheet_(){
  var ss=getSS();var sh=ss.getSheetByName('Refunds');
  var headers=['Refund ID','Timestamp','Registration ID','Name','Amount','Method','Reason','Status','Refunded By','Notes'];
  if(!sh){sh=ss.insertSheet('Refunds');sh.getRange(1,1,1,headers.length).setValues([headers]);return sh;}
  if(sh.getLastRow()===0)sh.getRange(1,1,1,headers.length).setValues([headers]);
  return sh;
}

function rowToRefund_(r){return {refundId:r[0],timestamp:r[1],registrationId:r[2],name:r[3],amount:Number(r[4]||0),method:r[5],reason:r[6],status:r[7],refundedBy:r[8],notes:r[9]};}

function getRefunds(){try{var sh=ensureRefundsSheet_();var v=sh.getDataRange().getValues();return {success:true,refunds:v.slice(1).filter(function(r){return String(r[0]||'').trim();}).map(rowToRefund_)};}catch(e){return {success:false,message:e.message};}}

function getRefundsForRegistration_(registrationId){var sh=getSS().getSheetByName('Refunds');if(!sh)return [];var v=sh.getDataRange().getValues();return v.slice(1).filter(function(r){return String(r[2])===String(registrationId);}).map(rowToRefund_);}

function totalRefundedForRegistration_(registrationId){return getRefundsForRegistration_(registrationId).reduce(function(sum,r){return sum+Number(r.amount||0);},0);}

// Record a refund. payload: {registrationId, amount, method, reason, refundNotes, adminUser}.
function recordRefund(payload){
  return withScriptLock_(function(){
    try{
      var registrationId=String((payload&&payload.registrationId)||'').trim();
      if(!registrationId)return {success:false,message:'registrationId is required'};
      var amount=Number(payload.amount);
      if(!isFinite(amount)||amount<=0)return {success:false,message:'amount must be a positive number'};
      var reg=getRegistrationById(registrationId);
      if(!reg)return {success:false,message:'Registration not found'};
      var method=String(payload.method||'other').toLowerCase().trim();
      if(!WR26_REFUND_METHODS[method])method='other';
      var collected=Number(reg.amountPaid!=null?reg.amountPaid:0);
      var priorRefunded=totalRefundedForRegistration_(registrationId);
      var totalRefunded=Math.round((priorRefunded+amount)*100)/100;
      // 'refunded' once cumulative refunds cover everything that was collected;
      // otherwise 'partial_refund'. If nothing was recorded as collected we still
      // honor the refund request and mark it fully refunded.
      var status=(collected<=0||totalRefunded>=collected-0.01)?'refunded':'partial_refund';
      var refundId='RF-'+Date.now()+'-'+randHex4();
      var name=(reg.firstName+' '+reg.lastName).trim();
      ensureRefundsSheet_().appendRow([refundId,new Date(),registrationId,name,Math.round(amount*100)/100,method,String(payload.reason||''),status,String(payload.adminUser||'admin'),String(payload.refundNotes||'')]);
      var note='['+new Date().toISOString()+'] Refund $'+(Math.round(amount*100)/100)+' ('+method+') by '+(payload.adminUser||'admin')+'. Status: '+status+'. Total refunded to date: $'+totalRefunded+'.'+(payload.reason?(' Reason: '+payload.reason+'.'):'');
      var upd=updateRegistration(registrationId,{paymentStatus:status,adminNotes:(reg.adminNotes?reg.adminNotes+'\n':'')+note});
      if(!upd.success)return upd;
      logAudit_('refund',registrationId,payload.adminUser||'admin','Amount $'+amount+' ('+method+'), status '+status+', total refunded $'+totalRefunded);
      return {success:true,refundId:refundId,status:status,totalRefunded:totalRefunded,registration:getRegistrationById(registrationId)};
    }catch(e){return {success:false,message:e.message};}
  });
}
