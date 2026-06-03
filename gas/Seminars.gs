// Seminar / breakout registration: 8 breakouts across 4 time slots.
//   session_1  Friday 4:00–5:00 PM      2 options
//   session_2  Saturday 2:00–3:15 PM    3 options
//   session_3  Saturday 3:30–4:45 PM    2 options
//   session_4  Sunday 8:15–9:15 AM      1 option
//
// Per-attendee ranked preferences are captured at registration into the
// SeminarPreferences sheet. This module adds the canonical Seminars sheet
// (slot, title, capacity) and an assignment engine that honors rank and
// per-seminar capacity, degrading gracefully when a seminar is full
// (controlled by Config SEMINAR_FULL_BEHAVIOR). Everything here is additive.

var WR26_SEMINAR_SLOTS=[
  {slot:'session_1',label:'Friday 4:00–5:00 PM',options:2},
  {slot:'session_2',label:'Sabbath 2:00–3:15 PM',options:4},
  {slot:'session_3',label:'Sabbath 4:15–5:30 PM',options:3},
  {slot:'session_4',label:'Sunday 8:15–9:15 AM',options:1}
];

function ensureSeminarsSheet_(){
  var ss=getSS();var sh=ss.getSheetByName('Seminars');
  var headers=['Slot','Slot Label','Seminar Title','Capacity','Assigned Count','Active','Notes'];
  if(!sh){sh=ss.insertSheet('Seminars');sh.getRange(1,1,1,headers.length).setValues([headers]);return sh;}
  if(sh.getLastRow()===0)sh.getRange(1,1,1,headers.length).setValues([headers]);
  return sh;
}

function normalizeTitle_(t){return String(t||'').trim().toLowerCase().replace(/\s+/g,' ');}

function rowToSeminar_(r){return {slot:String(r[0]||''),slotLabel:String(r[1]||''),title:String(r[2]||''),capacity:Number(r[3]||0),assignedCount:Number(r[4]||0),active:String(r[5]==null?'true':r[5]).toLowerCase()!=='false',notes:String(r[6]||'')};}

function getSeminars(){try{var sh=ensureSeminarsSheet_();var v=sh.getDataRange().getValues();return {success:true,slots:WR26_SEMINAR_SLOTS,seminars:v.slice(1).filter(function(r){return String(r[2]||'').trim();}).map(rowToSeminar_)};}catch(e){return {success:false,message:e.message};}}

// Upsert a seminar definition. payload: {slot, title, capacity, active, notes, slotLabel}.
function saveSeminar(payload){try{
  var slot=String((payload&&payload.slot)||'').trim();
  var title=String((payload&&payload.title)||'').trim();
  if(!slot||!title)return {success:false,message:'slot and title are required'};
  var slotDef=WR26_SEMINAR_SLOTS.filter(function(s){return s.slot===slot;})[0];
  var slotLabel=String(payload.slotLabel||(slotDef?slotDef.label:''));
  var capacity=Number(payload.capacity||0);if(isNaN(capacity)||capacity<0)capacity=0;
  var active=String(payload.active==null?true:payload.active).toLowerCase()!=='false';
  var sh=ensureSeminarsSheet_();var v=sh.getDataRange().getValues();
  for(var i=1;i<v.length;i++){if(String(v[i][0])===slot&&normalizeTitle_(v[i][2])===normalizeTitle_(title)){sh.getRange(i+1,1,1,7).setValues([[slot,slotLabel,title,capacity,Number(v[i][4]||0),active,String(payload.notes||v[i][6]||'')]]);return {success:true,updated:true};}}
  sh.appendRow([slot,slotLabel,title,capacity,0,active,String(payload.notes||'')]);
  return {success:true,created:true};
}catch(e){return {success:false,message:e.message};}}

function deleteSeminar(payload){try{var slot=String((payload&&payload.slot)||'').trim();var title=String((payload&&payload.title)||'').trim();var sh=ensureSeminarsSheet_();var v=sh.getDataRange().getValues();for(var i=1;i<v.length;i++){if(String(v[i][0])===slot&&normalizeTitle_(v[i][2])===normalizeTitle_(title)){sh.getRange(i+1,6).setValue(false);return {success:true};}}return {success:false,message:'Seminar not found'};}catch(e){return {success:false,message:e.message};}}

