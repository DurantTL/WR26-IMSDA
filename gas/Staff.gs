// Staff user accounts for the PWA, stored in a dedicated Staff sheet so they
// survive container redeploys (the Node app is stateless/ephemeral). Passwords
// are bcrypt-hashed by the Node server BEFORE they reach GAS — this sheet never
// stores plaintext. The env var WR26_AUTH_USERS remains the bootstrap admin set
// and always works even if this sheet is empty, so you can't get locked out.
//
// All actions here are secret-protected (admin-only is enforced in the Node layer
// by requiring the 'admin' role before calling these).

var WR26_STAFF_ROLES={admin:true,registrar:true,payments:true,checkin:true,readonly:true};

function ensureStaffSheet_(){
  var ss=getSS();var sh=ss.getSheetByName('Staff');
  var headers=['Username','Password Hash','Roles','Active','Created At','Created By','Updated At','Notes'];
  if(!sh){sh=ss.insertSheet('Staff');sh.getRange(1,1,1,headers.length).setValues([headers]);return sh;}
  if(sh.getLastRow()===0)sh.getRange(1,1,1,headers.length).setValues([headers]);
  return sh;
}

function normalizeUsername_(u){return String(u||'').trim().toLowerCase();}

function normalizeRoles_(roles){
  var arr=Array.isArray(roles)?roles:String(roles||'').split(/[,\s]+/);
  var out=[];arr.forEach(function(r){var role=String(r||'').trim().toLowerCase();if(WR26_STAFF_ROLES[role]&&out.indexOf(role)===-1)out.push(role);});
  if(!out.length)out.push('readonly');
  return out;
}

function rowToStaff_(r){return {username:String(r[0]||''),passwordHash:String(r[1]||''),roles:normalizeRoles_(r[2]),active:String(r[3]==null?'true':r[3]).toLowerCase()!=='false',createdAt:r[4],createdBy:String(r[5]||''),updatedAt:r[6],notes:String(r[7]||'')};}

function findStaffRow_(sh,username){var v=sh.getDataRange().getValues();for(var i=1;i<v.length;i++){if(normalizeUsername_(v[i][0])===normalizeUsername_(username))return {row:i+1,data:rowToStaff_(v[i])};}return null;}

// Full records incl. hashes — for the Node server to load into its auth set.
// Not exposed to the browser; the Node layer strips hashes before responding.
function getStaffUsers(){try{var sh=ensureStaffSheet_();var v=sh.getDataRange().getValues();return {success:true,users:v.slice(1).filter(function(r){return String(r[0]||'').trim();}).map(rowToStaff_)};}catch(e){return {success:false,message:e.message};}}

// payload: {username, passwordHash, roles, active, adminUser, notes}.
// passwordHash is REQUIRED on create; on update it is optional (omit to keep).
function saveStaffUser(payload){
  return withScriptLock_(function(){
    try{
      var username=normalizeUsername_(payload&&payload.username);
      if(!username)return {success:false,message:'username is required'};
      if(!/^[a-z0-9._-]{2,40}$/.test(username))return {success:false,message:'username must be 2–40 chars: letters, numbers, . _ -'};
      var roles=normalizeRoles_(payload&&payload.roles);
      var active=String(payload&&payload.active==null?true:payload.active).toLowerCase()!=='false';
      var sh=ensureStaffSheet_();
      var found=findStaffRow_(sh,username);
      var now=new Date();
      if(found){
        var hash=(payload.passwordHash!==undefined&&payload.passwordHash!==null&&String(payload.passwordHash).trim())?String(payload.passwordHash):found.data.passwordHash;
        sh.getRange(found.row,2,1,7).setValues([[hash,roles.join(','),active,found.data.createdAt||now,found.data.createdBy||(payload.adminUser||'admin'),now,String(payload.notes||found.data.notes||'')]]);
        logAudit_('staffUpdate','',payload.adminUser||'admin','Updated staff user '+username+' (roles: '+roles.join(',')+', active: '+active+')');
        return {success:true,updated:true,username:username};
      }
      if(!payload.passwordHash||!String(payload.passwordHash).trim())return {success:false,message:'passwordHash is required for a new user'};
      sh.appendRow([username,String(payload.passwordHash),roles.join(','),active,now,String(payload.adminUser||'admin'),now,String(payload.notes||'')]);
      logAudit_('staffCreate','',payload.adminUser||'admin','Created staff user '+username+' (roles: '+roles.join(',')+')');
      return {success:true,created:true,username:username};
    }catch(e){return {success:false,message:e.message};}
  });
}

// Soft-disable (keeps the row + audit trail). payload: {username, adminUser}.
function deactivateStaffUser(payload){
  return withScriptLock_(function(){
    try{
      var username=normalizeUsername_(payload&&payload.username);
      if(!username)return {success:false,message:'username is required'};
      var sh=ensureStaffSheet_();var found=findStaffRow_(sh,username);
      if(!found)return {success:false,message:'Staff user not found'};
      sh.getRange(found.row,4).setValue(false);
      sh.getRange(found.row,7).setValue(new Date());
      logAudit_('staffDeactivate','',payload.adminUser||'admin','Deactivated staff user '+username);
      return {success:true,username:username};
    }catch(e){return {success:false,message:e.message};}
  });
}
