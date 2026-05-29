// Worker / non-paying attendee registration (volunteers, staff, presenters).
// Workers flow into the SAME Registrations / Attendees / SeminarPreferences
// sheets as paid attendees — so they appear in church rosters, meal counts, and
// seminar assignment — but at $0 with a non-charging payment status. They are
// NOT subject to the paid CAPACITY check and are skipped by payment reminders
// and revenue (finalAmount is 0). This replaces the external Google Form; the
// public PWA worker page and the staff "Add Worker" panel both call this action
// through the Node server (which supplies the GAS secret).

var WR26_WORKER_PAYMENT_STATUS='worker_no_charge';

function handleWorkerRegistration(payload){
  return withScriptLock_(function(){
    try{
      var first=String((payload&&payload.first_name)||'').trim();
      var last=String((payload&&payload.last_name)||'').trim();
      var email=String((payload&&payload.email)||'').trim();
      if(!first||!last)return {success:false,message:'First and last name are required'};
      if(!isValidEmail_(email))return {success:false,message:'A valid email is required'};
      if(payload.entry_id&&isDuplicateEntry(payload.entry_id))return {success:true,duplicate:true};

      var role=String((payload&&payload.worker_role)||'').trim();
      var workerTag='[worker]'+(role?(' role: '+role):'');
      var reg={
        registrationId:generateRegistrationId(),
        firstName:first,lastName:last,email:email,
        phone:String(payload.phone||''),church:String(payload.church||''),
        arrivalDate:String(payload.arrival_date||''),departureDate:String(payload.departure_date||''),
        dietaryNeeds:String(payload.dietary_needs||''),
        emergencyContactName:String(payload.emergency_contact_name||''),
        emergencyContactPhone:String(payload.emergency_contact_phone||''),
        specialNeeds:String(payload.special_needs||''),
        promoCode:'',discountAmount:0,originalAmount:0,finalAmount:0,
        paymentMethod:'worker',paymentStatus:WR26_WORKER_PAYMENT_STATUS,
        squarePaymentId:'',ffEntryId:String(payload.entry_id||''),status:'active',
        transferNotes:'',checkedIn:false,checkInTime:'',checkInBy:'',
        qrToken:Utilities.getUuid(),editToken:Utilities.getUuid(),
        adminNotes:workerTag,amountPaid:0,couponUsed:''
      };
      var w=writeRegistration(reg);if(!w.success)return w;

      // Build attendees: use the provided array, or fall back to a single attendee
      // from the primary worker so they still appear in rosters/meal counts.
      var attendees=(payload&&Array.isArray(payload.attendees)&&payload.attendees.length)?payload.attendees:[{
        attendee_id:'A-'+reg.registrationId+'-1',first_name:first,last_name:last,phone:reg.phone,
        email:email,church:reg.church,attendee_type:'worker',meal_preference:String(payload.meal_preference||''),
        dietary_needs:reg.dietaryNeeds,childcare_needed:'',seminar_preferences:(payload&&payload.seminar_preferences)||{}
      }];
      var built=buildAttendees({attendees:attendees,email:email,church:reg.church},reg.registrationId);
      var attendeeResult=writeAttendeesForRegistration(reg,built);
      var seminarResult=writeSeminarPreferencesForRegistration(reg,built);
      var warnings=[attendeeResult.warning,seminarResult.warning].filter(Boolean);

      var emailResult=sendWorkerConfirmationEmail(reg,built);
      if(emailResult&&emailResult.sent===false)warnings.push('Confirmation email not sent ('+(emailResult.reason||'unknown')+'); registration saved.');
      logAudit_('workerRegister',reg.registrationId,(payload&&payload.adminUser)||(role||'self'),'Worker registration'+(role?(' ('+role+')'):''));
      return {success:true,registrationId:reg.registrationId,warnings:warnings,message:'Worker registration received. No payment is required. A confirmation has been sent to '+email+'.'};
    }catch(e){return {success:false,message:e.message};}
  });
}

function sendWorkerConfirmationEmail(reg,attendees){
  var editUrl=portalMintLinkForRegistration_(reg,'worker_confirmation');
  var cfg=getConfig()||{};
  var ctx=(Array.isArray(attendees)&&attendees.length)?attendees:[];
  var attendeeRows=ctx.length?('<p><b>Registered:</b></p><ul>'+ctx.map(function(a){return '<li>'+escapeHtml((String(a.first_name||'')+' '+String(a.last_name||'')).trim())+'</li>';}).join('')+'</ul>'):'';
  var body='<p>Hello '+escapeHtml(reg.firstName)+',</p>';
  body+='<p>Thank you for registering as a worker for '+escapeHtml(cfg.EVENT_NAME||"Women's Retreat 2026")+'. <b>No payment is required.</b></p>';
  body+=attendeeRows;
  if(editUrl)body+='<p><a href="'+escapeHtml(editUrl)+'">Review or update your registration</a></p>';
  body+='<p><img src="'+escapeHtml(generateQRUrl(reg.qrToken))+'"/></p><p>Show this QR code at check-in.</p><p>IMSDA</p>';
  return sendEmailSafe_(Object.assign({to:reg.email,subject:(cfg.EVENT_NAME||"Women's Retreat 2026")+' – Worker Registration Confirmed',htmlBody:body},bccObj()));
}
