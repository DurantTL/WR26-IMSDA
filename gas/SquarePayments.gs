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
