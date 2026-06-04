// Native Google Form for worker / non-paying volunteer registration, built
// programmatically with FormApp. This is an alternative entry point to the public
// PWA worker page (pwa-server) and the staff "Add Worker" panel — all three feed
// the SAME handleWorkerRegistration() path (Workers.gs), so workers land in the
// Registrations / Attendees / SeminarPreferences sheets at $0 with a non-charging
// payment status, appearing in church rosters, meal counts, and seminar
// assignment but exempt from the paid CAPACITY check and payment reminders.
//
// Run createWorkerRegistrationForm() ONCE from the Apps Script editor (it needs
// the FormApp / ScriptApp authorization prompt). It creates the form, installs the
// onFormSubmit trigger, stores the form id in Script Properties, writes the live
// URL into Config!WORKER_REGISTRATION_URL, and returns the live + edit URLs.
// Re-running deletes any stale onWorkerFormSubmit trigger and reuses the stored
// form when possible so you don't accumulate duplicate forms.

var WR26_WORKER_FORM_PROP='WR26_WORKER_FORM_ID';

// Question titles double as the keys we read back from e.namedValues on submit,
// so keep titles and the onWorkerFormSubmit mapping below in sync.
var WR26_WORKER_FORM_TITLES={
  first:'First Name', last:'Last Name', email:'Email', phone:'Phone',
  church:'Church / Organization', role:'Worker Role', meal:'Meal Preference',
  dietary:'Dietary Needs / Allergies', ecName:'Emergency Contact Name',
  ecPhone:'Emergency Contact Phone', special:'Special Needs / Accommodations'
};
var WR26_WORKER_ROLES=['Volunteer','Staff','Presenter / Speaker','Childcare','Setup / Teardown','Kitchen / Food Service','Registration / Check-In','Other'];
var WR26_WORKER_MEALS=['No preference','Regular','Vegetarian','Vegan','Gluten-free'];

function createWorkerRegistrationForm(){
  var cfg=getConfig()||{};
  var eventName=cfg.EVENT_NAME||"Women's Retreat 2026";
  var form=reuseOrCreateWorkerForm_('Worker Registration — '+eventName);

  // Rebuild from a clean slate so re-runs stay idempotent (no duplicate items).
  form.getItems().forEach(function(it){form.deleteItem(it);});

  form.setDescription('Volunteer / worker (non-paying) registration for '+eventName+(cfg.EVENT_DATES?(' · '+cfg.EVENT_DATES):'')+'. No payment is required — workers are not charged. A confirmation email with a check-in QR code is sent after you submit.')
      .setCollectEmail(false)
      .setAllowResponseEdits(false)
      .setLimitOneResponsePerUser(false)
      .setConfirmationMessage('Thank you for registering as a worker. No payment is required — watch for a confirmation email with your check-in QR code.');

  var T=WR26_WORKER_FORM_TITLES;
  form.addTextItem().setTitle(T.first).setRequired(true);
  form.addTextItem().setTitle(T.last).setRequired(true);
  form.addTextItem().setTitle(T.email).setHelpText('Your confirmation and check-in QR code are sent here.').setRequired(true)
      .setValidation(FormApp.createTextValidation().setHelpText('Enter a valid email address.').requireTextIsEmail().build());
  form.addTextItem().setTitle(T.phone).setRequired(false);
  form.addTextItem().setTitle(T.church).setRequired(false);
  form.addMultipleChoiceItem().setTitle(T.role).showOtherOption(true).setChoiceValues(WR26_WORKER_ROLES).setRequired(true);
  form.addMultipleChoiceItem().setTitle(T.meal).setChoiceValues(WR26_WORKER_MEALS).setRequired(false);
  form.addParagraphTextItem().setTitle(T.dietary).setHelpText('List any food allergies or dietary restrictions.').setRequired(false);
  form.addTextItem().setTitle(T.ecName).setRequired(false);
  form.addTextItem().setTitle(T.ecPhone).setRequired(false);
  form.addParagraphTextItem().setTitle(T.special).setHelpText('Any accessibility needs or accommodations we should know about.').setRequired(false);

  installWorkerFormSubmitTrigger_(form);
  PropertiesService.getScriptProperties().setProperty(WR26_WORKER_FORM_PROP,form.getId());

  var liveUrl=form.getPublishedUrl();
  try{setWorkerRegistrationUrl_(liveUrl);}catch(e){Logger.log('Could not write WORKER_REGISTRATION_URL: '+e.message);}

  var result={success:true,formId:form.getId(),liveUrl:liveUrl,editUrl:form.getEditUrl()};
  Logger.log('createWorkerRegistrationForm: '+JSON.stringify(result));
  return result;
}

