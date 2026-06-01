// Pending-charge reminder emails ("did you forget the following?") for pay-later
// registrations that still owe a balance. Run on demand from the staff PWA
// (action: sendPendingChargeReminders) — no automatic time trigger is installed.
//
// A registration is "owing" when its payment status is a pending/offline state and
// the amount collected so far is less than the amount billed. Paid, refunded,
// transferred, cancelled, and waitlist statuses are skipped.

var WR26_REMINDER_SKIP_STATUSES={paid:true,paid_onsite:true,refunded:true,partial_refund:true,transferred:true,transferred_registration:true,cancelled:true,worker_no_charge:true};

function registrationOwesBalance_(reg){
  var status=String(reg.paymentStatus||'').toLowerCase();
  if(WR26_REMINDER_SKIP_STATUSES[status])return false;
  if(String(reg.status||'').toLowerCase()!=='active')return false;
  var billed=Number(reg.finalAmount||0);
  if(billed<=0)return false;
  var collected=Number(reg.amountPaid!=null?reg.amountPaid:0);
  return (billed-collected)>0.01;
}

function sendPendingChargeReminderEmail_(reg,editPageUrl){
  var billed=Number(reg.finalAmount||0);
  var collected=Number(reg.amountPaid!=null?reg.amountPaid:0);
  var balance=Math.round((billed-collected)*100)/100;
  var editUrl=portalMintLinkForRegistration_(reg,'payment_reminder');
  if(!editUrl)editUrl=editPageUrl?String(editPageUrl)+'?token='+encodeURIComponent(String(reg.editToken||'')):'';
  var cfg=getConfig()||{};
  var body='<p>Hello '+escapeHtml(reg.firstName)+',</p>';
  body+='<p style="font-size:1.15em;font-weight:bold;">This is a friendly reminder that your '+escapeHtml(cfg.EVENT_NAME||"Women's Retreat 2026")+' registration still has a balance due.</p>';
  body+='<p><b>Amount still due: $'+escapeHtml(String(balance))+'</b>'+(collected>0?(' (of $'+escapeHtml(String(billed))+' total; $'+escapeHtml(String(collected))+' received)'):'')+'</p>';
  body+='<p>Did you forget to complete your payment? You can pay securely by card using the button below, or mail a check payable to IMSDA.</p>';
  body+=squarePayButtonHtml_(reg);
  if(editUrl)body+='<p><a href="'+escapeHtml(editUrl)+'">Manage your registration</a></p>';
  body+='<p>If you have already paid, please disregard this message. Thank you!</p><p>IMSDA</p>';
  return sendEmailSafe_(Object.assign({to:reg.email,subject:(cfg.EVENT_NAME||"Women's Retreat 2026")+' – Payment Reminder: Balance Due',htmlBody:body},bccObj()));
}

// payload: {dryRun, registrationId, adminUser, edit_page_url}. If registrationId is
// given, only that registration is reminded; otherwise all owing registrations.
function sendPendingChargeReminders(payload){
  try{
    var cfg=getConfig()||{};
    var editPageUrl=(payload&&payload.edit_page_url)||cfg.EDIT_PAGE_URL||'';
    var dryRun=!!(payload&&payload.dryRun);
    var only=String((payload&&payload.registrationId)||'').trim();
    var regs=getAllRegistrations({status:'active'}).filter(registrationOwesBalance_);
    if(only)regs=regs.filter(function(r){return String(r.registrationId)===only;});
    var sent=0,skipped=0,failed=0,details=[];
    regs.forEach(function(reg){
      if(dryRun){var bal=Math.round((Number(reg.finalAmount||0)-Number(reg.amountPaid!=null?reg.amountPaid:0))*100)/100;details.push({registrationId:reg.registrationId,email:reg.email,balance:bal,wouldSend:isValidEmail_(reg.email)});if(!isValidEmail_(reg.email))skipped++;return;}
      var res=sendPendingChargeReminderEmail_(reg,editPageUrl);
      if(res&&res.sent){sent++;details.push({registrationId:reg.registrationId,email:reg.email,sent:true});}
      else if(res&&res.reason==='invalid_email'){skipped++;details.push({registrationId:reg.registrationId,email:reg.email,sent:false,reason:'invalid_email'});}
      else{failed++;details.push({registrationId:reg.registrationId,email:reg.email,sent:false,reason:(res&&res.reason)||'unknown'});}
    });
    if(!dryRun)logAudit_('pendingReminder',only||'',(payload&&payload.adminUser)||'admin','Reminders sent: '+sent+', skipped: '+skipped+', failed: '+failed);
    return {success:true,dryRun:dryRun,owing:regs.length,sent:sent,skipped:skipped,failed:failed,details:details};
  }catch(e){return {success:false,message:e.message};}
}
