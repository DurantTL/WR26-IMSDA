function bccObj(){var b=getConfig().NOTIFICATION_EMAIL;return b?{bcc:b}:{};}
function sendConfirmationEmail(reg,edit,context){
  var isPaid=reg.paymentStatus==='paid'||reg.paymentStatus==='paid_onsite';
  var sub=isPaid?"Women's Retreat 2026 – Registration & Payment Confirmed":"Women's Retreat 2026 – Registration Received – Payment Required";
  // Prefer a real PWA portal magic link (works with the portal's token
  // validation). Fall back to the legacy edit_page_url+editToken only if no
  // PORTAL_URL is configured.
  var editUrl=portalMintLinkForRegistration_(reg,'confirmation');
  if(!editUrl)editUrl=edit?String(edit)+'?token='+encodeURIComponent(String(reg.editToken||'')):'';
  // Build attendee list from context.attendees (populated from a{N}_* form fields).
  // reg.firstName is the primary contact; attendee names come from a{N}_first/last_name.
  var ctxAttendees=(context&&Array.isArray(context.attendees)&&context.attendees.length)?context.attendees:[];
  var attendeeRows='';
  if(ctxAttendees.length){attendeeRows='<p><b>Registered Attendees:</b></p><ul>'+ctxAttendees.map(function(a){var name=escapeHtml(String(a.first_name||'').trim()+' '+String(a.last_name||'').trim());var type=a.attendee_type?(' ('+escapeHtml(String(a.attendee_type))+')'):'';return '<li>'+name+type+'</li>';}).join('')+'</ul>';}
  var amountDisplay=isPaid&&reg.amountPaid!=null?Number(reg.amountPaid):Number(reg.finalAmount||0);
  var discountLine=Number(reg.discountAmount)>0?'<p><b>Discount applied:</b> $'+escapeHtml(String(reg.discountAmount))+(reg.couponUsed||reg.promoCode?' (code: '+escapeHtml(String(reg.couponUsed||reg.promoCode))+')':'')+'</p>':'';
  var detailsBlock='<p><b>Church:</b> '+escapeHtml(reg.church)+'<br><b>Arrival:</b> '+escapeHtml(reg.arrivalDate)+'<br><b>Departure:</b> '+escapeHtml(reg.departureDate)+'</p>'+discountLine;
  var body='<p>Hello '+escapeHtml(reg.firstName)+',</p>';
  if(isPaid){
    body+='<p>Thank you for your payment of <b>$'+escapeHtml(String(amountDisplay))+'</b>. Your registration is fully confirmed!</p>';
    body+=attendeeRows+detailsBlock;
    if(editUrl)body+='<p><a href="'+escapeHtml(editUrl)+'">Edit your registration details</a></p>';
  }else{
    body+='<p>Your registration has been received. A balance of <b>$'+escapeHtml(String(amountDisplay))+'</b> is due.</p>';
    body+='<p style="font-size:1.1em;font-weight:bold;">Please use the link below to pay your registration fee online, or mail a check payable to IMSDA.</p>';
    body+=attendeeRows+detailsBlock;
    if(editUrl)body+='<p><a href="'+escapeHtml(editUrl)+'" style="font-size:1.1em;font-weight:bold;">Pay Online / Edit Registration</a></p>';
  }
  if(ctxAttendees.some(function(a){return String(a.childcare_needed||'').toLowerCase()==='yes'||String(a.childcare_needed||'').toLowerCase()==='true';}))body+='<p>'+escapeHtml(getConfig().CHILDCARE_MESSAGE)+'</p>';
  body+='<p><img src="'+escapeHtml(generateQRUrl(reg.qrToken))+'"/></p><p>Show this QR code at check-in.</p><p>IMSDA</p>';
  return sendEmailSafe_(Object.assign({to:reg.email,subject:sub,htmlBody:body},bccObj()));
}
function sendWaitlistEmail(w){return sendEmailSafe_(Object.assign({to:w.email,subject:"Women's Retreat 2026 – You're on the Waitlist",htmlBody:'<p>You are currently #'+escapeHtml(w.position)+' on the waitlist. No payment will be charged until promoted.</p>'},bccObj()));}
function sendWaitlistPromotionEmail(w,n,edit){var editUrl=portalMintLinkForRegistration_(n,'waitlist_promotion')||(String(edit||'')+'?token='+encodeURIComponent(String(n.editToken||'')));return sendEmailSafe_(Object.assign({to:n.email,subject:"Women's Retreat 2026 – Your Spot is Confirmed!",htmlBody:'<p>Great news! A spot opened up.</p><p>'+escapeHtml(n.firstName)+' '+escapeHtml(n.lastName)+'</p><p><a href="'+escapeHtml(editUrl)+'">Edit Registration</a></p><p><img src="'+escapeHtml(generateQRUrl(n.qrToken))+'"/></p>'},bccObj()));}
function sendTransferEmail(o,n,reason,refund,edit){var sub="Women's Retreat 2026 – Registration Transfer Confirmation";sendEmailSafe_(Object.assign({to:o.email,subject:sub,htmlBody:'<p>Your registration has been transferred out.</p><p>Reason: '+escapeHtml(reason||'')+'</p><p>Refund notes: '+escapeHtml(refund||'')+'</p>'},bccObj()));var editUrl=portalMintLinkForRegistration_(n,'transfer')||(String(edit||'')+'?token='+encodeURIComponent(String(n.editToken||'')));return sendEmailSafe_(Object.assign({to:n.email,subject:sub,htmlBody:'<p>Your transfer registration is confirmed.</p><p><a href="'+escapeHtml(editUrl)+'">Edit Registration</a></p><p><img src="'+escapeHtml(generateQRUrl(n.qrToken))+'"/></p>'},bccObj()));}
function sendEditConfirmationEmail(reg){return sendEmailSafe_(Object.assign({to:reg.email,subject:"Women's Retreat 2026 – Registration Updated",htmlBody:'<p>Your registration details were updated.</p><p>'+escapeHtml(reg.firstName)+' '+escapeHtml(reg.lastName)+' | '+escapeHtml(reg.church)+'</p>'},bccObj()));}
