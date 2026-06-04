// Square hosted payment links for the PAY-LATER path.
//
// Card payments made AT registration are charged inline by Fluent Forms' Square
// gateway (card-with-no-promo). This module covers everything else: any
// registrant who owes a balance (pay-later, or card+promo who was steered to
// pay-later by the form). GAS already computes the correct, discounted balance,
// so here we create a Square-hosted "quick pay" checkout link for that exact
// amount and drop it into the confirmation / reminder emails. Square hosts the
// card capture — no card data ever touches GAS or the PWA.
//
// CREDENTIALS live in Script Properties (Apps Script editor → Project Settings →
// Script properties), NOT in the Config sheet or the repo:
//   SQUARE_ACCESS_TOKEN  - Square access token (matching the environment below)
//   SQUARE_LOCATION_ID   - Square location ID to attribute payments to
//   SQUARE_ENVIRONMENT   - 'production' (default) or 'sandbox'
// If these are unset, link creation is skipped and emails fall back to the
// existing "pay online / mail a check" instructions — nothing breaks.

function squareConfig_(){
  var p=PropertiesService.getScriptProperties();
  return {
    token:String(p.getProperty('SQUARE_ACCESS_TOKEN')||'').trim(),
    locationId:String(p.getProperty('SQUARE_LOCATION_ID')||'').trim(),
    env:String(p.getProperty('SQUARE_ENVIRONMENT')||'production').trim().toLowerCase()
  };
}

function squareIsConfigured_(){var c=squareConfig_();return !!(c.token&&c.locationId);}

function squareApiBase_(env){return env==='sandbox'?'https://connect.squareupsandbox.com':'https://connect.squareup.com';}

// Manual diagnostic — run from the Apps Script editor (Run ▸ wr26TestSquareConfig,
// then View ▸ Logs). Attempts a real $1.00 hosted payment link so credential,
// location-ID, and environment problems surface as Square's actual error
// (e.g. "Location `IMSDAREG` not found" or AUTHENTICATION_ERROR) instead of the
// pay button silently failing to appear. Never logs the access token itself.
function wr26TestSquareConfig(){
  var c=squareConfig_();
  var out={environment:c.env,apiBase:squareApiBase_(c.env),hasToken:!!c.token,tokenLength:c.token?c.token.length:0,locationId:c.locationId};
  if(!c.token||!c.locationId){out.ok=false;out.message='Missing SQUARE_ACCESS_TOKEN or SQUARE_LOCATION_ID in Script Properties.';Logger.log(JSON.stringify(out,null,2));return out;}
  try{
    var res=UrlFetchApp.fetch(squareApiBase_(c.env)+'/v2/online-checkout/payment-links',{
      method:'post',contentType:'application/json',
      headers:{Authorization:'Bearer '+c.token,'Square-Version':'2024-10-17'},
      payload:JSON.stringify({idempotency_key:'wr26-test-'+Date.now(),quick_pay:{name:'WR26 Square config test',price_money:{amount:100,currency:'USD'},location_id:c.locationId}}),
      muteHttpExceptions:true
    });
    var code=res.getResponseCode();var body=res.getContentText()||'';
    out.httpCode=code;out.ok=(code>=200&&code<300);
    try{var j=JSON.parse(body);if(out.ok&&j.payment_link){out.paymentLinkUrl=j.payment_link.url;}else{out.error=j.errors||body;}}catch(e){out.error=body.slice(0,500);}
  }catch(e){out.ok=false;out.error=e.message;}
  Logger.log(JSON.stringify(out,null,2));
  return out;
}

