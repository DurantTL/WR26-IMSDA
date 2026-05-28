function getSS(){return SpreadsheetApp.getActiveSpreadsheet();}
function randHex4(){return ('0000'+Math.floor(Math.random()*65535).toString(16)).slice(-4).toUpperCase();}
function generateRegistrationId(){return 'WR26-'+Date.now()+'-'+randHex4();}
function generateWaitlistId(){return 'WL26-'+Date.now()+'-'+randHex4();}
function generateQRUrl(token){return 'https://api.qrserver.com/v1/create-qr-code/?data='+encodeURIComponent(token)+'&size=200x200';}
function formatDate(d){return Utilities.formatDate(new Date(d),Session.getScriptTimeZone(),'M/d/yyyy h:mm a');}
// Deduplication strategy: match by Fluent Forms entry ID (column 21 = ffEntryId),
// NOT by attendee name/phone. This prevents double-processing the same form
// submission (e.g. from queue retries). A different primary contact registering
// the same attendee on a separate submission is intentionally allowed through.
function isDuplicateEntry(entryId){var s=getSS().getSheetByName('Registrations');if(!s||s.getLastRow()<2)return false;var v=s.getRange(2,21,s.getLastRow()-1,1).getValues();return v.some(function(r){return String(r[0])===String(entryId);});}
function isDuplicateWaitlistEntry(entryId){var s=getSS().getSheetByName('Waitlist');if(!s||s.getLastRow()<2)return false;var v=s.getRange(2,8,s.getLastRow()-1,1).getValues();return v.some(function(r){return String(r[0])===String(entryId);});}
function checkCapacity(){try{var cfg=getConfig()||{};var capacity=Number(cfg.CAPACITY||350);if(isNaN(capacity)||capacity<0)capacity=350;var active=getAllRegistrations({status:'active'}).length;var available=Math.max(capacity-active,0);return {success:true,capacity:capacity,active:active,available:available,full:available<1};}catch(e){return {success:false,message:e.message,capacity:Number((getConfig()||{}).CAPACITY||350)||350,active:0,available:0,full:false};}}
function jsonResponse(data){return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);}

// Run fn() while holding the script lock so check-then-write critical sections
// (capacity check + register, waitlist promotion, promo-counter increment) cannot
// interleave across concurrent executions. GAS script locks are reentrant within
// the same execution, so nested lock-using helpers (e.g. validateAndApplyPromoCode)
// are safe to call inside. Returns fn()'s result, or a busy error on timeout.
function withScriptLock_(fn,timeoutMs){var lock=LockService.getScriptLock();var acquired=false;try{acquired=lock.tryLock(timeoutMs||10000);if(!acquired)return {success:false,message:'System is busy, please try again.',lockTimeout:true};return fn();}finally{if(acquired)lock.releaseLock();}}

function isValidEmail_(e){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e||'').trim());}

// Never let a missing/invalid address or a MailApp error abort the caller (e.g. a
// registration that is already written). Returns {sent:true} or {sent:false,reason}.
function sendEmailSafe_(opts){try{if(!opts||!isValidEmail_(opts.to)){Logger.log('sendEmailSafe_: skipped invalid/blank recipient: '+String(opts&&opts.to));return {sent:false,reason:'invalid_email'};}MailApp.sendEmail(opts);return {sent:true};}catch(e){Logger.log('sendEmailSafe_: send failed for '+String(opts.to)+': '+e.message);return {sent:false,reason:e.message};}}

function escapeHtml(value){var str=String(value===undefined||value===null?'':value);return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
