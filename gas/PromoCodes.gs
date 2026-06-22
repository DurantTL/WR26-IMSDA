function normalizeDiscountType(discountType){var t=String(discountType||'').toLowerCase().trim();if(t==='fixed amount'||t==='fixed_amount'||t==='fixedamount'||t==='fixed'||t==='price'||t==='amount'||t==='dollar'||t==='dollars'||t==='flat'||t==='usd'||t==='$')return 'fixed';if(t==='percent'||t==='percentage'||t==='%')return 'percent';return '';}
// Defensive numeric parse for promo cells that may be typed as text ("$60", "1,200").
// Strips everything but digits, a decimal point, and a leading minus so a stray
// currency/grouping character never yields NaN. Blank/garbage reads as 0.
function promoNumber_(raw){var n=parseFloat(String(raw==null?'':raw).replace(/[^0-9.\-]/g,''));return isNaN(n)?0:n;}
function validateAndApplyPromoCode(code,originalAmount){var lock=LockService.getScriptLock();var acquired=false;try{acquired=lock.tryLock(8000);if(!acquired)return {valid:false,message:'Promo code is busy, please try again'};var s=getSS().getSheetByName('PromoCodes');var v=s.getDataRange().getValues();for(var i=1;i<v.length;i++){if(String(v[i][0]).toUpperCase()===String(code).toUpperCase()){var active=String(v[i][7]).toUpperCase()==='TRUE';if(!active)return {valid:false,message:'Inactive code'};if(v[i][6]){var exp=normalizeConfigDateEndOfDay(v[i][6]);if(exp&&exp<new Date())return {valid:false,message:'Expired'};}var max=promoNumber_(v[i][4]),cur=promoNumber_(v[i][5]),min=promoNumber_(v[i][8]);if(max>0&&cur>=max)return {valid:false,message:'Max uses reached'};if(Number(originalAmount)<min)return {valid:false,message:'Minimum purchase not met'};var dtype=normalizeDiscountType(v[i][2]);if(!dtype)return {valid:false,message:'Invalid discount type'};var d=dtype==='percent'?(Number(originalAmount)*promoNumber_(v[i][3])/100):promoNumber_(v[i][3]);d=Math.min(d,Number(originalAmount));s.getRange(i+1,6).setValue(cur+1);return {valid:true,discount:d,finalAmount:Number(originalAmount)-d,message:'Applied'};}}return {valid:false,message:'Invalid code'};}catch(e){return {valid:false,message:e.message};}finally{if(acquired)lock.releaseLock();}}
function getPromoCodes(){var rows=getSS().getSheetByName('PromoCodes').getDataRange().getValues().slice(1);return {success:true,promoCodes:rows.map(function(r){return {code:r[0],description:r[1],discountType:r[2],discountAmount:r[3],maxUses:r[4],currentUses:r[5],expiryDate:r[6],active:r[7],minPurchase:r[8]};})};}
function savePromoCode(payload){try{if(!payload.code||!payload.discountType||payload.discountAmount==='')return {success:false,message:'Missing required fields'};var dtype=normalizeDiscountType(payload.discountType);if(!dtype)return {success:false,message:'discountType must be percent or fixed'};var s=getSS().getSheetByName('PromoCodes');var v=s.getDataRange().getValues();for(var i=1;i<v.length;i++)if(String(v[i][0]).toUpperCase()===String(payload.code).toUpperCase()){s.getRange(i+1,1,1,9).setValues([[payload.code,payload.description||'',dtype,Number(payload.discountAmount||0),Number(payload.maxUses||0),Number(payload.currentUses||0),payload.expiryDate||'',String(payload.active).toUpperCase()==='TRUE',Number(payload.minPurchase||0)]]);return {success:true,updated:true};}
s.appendRow([payload.code,payload.description||'',dtype,Number(payload.discountAmount||0),Number(payload.maxUses||0),0,payload.expiryDate||'',String(payload.active).toUpperCase()==='TRUE',Number(payload.minPurchase||0)]);return {success:true,created:true};}catch(e){return {success:false,message:e.message};}}
function deletePromoCode(code){try{var s=getSS().getSheetByName('PromoCodes');var v=s.getDataRange().getValues();for(var i=1;i<v.length;i++)if(String(v[i][0]).toUpperCase()===String(code).toUpperCase()){s.getRange(i+1,8).setValue(false);return {success:true};}return {success:false,message:'Not found'};}catch(e){return {success:false,message:e.message};}}

// ---- TEMP VERIFICATION (delete after testing) -----------------------------
// Run from the Apps Script editor (Run ▸ wr26TestPromoCodes_, then View ▸ Logs).
// Exercises the two live "Price"-typed codes through validateAndApplyPromoCode and
// then RESTORES the Current Uses each call consumed, so it's safe to run repeatedly.
// Expected: Scholarship 1858156442 → valid:true, discount 60 on a $125 order;
// Presenters 1844 → valid:true, discount 25 on a $145 order (both previously failed
// with "Invalid discount type" because Discount Type is stored as "Price").
function wr26TestPromoCodes_(){
  var cases=[{code:'1858156442',amount:125,expect:60},{code:'1844',amount:145,expect:25}];
  var s=getSS().getSheetByName('PromoCodes');
  cases.forEach(function(c){
    var before=_promoCurrentUses_(s,c.code);
    var r=validateAndApplyPromoCode(c.code,c.amount);
    Logger.log(c.code+' @ $'+c.amount+' -> '+JSON.stringify(r)+' (expected discount '+c.expect+')');
    var after=_promoCurrentUses_(s,c.code);
    if(r&&r.valid&&after.row>0&&after.uses===before.uses+1){s.getRange(after.row,6).setValue(before.uses);Logger.log('  rolled back Current Uses '+after.uses+' -> '+before.uses+' for '+c.code);}
  });
}
function _promoCurrentUses_(s,code){var v=s.getDataRange().getValues();for(var i=1;i<v.length;i++)if(String(v[i][0]).toUpperCase()===String(code).toUpperCase())return {row:i+1,uses:promoNumber_(v[i][5])};return {row:-1,uses:0};}
// ---- END TEMP VERIFICATION ------------------------------------------------