// Form-submit handler (installed as an onFormSubmit trigger on the FORM via
// ScriptApp.forForm()). Maps the response to the worker payload shape and reuses
// handleWorkerRegistration(), so the Google Form behaves exactly like the PWA /
// staff entry points. The form response id (prefixed) becomes ffEntryId for
// idempotent de-duplication.
//
// IMPORTANT: a form-bound trigger's event exposes e.response (a FormResponse) and
// has NO e.namedValues — that field only exists on spreadsheet-bound form-submit
// triggers. We read values via workerFormValues_(), which handles both shapes.
function onWorkerFormSubmit(e){
  try{
    var vals=workerFormValues_(e);
    var T=WR26_WORKER_FORM_TITLES;
    var meal=vals[T.meal]||'';
    var payload={
      first_name:vals[T.first]||'',
      last_name:vals[T.last]||'',
      email:vals[T.email]||'',
      phone:vals[T.phone]||'',
      church:vals[T.church]||'',
      worker_role:vals[T.role]||'',
      meal_preference:(meal==='No preference'?'':meal),
      dietary_needs:vals[T.dietary]||'',
      emergency_contact_name:vals[T.ecName]||'',
      emergency_contact_phone:vals[T.ecPhone]||'',
      special_needs:vals[T.special]||'',
      entry_id:(e&&e.response&&typeof e.response.getId==='function')?('gform-'+e.response.getId()):'',
      adminUser:'google_form'
    };
    var res=handleWorkerRegistration(payload);
    Logger.log('onWorkerFormSubmit: '+JSON.stringify(res));
    return res;
  }catch(err){
    Logger.log('onWorkerFormSubmit error: '+err.message);
    return {success:false,message:err.message};
  }
}

// Builds a {questionTitle: trimmedValue} map from a form-submit event. Supports
// both a form-bound trigger (e.response: FormResponse — what installWorkerForm-
// SubmitTrigger_ creates) and a spreadsheet-bound trigger (e.namedValues:
// {title:[value]}). For multi-value/array responses the first non-empty value is
// kept, matching the single-select worker form items.
function workerFormValues_(e){
  var out={};
  var resp=e&&e.response;
  if(resp&&typeof resp.getItemResponses==='function'){
    resp.getItemResponses().forEach(function(ir){
      var item=ir.getItem();var title=item&&item.getTitle?item.getTitle():'';if(!title)return;
      var v=ir.getResponse();
      out[String(title).trim()]=Array.isArray(v)?String(v[0]||'').trim():String(v==null?'':v).trim();
    });
    return out;
  }
  var nv=(e&&e.namedValues)||{};
  Object.keys(nv).forEach(function(title){out[String(title).trim()]=workerFormVal_(nv,title);});
  return out;
}

// Returns the stored form's id + URLs, or {exists:false} if it was never created.
function getWorkerRegistrationFormInfo(){
  var id=PropertiesService.getScriptProperties().getProperty(WR26_WORKER_FORM_PROP);
  if(!id)return {exists:false};
  try{var form=FormApp.openById(id);return {exists:true,formId:id,liveUrl:form.getPublishedUrl(),editUrl:form.getEditUrl()};}
  catch(e){return {exists:false,formId:id,error:e.message};}
}

function reuseOrCreateWorkerForm_(title){
  var id=PropertiesService.getScriptProperties().getProperty(WR26_WORKER_FORM_PROP);
  if(id){try{return FormApp.openById(id).setTitle(title);}catch(e){Logger.log('Stored worker form unavailable ('+e.message+'); creating a new one.');}}
  return FormApp.create(title);
}

function installWorkerFormSubmitTrigger_(form){
  ScriptApp.getProjectTriggers().forEach(function(t){if(t.getHandlerFunction()==='onWorkerFormSubmit')ScriptApp.deleteTrigger(t);});
  ScriptApp.newTrigger('onWorkerFormSubmit').forForm(form).onFormSubmit().create();
}

function workerFormVal_(nv,title){var v=nv&&nv[title];if(Array.isArray(v))return String(v[0]||'').trim();return String(v||'').trim();}

// Writes/updates a single Config key without disturbing other rows, then clears
// the cached config so getConfig() picks it up. Mirrors the Config!['Key','Value'] layout.
function setWorkerRegistrationUrl_(url){
  var sh=getSS().getSheetByName('Config');if(!sh)return;
  var vals=sh.getRange(1,1,sh.getLastRow(),2).getValues();
  for(var i=0;i<vals.length;i++){if(String(vals[i][0]).trim()==='WORKER_REGISTRATION_URL'){sh.getRange(i+1,2).setValue(url);WR26_CONFIG_CACHE=null;return;}}
  sh.appendRow(['WORKER_REGISTRATION_URL',url]);WR26_CONFIG_CACHE=null;
}