// Build {slot: {normalizedTitle: capacity}} from the Seminars sheet. Inactive
// seminars are treated as capacity 0 (cannot be assigned). Titles not present in
// the sheet fall back to SEMINAR_CAPACITY_DEFAULT (0 = unlimited).
function buildCapacityMap_(seminars){var map={};seminars.forEach(function(s){if(!map[s.slot])map[s.slot]={};map[s.slot][normalizeTitle_(s.title)]={capacity:s.active?s.capacity:0,title:s.title};});return map;}

// Read all SeminarPreferences rows once and group them by attendee+slot, sorted
// by rank. Returns {rows, byAttendeeSlot} where byAttendeeSlot[attId][slot] is an
// array of {rank, title, rowIndex}. rowIndex is 1-based sheet row.
function readSeminarPreferenceRows_(){
  var sh=getSS().getSheetByName('SeminarPreferences');
  var out={rows:[],byAttendeeSlot:{},sheet:sh};
  if(!sh||sh.getLastRow()<2)return out;
  var v=sh.getDataRange().getValues();
  for(var i=1;i<v.length;i++){
    var r=v[i];if(!String(r[2]||'').trim())continue;
    var att=String(r[2]);var slot=String(r[4]||'');var rank=Number(r[5]||1);var title=String(r[6]||'');
    if(!out.byAttendeeSlot[att])out.byAttendeeSlot[att]={};
    if(!out.byAttendeeSlot[att][slot])out.byAttendeeSlot[att][slot]=[];
    out.byAttendeeSlot[att][slot].push({rank:rank,title:title,rowIndex:i+1,name:String(r[3]||'')});
  }
  Object.keys(out.byAttendeeSlot).forEach(function(att){Object.keys(out.byAttendeeSlot[att]).forEach(function(slot){out.byAttendeeSlot[att][slot].sort(function(a,b){return a.rank-b.rank;});});});
  return out;
}

// Recompute the Seminars sheet "Assigned Count" column (col 5) from live demand:
// the number of attendees whose FIRST choice (rank 1) in that slot is this seminar.
// This mirrors getSeminarAvailability's first_choice_count so the sheet shows, at a
// glance, how many people have chosen each seminar against its capacity — updated on
// every registration and portal edit, without waiting for the admin to run
// assignSeminars (which later overwrites col 5 with the true post-assignment counts).
function recomputeSeminarAssignedCounts_(){
  try{
    var pref=readSeminarPreferenceRows_();
    var firstCounts={};
    Object.keys(pref.byAttendeeSlot).forEach(function(att){
      Object.keys(pref.byAttendeeSlot[att]).forEach(function(slot){
        pref.byAttendeeSlot[att][slot].forEach(function(p){
          if(Number(p.rank)===1&&String(p.title).trim()){
            var key=slot+'||'+normalizeTitle_(p.title);
            firstCounts[key]=(firstCounts[key]||0)+1;
          }
        });
      });
    });
    var ssh=ensureSeminarsSheet_();var sv=ssh.getDataRange().getValues();
    for(var i=1;i<sv.length;i++){
      var slot=String(sv[i][0]);var title=String(sv[i][2]);if(!title)continue;
      var key=slot+'||'+normalizeTitle_(title);
      ssh.getRange(i+1,5).setValue(firstCounts[key]||0);
    }
    return {success:true};
  }catch(e){Logger.log('recomputeSeminarAssignedCounts_ failed: '+e.message);return {success:false,message:e.message};}
}

