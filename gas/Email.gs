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
  // Arrival/Departure are no longer collected at registration, so only show them
  // when a value exists (e.g. older records or admin-entered dates).
  var dateBits=[];if(reg.arrivalDate)dateBits.push('<b>Arrival:</b> '+escapeHtml(reg.arrivalDate));if(reg.departureDate)dateBits.push('<b>Departure:</b> '+escapeHtml(reg.departureDate));
  var detailsBlock='<p><b>Church:</b> '+escapeHtml(reg.church)+(dateBits.length?'<br>'+dateBits.join('<br>'):'')+'</p>'+discountLine;
  // Payment status block. Paid registrations get a thank-you; pay-later
  // registrations get the balance-due notice plus a Square "Pay by Card" button
  // when Square is configured. When it is NOT configured the button is empty, so
  // we must not reference a "card link below" that isn't there — fall back to the
  // check / follow-up-link wording and point at the portal (which carries its own
  // Pay-by-Card button once Square is set up).
  var payButton=isPaid?'':squarePayButtonHtml_(reg);
  var paymentBlock=isPaid
    ? '<p>Thank you for your payment of <b>$'+escapeHtml(String(amountDisplay))+'</b>. Your registration is fully confirmed!</p>'
    : '<p>A balance of <b>$'+escapeHtml(String(amountDisplay))+'</b> is due.</p>'+
      (payButton
        ? '<p style="font-size:1.1em;font-weight:bold;">Please pay your registration fee using the secure card button below, or mail a check payable to IMSDA. You can also pay anytime from your registration portal (link below).</p>'+payButton
        : '<p style="font-size:1.1em;font-weight:bold;">Please mail a check payable to IMSDA. If you would prefer to pay by card, open your registration portal using the link below and use the “Pay by Card” button there.</p>');
  var editLink=editUrl?'<p><a href="'+escapeHtml(editUrl)+'">'+(isPaid?'Edit your registration details':'View, pay, or edit your registration')+'</a></p>':'';
  var qrBlock='<p><img src="'+escapeHtml(generateQRUrl(reg.qrToken))+'"/></p><p>Show this QR code at check-in.</p>';
  // Final approved informational copy (IA-MO Women's Ministries). Static prose,
  // so no escaping needed; the hotel URL's "&" are written as "&amp;" so email
  // clients don't mangle params like "&regionCode" into the "®" entity.
  var info=`
<p><b>Hotel Reservations</b></p>
<p>Please remember to reserve your hotel room <a href="https://www.ihg.com/redirect?path=rates&amp;brandCode=HI&amp;regionCode=1&amp;localeCode=en&amp;checkInMonthYear=092026&amp;checkInDate=8&amp;checkOutDate=11&amp;checkOutMonthYear=092026&amp;hotelCode=DSMAP&amp;GPC=D2K&amp;numberOfAdults=1&amp;numberOfRooms=1&amp;adjustMonth=false&amp;showApp=true&amp;monthIndex=00">here</a> or by calling (515) 287-2400 and referencing the IA-MO Conference of Seventh-day Adventists Women’s Retreat.</p>
<p>The group room rate is $120 per night plus tax.</p>
<p><i>Pro Tip:</i> Invite a friend (or two!) to share your room, share time together, and share the cost.</p>
<p><b>Mission Offering</b></p>
<p>This year’s Sabbath mission offering will help provide retreat scholarships for teen and young adult women to attend future IA-MO Women’s Retreats.</p>
<p>Our teen and young adult programming has grown steadily each year, and we praise God for the increasing number of young women seeking Christian fellowship, encouragement, and spiritual growth. The friendships and support networks formed at retreat are making a lasting impact in their lives.</p>
<p>We invite you to prayerfully consider how God may use you to help a teen/young woman experience the blessing of a retreat weekend like this.</p>
<p><b>Childcare Reminder</b></p>
<p>Childcare will be available for children 24 months and younger. However, childcare will only be provided if at least five children are registered. If you’ll be bringing a little one, please make sure you’ve indicated that during registration so we can plan accordingly. We will communicate any updates regarding childcare as the retreat approaches.</p>
<p><b>What to Wear</b></p>
<p>Retreat attire is individualized, so please feel free to dress comfortably. Seminar rooms can sometimes be cool, so you may wish to bring a sweater or light jacket.</p>
<p><b>Weekend Schedule &amp; Meals</b></p>
<p>You can find the tentative weekend schedule on the Conference website under the Women’s Ministries tab <a href="https://imsda.org/ministries/womens-ministries/">here</a>.</p>
<p>Please note that two meals will be served on Sabbath. Gluten free and/or vegan meal preferences were selected during registration, but if you have other specific dietary needs, we encourage you to plan accordingly.</p>
<p><b>A Special Invitation</b></p>
<p>It is our prayer that this weekend will be a time of connection, affirmation, encouragement, and inspiration.</p>
<p>Come with your eyes, ears, and heart open to the ways God may use you to bless another woman. Watch for opportunities to encourage a prayer partner, invite someone to share a meal, offer a hug, or simply brighten someone’s day with a smile.</p>
<p>Our IA-MO Women’s Retreats are at their most beautiful when we intentionally live out the words of Hebrews 10:24:</p>
<p><i>“And let us consider how we may spur one another on toward love and good deeds…”</i></p>
<p>Thank you again for choosing to attend this year’s retreat. We trust God will richly bless our time together and that you will leave with a renewed sense of your beauty and worth in Him.</p>
<p>With anticipation and prayers,<br>IA-MO Women’s Ministries Team</p>`;
  var body='<p>Hello '+escapeHtml(reg.firstName)+',</p>'+
    '<p>Congratulations! You have successfully registered for the 2026 Women’s Retreat: <i>Color Me Beautiful</i>, to be held October 9–11, 2026 at the Holiday Inn Des Moines – Airport Conference Center.</p>'+
    '<p>As you prepare for this special weekend, please review the information below. If you have any questions, feel free to contact Charity Infante at (573) 239-8745 or Caleb Durant at (515) 223-1197.</p>'+
    '<p>We are looking forward to spending this meaningful weekend with you!</p>'+
    attendeeRows+detailsBlock+
    paymentBlock+
    qrBlock+editLink+
    info;
  return sendEmailSafe_(Object.assign({to:reg.email,subject:sub,htmlBody:body},bccObj()));
}
function sendWaitlistEmail(w){return sendEmailSafe_(Object.assign({to:w.email,subject:"Women's Retreat 2026 – You're on the Waitlist",htmlBody:'<p>You are currently #'+escapeHtml(w.position)+' on the waitlist. No payment will be charged until promoted.</p>'},bccObj()));}
function sendWaitlistPromotionEmail(w,n,edit){var editUrl=portalMintLinkForRegistration_(n,'waitlist_promotion')||(String(edit||'')+'?token='+encodeURIComponent(String(n.editToken||'')));return sendEmailSafe_(Object.assign({to:n.email,subject:"Women's Retreat 2026 – Your Spot is Confirmed!",htmlBody:'<p>Great news! A spot opened up.</p><p>'+escapeHtml(n.firstName)+' '+escapeHtml(n.lastName)+'</p><p><a href="'+escapeHtml(editUrl)+'">Edit Registration</a></p><p><img src="'+escapeHtml(generateQRUrl(n.qrToken))+'"/></p>'},bccObj()));}
function sendTransferEmail(o,n,reason,refund,edit){var sub="Women's Retreat 2026 – Registration Transfer Confirmation";sendEmailSafe_(Object.assign({to:o.email,subject:sub,htmlBody:'<p>Your registration has been transferred out.</p><p>Reason: '+escapeHtml(reason||'')+'</p><p>Refund notes: '+escapeHtml(refund||'')+'</p>'},bccObj()));var editUrl=portalMintLinkForRegistration_(n,'transfer')||(String(edit||'')+'?token='+encodeURIComponent(String(n.editToken||'')));return sendEmailSafe_(Object.assign({to:n.email,subject:sub,htmlBody:'<p>Your transfer registration is confirmed.</p><p><a href="'+escapeHtml(editUrl)+'">Edit Registration</a></p><p><img src="'+escapeHtml(generateQRUrl(n.qrToken))+'"/></p>'},bccObj()));}
function sendEditConfirmationEmail(reg){return sendEmailSafe_(Object.assign({to:reg.email,subject:"Women's Retreat 2026 – Registration Updated",htmlBody:'<p>Your registration details were updated.</p><p>'+escapeHtml(reg.firstName)+' '+escapeHtml(reg.lastName)+' | '+escapeHtml(reg.church)+'</p>'},bccObj()));}
// Individual-attendee transfer (in-place substitution) notice. Emails the new
// attendee a welcome/confirmation, and — when a distinct address is on file — a
// courtesy notice to the person who gave up the spot. The registration holder/payer
// is unchanged, so the new attendee gets no edit/payment link; the holder manages
// the registration and its single shared check-in QR.
function sendAttendeeTransferEmail_(reg,oldName,oldEmail,newAttendee,reason){
  var cfg=getConfig()||{};
  var event=cfg.EVENT_NAME||"Women's Retreat 2026";
  var dates=cfg.EVENT_DATES?(' ('+escapeHtml(cfg.EVENT_DATES)+')'):'';
  var holder=(String(reg.firstName||'').trim()+' '+String(reg.lastName||'').trim()).trim();
  var toNew=String((newAttendee&&newAttendee.email)||'').trim();
  if(toNew&&isValidEmail_(toNew)){
    var bodyNew='<p>Hello '+escapeHtml(newAttendee.firstName||'')+',</p>'+
      '<p>You have been added as an attendee for '+escapeHtml(event)+dates+(holder?(' under '+escapeHtml(holder)+'’s registration'):'')+'.</p>'+
      '<p>The registration holder manages payment and any changes. If you have dietary needs, childcare, or seminar preferences, please let them know so they can update your details, or contact us.</p>'+
      '<p>We look forward to seeing you there!</p>';
    sendEmailSafe_(Object.assign({to:toNew,subject:event+' – You’re Registered as an Attendee',htmlBody:bodyNew},bccObj()));
  }
  var toOld=String(oldEmail||'').trim();
  if(toOld&&isValidEmail_(toOld)&&toOld.toLowerCase()!==toNew.toLowerCase()){
    var bodyOld='<p>Hello '+escapeHtml(oldName||'')+',</p>'+
      '<p>Your attendee spot for '+escapeHtml(event)+dates+' has been transferred to '+escapeHtml((String(newAttendee.firstName||'')+' '+String(newAttendee.lastName||'')).trim())+'.</p>'+
      (reason?('<p>Reason: '+escapeHtml(reason)+'</p>'):'')+
      '<p>If this was not expected, please contact us.</p>';
    sendEmailSafe_(Object.assign({to:toOld,subject:event+' – Attendee Spot Transferred',htmlBody:bodyOld},bccObj()));
  }
  return {success:true};
}
// Staff-triggered re-send of a registrant's original confirmation email. Lets
// staff recover a confirmation that bounced/was lost, or deliver it to a corrected
// address WITHOUT changing the stored registration (pass payload.email to override
// the recipient just for this send). Attendee names are rebuilt from the Attendees
// sheet so the email mirrors the original. Returns {success, sentTo} or {success:false,message}.
function resendConfirmationEmail(payload){
  try{
    var id=payload&&payload.registrationId;
    if(!id)return {success:false,message:'registrationId is required'};
    var reg=getRegistrationById(id);
    if(!reg)return {success:false,message:'Registration not found'};
    var overrideEmail=String((payload&&payload.email)||'').trim();
    // Shallow-copy so an override recipient never mutates the stored row.
    var target={};Object.keys(reg).forEach(function(k){target[k]=reg[k];});
    if(overrideEmail){
      if(!isValidEmail_(overrideEmail))return {success:false,message:'Invalid email address'};
      target.email=overrideEmail;
    }
    if(!isValidEmail_(target.email))return {success:false,message:'This registration has no valid email on file. Enter an address to send to.'};
    var attendees=portalReadAllAttendees_()
      .filter(function(a){return String(a.registrationId)===String(id);})
      .map(function(a){return {first_name:a.first_name,last_name:a.last_name,attendee_type:a.attendee_type};});
    var edit=(payload&&payload.edit_page_url)||getConfig().EDIT_PAGE_URL;
    var result=sendConfirmationEmail(target,edit,{attendees:attendees});
    if(result&&result.sent===false)return {success:false,message:'Email could not be sent: '+(result.reason||'unknown')};
    logAudit_('resendConfirmation',id,(payload&&payload.adminUser)||'staff',overrideEmail?('Resent to override address '+overrideEmail):('Resent to '+target.email));
    return {success:true,sentTo:target.email};
  }catch(e){return {success:false,message:e.message};}
}