// Manual diagnostic — run from the Apps Script editor (Run ▸ wr26ListSquareLocations,
// then View ▸ Logs) to list the VALID location IDs your access token can use. Square
// location IDs are machine-generated (e.g. "L8FX2K9ABC123"), not a name you pick, so
// when wr26TestSquareConfig reports "Invalid location id", run this, copy the right
// `id`, and paste it into the SQUARE_LOCATION_ID Script Property. Never logs the token.
function wr26ListSquareLocations(){
  var c=squareConfig_();
  var out={environment:c.env,apiBase:squareApiBase_(c.env),hasToken:!!c.token};
  if(!c.token){out.ok=false;out.message='Missing SQUARE_ACCESS_TOKEN in Script Properties.';Logger.log(JSON.stringify(out,null,2));return out;}
  try{
    var res=UrlFetchApp.fetch(squareApiBase_(c.env)+'/v2/locations',{
      method:'get',
      headers:{Authorization:'Bearer '+c.token,'Square-Version':'2024-10-17'},
      muteHttpExceptions:true
    });
    var code=res.getResponseCode();var body=res.getContentText()||'';
    out.httpCode=code;out.ok=(code>=200&&code<300);
    var j=JSON.parse(body||'{}');
    if(out.ok&&Array.isArray(j.locations)){
      // Surface just what you need to pick the right one: id, name, and status.
      out.currentSquareLocationId=c.locationId||'(unset)';
      out.locations=j.locations.map(function(loc){return {id:loc.id,name:loc.name,status:loc.status};});
      out.hint='Copy the `id` of the location you want into the SQUARE_LOCATION_ID Script Property.';
    }else{out.error=j.errors||body.slice(0,500);}
  }catch(e){out.ok=false;out.error=e.message;}
  Logger.log(JSON.stringify(out,null,2));
  return out;
}

// Create a Square-hosted quick-pay checkout link for `amount` USD (a Number of
// dollars). Returns the checkout URL string, or '' on any failure (logged, never
// throws). A stable idempotency key derived from referenceId + amount means
// re-sending a reminder for the same balance reuses the same Square link instead
// of creating duplicates.
function createSquarePaymentLink_(amount,name,referenceId){
  try{
    var cfg=squareConfig_();
    if(!cfg.token||!cfg.locationId)return '';
    var cents=Math.round(Number(amount||0)*100);
    if(!(cents>0))return '';
    var idem=referenceId?(String(referenceId)+'-'+cents).slice(0,128):Utilities.getUuid();
    var payload={
      idempotency_key:idem,
      quick_pay:{
        name:String(name||"Women's Retreat 2026 Registration").slice(0,255),
        price_money:{amount:cents,currency:'USD'},
        location_id:cfg.locationId
      }
    };
    if(referenceId)payload.payment_note=('Ref: '+String(referenceId)).slice(0,500);
    var res=UrlFetchApp.fetch(squareApiBase_(cfg.env)+'/v2/online-checkout/payment-links',{
      method:'post',
      contentType:'application/json',
      headers:{Authorization:'Bearer '+cfg.token,'Square-Version':'2024-10-17'},
      payload:JSON.stringify(payload),
      muteHttpExceptions:true
    });
    var code=res.getResponseCode();
    var body=JSON.parse(res.getContentText()||'{}');
    if(code>=200&&code<300&&body.payment_link&&body.payment_link.url)return String(body.payment_link.url);
    Logger.log('createSquarePaymentLink_ failed ('+code+'): '+res.getContentText());
    return '';
  }catch(e){Logger.log('createSquarePaymentLink_ error: '+e.message);return '';}
}

// Build a pay link for a registration's outstanding balance. The card-processing
// fee (Config SQUARE_FEE_*) is added so paying the balance by card is consistent
// with the inline card path and on-site Square. Returns
// {url, base, fee, total} or null when not configured / nothing owed.
function squarePaymentInfoForRegistration_(reg){
  try{
    if(!reg||!squareIsConfigured_())return null;
    var billed=Number(reg.finalAmount||0);
    var collected=Number(reg.amountPaid!=null?reg.amountPaid:0);
    var balance=Math.round((billed-collected)*100)/100;
    if(!(balance>0))return null;
    var feeInfo=(typeof calculateSquareFee==='function')?calculateSquareFee(balance):{base:balance,fee:0,total:balance};
    var charge=Number(feeInfo.total||balance);
    var who=(String(reg.firstName||'')+' '+String(reg.lastName||'')).trim();
    var url=createSquarePaymentLink_(charge,"Women's Retreat 2026"+(who?(' – '+who):''),reg.registrationId);
    if(!url)return null;
    return {url:url,base:Number(feeInfo.base||balance),fee:Number(feeInfo.fee||0),total:charge};
  }catch(e){Logger.log('squarePaymentInfoForRegistration_ error: '+e.message);return null;}
}

