function portalReadAllAttendees_(){
  var sh=getSS().getSheetByName('Attendees');
  if(!sh)return [];
  var vals=sh.getDataRange().getValues();
  if(vals.length<=1)return [];
  return vals.slice(1).filter(function(r){return String(r[1]||'').trim();}).map(function(r){
    return {
      attendee_id:r[0],
      registrationId:r[1],
      first_name:r[2],
      last_name:r[3],
      phone:r[4],
      email:r[5],
      church:r[6],
      attendee_type:r[7],
      meal_preference:r[8],
      dietary_needs:r[9],
      childcare_needed:r[10],
      seminar_preferences_complete:r[11],
      notes:r[12],
      childcare_children:r[13],
      volunteer:r[14]
    };
  });
}

function portalReadAllSeminarPreferences_(){
  var sh=getSS().getSheetByName('SeminarPreferences');
  if(!sh)return [];
  var vals=sh.getDataRange().getValues();
  if(vals.length<=1)return [];
  return vals.slice(1).filter(function(r){return String(r[1]||'').trim();}).map(function(r){
    return {
      preferenceId:r[0],
      registrationId:r[1],
      attendeeId:r[2],
      attendeeName:r[3],
      sessionSlot:r[4],
      preferenceRank:r[5],
      seminarTitle:r[6],
      seminarId:r[7],
      assignedSeminar:r[8],
      assignmentStatus:r[9],
      notes:r[10]
    };
  });
}

function portalAttachCounts_(registrations,attendees,seminarPreferences){
  var attendeeCounts={};
  var seminarCounts={};
  attendees.forEach(function(a){
    var id=String(a.registrationId||'');
    attendeeCounts[id]=(attendeeCounts[id]||0)+1;
  });
  seminarPreferences.forEach(function(p){
    var id=String(p.registrationId||'');
    seminarCounts[id]=(seminarCounts[id]||0)+1;
  });
  return registrations.map(function(r){
    r.attendeeCount=attendeeCounts[String(r.registrationId)]||0;
    r.seminarPreferenceCount=seminarCounts[String(r.registrationId)]||0;
    return r;
  });
}

function portalGetCacheSnapshot(payload){
  try{
    var registrations=getAllRegistrations({status:(payload&&payload.status)||'',search:(payload&&payload.q)||''});
    var attendees=portalReadAllAttendees_();
    var seminarPreferences=portalReadAllSeminarPreferences_();
    var waitlist=[];
    var stats={};
    var paymentStats={};
    var refunds=[];
    var seminars=[];
    try{waitlist=(getWaitlist().waitlist)||[];}catch(e){waitlist=[];}
    try{stats=getCheckInStats();}catch(e){stats={success:false,message:e.message};}
    try{paymentStats=getPaymentStats();}catch(e){paymentStats={};}
    try{refunds=(getRefunds().refunds)||[];}catch(e){refunds=[];}
    try{seminars=(getSeminars().seminars)||[];}catch(e){seminars=[];}
    registrations=portalAttachCounts_(registrations,attendees,seminarPreferences);
    return {
      success:true,
      syncedAt:new Date().toISOString(),
      registrations:registrations,
      attendees:attendees,
      seminarPreferences:seminarPreferences,
      waitlist:waitlist,
      stats:stats,
      paymentStats:paymentStats,
      refunds:refunds,
      seminars:seminars
    };
  }catch(e){return {success:false,message:e.message};}
}