// Assign every attendee to a seminar in each slot, honoring ranked preference and
// per-seminar capacity. Greedy by rank: pass 1 tries everyone's #1 choice, pass 2
// the next-best for those still unplaced, etc. When SEMINAR_FULL_BEHAVIOR is
// 'allow_with_review' a fully-blocked attendee is still recorded against their top
// choice with status 'full_review'; otherwise status is 'unassigned_full'.
function assignSeminars(payload){
  return withScriptLock_(function(){
    try{
      var cfg=getConfig()||{};
      var fullBehavior=String(cfg.SEMINAR_FULL_BEHAVIOR||'allow_with_review');
      var defaultCap=Number(cfg.SEMINAR_CAPACITY_DEFAULT||0);
      var dryRun=!!(payload&&payload.dryRun);
      var seminarsResp=getSeminars();var seminars=seminarsResp.seminars||[];
      var capMap=buildCapacityMap_(seminars);
      var pref=readSeminarPreferenceRows_();
      var sh=pref.sheet;
      if(!sh)return {success:false,message:'SeminarPreferences sheet missing'};

      // Running assigned counts per slot+title.
      var counts={};
      function capFor(slot,title){var n=normalizeTitle_(title);if(capMap[slot]&&capMap[slot][n])return capMap[slot][n].capacity;return defaultCap;}
      function countFor(slot,title){var k=slot+'||'+normalizeTitle_(title);return counts[k]||0;}
      function bump(slot,title){var k=slot+'||'+normalizeTitle_(title);counts[k]=(counts[k]||0)+1;}
      function hasRoom(slot,title){var cap=capFor(slot,title);if(!cap||cap<=0)return true;return countFor(slot,title)<cap;}

      var results=[];      // {attendeeId, slot, assigned, rank, status}
      var assignments={};  // attendeeId -> slot -> {title,rank,status}

      WR26_SEMINAR_SLOTS.forEach(function(slotDef){
        var slot=slotDef.slot;
        // Attendees who expressed any preference in this slot.
        var attendees=Object.keys(pref.byAttendeeSlot).filter(function(att){return pref.byAttendeeSlot[att][slot]&&pref.byAttendeeSlot[att][slot].length;});
        var placed={};
        var maxRank=0;
        attendees.forEach(function(att){var list=pref.byAttendeeSlot[att][slot];if(list.length)maxRank=Math.max(maxRank,list[list.length-1].rank);});
        // Greedy passes by rank.
        for(var rank=1;rank<=maxRank;rank++){
          attendees.forEach(function(att){
            if(placed[att])return;
            var choice=pref.byAttendeeSlot[att][slot].filter(function(p){return p.rank===rank;})[0];
            if(!choice||!String(choice.title).trim())return;
            if(hasRoom(slot,choice.title)){bump(slot,choice.title);placed[att]={title:choice.title,rank:rank,status:'assigned'};}
          });
        }
        // Anyone still unplaced: degrade gracefully per Config.
        attendees.forEach(function(att){
          if(placed[att])return;
          var top=pref.byAttendeeSlot[att][slot].filter(function(p){return String(p.title).trim();})[0];
          if(!top)return;
          if(fullBehavior==='allow_with_review'){bump(slot,top.title);placed[att]={title:top.title,rank:top.rank,status:'full_review'};}
          else{placed[att]={title:top.title,rank:top.rank,status:'unassigned_full'};}
        });
        Object.keys(placed).forEach(function(att){
          assignments[att]=assignments[att]||{};assignments[att][slot]=placed[att];
          results.push({attendeeId:att,slot:slot,assigned:placed[att].title,rank:placed[att].rank,status:placed[att].status});
        });
      });

      if(!dryRun){
        // Write Assigned Seminar (col 9) + Assignment Status (col 10) on every pref
        // row of each attendee+slot so the assignment is visible whichever rank row
        // is read. Batched per row to stay simple and correct.
        Object.keys(pref.byAttendeeSlot).forEach(function(att){
          Object.keys(pref.byAttendeeSlot[att]).forEach(function(slot){
            var a=assignments[att]&&assignments[att][slot];
            pref.byAttendeeSlot[att][slot].forEach(function(p){
              sh.getRange(p.rowIndex,9).setValue(a?a.title:'');
              sh.getRange(p.rowIndex,10).setValue(a?a.status:'no_assignment');
            });
          });
        });
        // Persist assigned counts back to the Seminars sheet.
        var ssh=ensureSeminarsSheet_();var sv=ssh.getDataRange().getValues();
        for(var i=1;i<sv.length;i++){var slot=String(sv[i][0]);var title=String(sv[i][2]);if(!title)continue;ssh.getRange(i+1,5).setValue(countFor(slot,title));}
        logAudit_('seminarAssign','',(payload&&payload.adminUser)||'admin',results.length+' attendee-slot assignments across '+WR26_SEMINAR_SLOTS.length+' slots');
      }

      // Summary of fill per slot+title.
      var summary=[];Object.keys(counts).forEach(function(k){var parts=k.split('||');summary.push({slot:parts[0],title:parts[1],assigned:counts[k],capacity:capFor(parts[0],parts[1])});});
      return {success:true,dryRun:dryRun,assignmentCount:results.length,results:results,summary:summary};
    }catch(e){return {success:false,message:e.message};}
  });
}

