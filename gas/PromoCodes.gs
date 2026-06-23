function normalizeDiscountType(discountType){var t=String(discountType||'').toLowerCase().trim();if(t==='fixed amount'||t==='fixed_amount'||t==='fixedamount'||t==='fixed'||t==='price'||t==='amount'||t==='dollar'||t==='dollars'||t==='flat'||t==='usd'||t==='$')return 'fixed';if(t==='percent'||t==='percentage'||t==='%')return 'percent';return '';}
// Defensive numeric parse for promo cells that may be typed as text ("$60", "1,200").
// Strips everything but digits, a decimal point, and a leading minus so a stray
// currency/grouping character never yields NaN. Blank/garbage reads as 0.
function promoNumber_(raw){var n=parseFloat(String(raw==null?'':raw).replace(/[^0-9.\-]/g,''));return isNaN(n)?0:n;}
// Robust truthiness for the PromoCodes "Active" cell. A checkbox reads as a real
// boolean, but a hand-typed cell may say TRUE / Yes / Y / 1 / Active / x — all of
// which a staffer reasonably means as "on". Only an explicit negative
// (FALSE/No/N/0/Inactive/Disabled/Off) or a blank cell counts as inactive. This
// mirrors the defensive parsing already used for Discount Type ("Price") and the
// numeric cells, and closes the same silent-failure trap: a code that looks active
// in the sheet but never applies because the cell isn't the literal word TRUE.
function promoIsActive_(raw){if(raw===true)return true;if(raw===false)return false;var t=String(raw==null?'':raw).trim().toLowerCase();if(t==='')return false;if(t==='false'||t==='no'||t==='n'||t==='0'||t==='inactive'||t==='disabled'||t==='off')return false;return true;}
// `units` (default 1) is the attendee count: a FIXED-amount code is a per-lady
// scholarship that discounts perLady x N and consumes N Max-Uses slots; a PERCENT
// code is one transaction on the whole party total and consumes exactly ONE use.
function validateAndApplyPromoCode(code,originalAmount,units){var n=Math.max(parseInt(units,10)||1,1);var lock=LockService.getScriptLock();var acquired=false;try{acquired=lock.tryLock(8000);if(!acquired)return {valid:false,message:'Promo code is busy, please try again'};var s=getSS().getSheetByName('PromoCodes');var v=s.getDataRange().getValues();for(var i=1;i<v.length;i++){if(String(v[i][0]).toUpperCase()===String(code).toUpperCase()){var active=promoIsActive_(v[i][7]);if(!active)return {valid:false,message:'Inactive code'};if(v[i][6]){var exp=normalizeConfigDateEndOfDay(v[i][6]);if(exp&&exp<new Date())return {valid:false,message:'Expired'};}var max=promoNumber_(v[i][4]),cur=promoNumber_(v[i][5]),min=promoNumber_(v[i][8]);
// Resolve the discount TYPE first — consumption depends on it (a fixed code takes
// one slot per lady), so this must precede the Max-Uses check.
var dtype=normalizeDiscountType(v[i][2]);if(!dtype)return {valid:false,message:'Invalid discount type'};var consume=(dtype==='fixed')?n:1;
// Enforce Max-Uses against the slots THIS application would consume, not 1, and
// report how many of the needed slots actually remain.
if(max>0&&(cur+consume)>max)return {valid:false,message:'Max uses reached — only '+Math.max(max-cur,0)+' of the '+consume+' slot(s) needed remain'};if(Number(originalAmount)<min)return {valid:false,message:'Minimum purchase not met'};
// FIXED = perLady x N (per-lady scholarship). PERCENT already scales with the party
// total, so it is applied once to originalAmount and NOT multiplied by N.
var d=dtype==='percent'?(Number(originalAmount)*promoNumber_(v[i][3])/100):(promoNumber_(v[i][3])*n);d=Math.min(d,Number(originalAmount));s.getRange(i+1,6).setValue(cur+consume);return {valid:true,discount:d,finalAmount:Number(originalAmount)-d,discountType:dtype,unitsApplied:n,message:'Applied'};}}return {valid:false,message:'Invalid code'};}catch(e){return {valid:false,message:e.message};}finally{if(acquired)lock.releaseLock();}}
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
  var s=getSS().getSheetByName('PromoCodes');
  // units defaults to 1 (per-party). The per-lady case passes units=3 so a $60 FIXED
  // scholarship discounts $180 and consumes 3 slots. `consume` tells the rollback how
  // many slots to restore so each call leaves Current Uses unchanged.
  var cases=[
    {code:'1858156442',amount:125,units:1,expect:60,consume:1},
    {code:'1844',amount:145,units:1,expect:25,consume:1},
    {code:'1858156442',amount:375,units:3,expect:180,consume:3}
  ];
  cases.forEach(function(c){
    var before=_promoCurrentUses_(s,c.code);
    var r=validateAndApplyPromoCode(c.code,c.amount,c.units);
    Logger.log(c.code+' x'+c.units+' @ $'+c.amount+' -> '+JSON.stringify(r)+' (expected discount '+c.expect+')');
    var after=_promoCurrentUses_(s,c.code);
    if(r&&r.valid&&after.row>0&&after.uses===before.uses+c.consume){s.getRange(after.row,6).setValue(before.uses);Logger.log('  rolled back Current Uses '+after.uses+' -> '+before.uses+' for '+c.code);}
  });
  // Grow-past-cap rejection: temporarily clamp Max Uses so only ONE slot remains, then
  // ask for 3 (a FIXED code at units=3 needs 3). Expect valid:false and — because the
  // cap check returns BEFORE writing Current Uses — zero consumption. Restore Max Uses.
  (function(){
    var code='1858156442';
    var loc=_promoCurrentUses_(s,code);
    if(loc.row<=0){Logger.log('cap-reject test skipped: '+code+' not found');return;}
    var maxCell=s.getRange(loc.row,5);
    var origMax=maxCell.getValue();
    maxCell.setValue(loc.uses+1); // leave exactly one slot
    var r=validateAndApplyPromoCode(code,375,3);
    var after=_promoCurrentUses_(s,code);
    Logger.log(code+' grow-past-cap (need 3, 1 left) -> '+JSON.stringify(r)+' (expected valid:false, no consumption)');
    if(after.uses!==loc.uses)Logger.log('  WARNING: rejected call consumed slots ('+loc.uses+' -> '+after.uses+')');
    maxCell.setValue(origMax); // restore live Max Uses
  })();
}
function _promoCurrentUses_(s,code){var v=s.getDataRange().getValues();for(var i=1;i<v.length;i++)if(String(v[i][0]).toUpperCase()===String(code).toUpperCase())return {row:i+1,uses:promoNumber_(v[i][5])};return {row:-1,uses:0};}
// ---- END TEMP VERIFICATION ------------------------------------------------