// HTML "Pay by Card" button for the registration's balance, or '' when Square is
// not configured / nothing is owed. Safe to inline in any pay-later email.
function squarePayButtonHtml_(reg){
  var info=squarePaymentInfoForRegistration_(reg);
  if(!info)return '';
  var feeNote=info.fee>0?(' (includes a $'+info.fee.toFixed(2)+' card processing fee)'):'';
  return '<p><a href="'+escapeHtml(info.url)+'" style="display:inline-block;background:#7c3aed;color:#ffffff;padding:12px 22px;border-radius:8px;font-size:1.1em;font-weight:bold;text-decoration:none;">Pay $'+escapeHtml(info.total.toFixed(2))+' by Card Now</a></p>'+
    '<p style="font-size:0.9em;color:#5b6470;margin-top:4px;">Secure checkout hosted by Square'+feeNote+'. Or mail a check payable to IMSDA.</p>';
}

// Record a PAY-LATER Square payment-link payment as collected. Driven by the
// Square webhook, which the PWA server verifies (HMAC signature) before forwarding
// here — Apps Script web apps can't read the request headers needed to verify
// Square's signature, so the PWA does that and calls this action with the SECRET.
// Idempotent on the Square payment id, so Square's duplicate `payment.created` /
// `payment.updated` deliveries and retries never double-count. payload:
// {registrationId, amountPaid (USD), squarePaymentId, squareOrderId, source}.
function recordSquareLinkPayment(payload){
  try{
    var registrationId=String((payload&&payload.registrationId)||'').trim();
    if(!registrationId)return {success:false,message:'Registration not found'};
    var paymentId=String((payload&&payload.squarePaymentId)||'').trim();
    var amount=Math.round(Number((payload&&payload.amountPaid)||0)*100)/100;
    if(!(amount>0))return {success:false,message:'Invalid payment amount'};
    return withScriptLock_(function(){
      var existing=getRegistrationById(registrationId);
      if(!existing)return {success:false,message:'Registration not found'};
      // Idempotency: a payment id we've already filed (in the Square ID column or a
      // prior note) is a duplicate/retried delivery — acknowledge without re-applying.
      if(paymentId&&(String(existing.squarePaymentId||'').indexOf(paymentId)>-1||String(existing.adminNotes||'').indexOf(paymentId)>-1))
        return {success:true,alreadyRecorded:true,registration:existing};
      var owed=Number(existing.finalAmount||0);
      var priorPaid=Number(existing.amountPaid!=null?existing.amountPaid:0);
      var totalCollected=Math.round((priorPaid+amount)*100)/100;
      // The hosted link charges base+fee, so a full settlement lands at/above the
      // owed base; only a deliberate underpayment stays 'partial'.
      var status=(owed>0&&totalCollected<owed-0.01)?'partial':'paid';
      var note='['+new Date().toISOString()+'] Square online payment received: $'+amount+'.'+(paymentId?(' Square payment '+paymentId+'.'):'')+' Total collected to date: $'+totalCollected+'.'+(status==='partial'?(' Balance remaining: $'+(Math.round((owed-totalCollected)*100)/100)+'.'):'');
      var squareIds=existing.squarePaymentId?(String(existing.squarePaymentId)+(paymentId?(','+paymentId):'')):paymentId;
      var updated=updateRegistration(registrationId,{paymentStatus:status,squarePaymentId:squareIds,amountPaid:totalCollected,adminNotes:(existing.adminNotes?existing.adminNotes+'\n':'')+note});
      if(!updated.success)return updated;
      logAudit_('squareLinkPayment',registrationId,(payload&&payload.source)||'square-webhook','Amount: $'+amount+', Total: $'+totalCollected+', Status: '+status+(paymentId?(', Payment: '+paymentId):''));
      return {success:true,registration:getRegistrationById(registrationId),amountThisTransaction:amount,totalCollected:totalCollected,status:status};
    });
  }catch(e){return {success:false,message:e.message};}
}