// Public-safe availability snapshot for the registration form's seminar cards.
// Returns COUNTS ONLY — never attendee names — so it can be proxied to the
// public form. Per slot/seminar it reports capacity, how many registrants have
// ranked it 1st/2nd, the assigned count, and a coarse availability status the
// front end can render as a badge/progress bar. Reads existing data only; it
// does not run assignment.
function getSeminarAvailability(){try{
  var seminarsResp=getSeminars();
  var seminars=(seminarsResp&&seminarsResp.seminars)||[];
  var pref=readSeminarPreferenceRows_();

  // Tally ranked preferences per slot+normalizedTitle from SeminarPreferences.
  var firstCounts={},secondCounts={};
  Object.keys(pref.byAttendeeSlot).forEach(function(att){
    Object.keys(pref.byAttendeeSlot[att]).forEach(function(slot){
      pref.byAttendeeSlot[att][slot].forEach(function(p){
        var key=slot+'||'+normalizeTitle_(p.title);
        if(p.rank===1)firstCounts[key]=(firstCounts[key]||0)+1;
        else secondCounts[key]=(secondCounts[key]||0)+1;
      });
    });
  });

  function statusFor(capacity,firstChoice,assigned){
    if(!capacity||capacity<=0)return 'good_availability';
    var load=Math.max(Number(assigned||0),Number(firstChoice||0));
    var ratio=load/capacity;
    if(ratio>=1)return 'full';
    if(ratio>=0.75)return 'limited_availability';
    return 'good_availability';
  }

  var slots=WR26_SEMINAR_SLOTS.map(function(slotDef){
    var list=seminars.filter(function(s){return s.slot===slotDef.slot&&s.active;}).map(function(s){
      var key=slotDef.slot+'||'+normalizeTitle_(s.title);
      var firstChoice=firstCounts[key]||0;
      var secondChoice=secondCounts[key]||0;
      return {
        title:s.title,
        speaker:s.notes||'',
        capacity:Number(s.capacity||0),
        first_choice_count:firstChoice,
        second_choice_count:secondChoice,
        assigned_count:Number(s.assignedCount||0),
        status:statusFor(s.capacity,firstChoice,s.assignedCount)
      };
    });
    return {slot:slotDef.slot,label:slotDef.label,seminars:list};
  });

  return {success:true,slots:slots};
}catch(e){return {success:false,message:e.message};}}

// Roster of assigned attendees for a given slot (and optional title), for printing
// seminar attendance sheets. Reads the already-written assignments.
function getSeminarRoster(payload){try{
  var slotFilter=String((payload&&payload.slot)||'');
  var titleFilter=normalizeTitle_((payload&&payload.title)||'');
  var sh=getSS().getSheetByName('SeminarPreferences');
  if(!sh||sh.getLastRow()<2)return {success:true,roster:[]};
  var v=sh.getDataRange().getValues();var seen={};var roster=[];
  for(var i=1;i<v.length;i++){
    var r=v[i];var slot=String(r[4]||'');var assigned=String(r[8]||'');
    if(!assigned)continue;
    if(slotFilter&&slot!==slotFilter)continue;
    if(titleFilter&&normalizeTitle_(assigned)!==titleFilter)continue;
    var key=String(r[2])+'||'+slot;if(seen[key])continue;seen[key]=true;
    roster.push({attendeeId:r[2],attendeeName:r[3],slot:slot,assignedSeminar:assigned,status:String(r[9]||''),registrationId:r[1]});
  }
  roster.sort(function(a,b){return (a.slot+a.assignedSeminar+a.attendeeName).localeCompare(b.slot+b.assignedSeminar+b.attendeeName);});
  return {success:true,roster:roster};
}catch(e){return {success:false,message:e.message};}}
