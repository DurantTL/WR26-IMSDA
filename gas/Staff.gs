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
  var headers=['Username','Password Hash','Roles','Active','Created At','Created By','Updated At','Notes','Email'];
  if(!sh){sh=ss.insertSheet('Staff');sh.getRange(1,1,1,headers.length).setValues([headers]);return sh;}
  if(sh.getLastRow()===0)sh.getRange(1,1,1,headers.length).setValues([headers]);
  return sh;
}

function ensureStaffMagicLinksSheet_(){
  var ss=getSS();var sh=ss.getSheetByName('StaffMagicLinks');
  var headers=['Token','Created At','Email','Username','Expires At','Used At','Status','Request IP'];
  if(!sh){sh=ss.insertSheet('StaffMagicLinks');sh.getRange(1,1,1,headers.length).setValues([headers]);return sh;}
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

function rowToStaff_(r){return {username:String(r[0]||''),passwordHash:String(r[1]||''),roles:normalizeRoles_(r[2]),active:String(r[3]==null?'true':r[3]).toLowerCase()!=='false',createdAt:r[4],createdBy:String(r[5]||''),updatedAt:r[6],notes:String(r[7]||''),email:String(r[8]||'').trim().toLowerCase()};}

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
      var email=String(payload.email||'').trim().toLowerCase();
      if(found){
        var hash=(payload.passwordHash!==undefined&&payload.passwordHash!==null&&String(payload.passwordHash).trim())?String(payload.passwordHash):found.data.passwordHash;
        var keepEmail=email||found.data.email||'';
        sh.getRange(found.row,2,1,8).setValues([[hash,roles.join(','),active,found.data.createdAt||now,found.data.createdBy||(payload.adminUser||'admin'),now,String(payload.notes||found.data.notes||''),keepEmail]]);
        logAudit_('staffUpdate','',payload.adminUser||'admin','Updated staff user '+username+' (roles: '+roles.join(',')+', active: '+active+')');
        return {success:true,updated:true,username:username};
      }
      if(!payload.passwordHash||!String(payload.passwordHash).trim())return {success:false,message:'passwordHash is required for a new user'};
      sh.appendRow([username,String(payload.passwordHash),roles.join(','),active,now,String(payload.adminUser||'admin'),now,String(payload.notes||''),email]);
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

// payload: {email, appUrl, requestIp}
// Generates a 30-minute single-use login link and emails it to the staff member.
// Always returns a generic success message to prevent email enumeration.
function staffRequestMagicLink(payload){
  try{
    var email=String((payload&&payload.email)||'').trim().toLowerCase();
    var appUrl=String((payload&&payload.appUrl)||'').trim();
    if(!email)return {success:false,message:'Email is required'};
    if(!appUrl)return {success:false,message:'appUrl is required'};
    var sh=ensureStaffSheet_();var v=sh.getDataRange().getValues();
    var user=null;
    for(var i=1;i<v.length;i++){var row=rowToStaff_(v[i]);if(row.email&&row.email===email&&row.active!==false){user=row;break;}}
    var genericMsg='If a staff account exists for that email, a login link has been sent.';
    if(!user)return {success:true,message:genericMsg};
    var token=Utilities.getUuid()+'-'+Utilities.getUuid();
    var now=new Date();var expires=new Date(now.getTime()+30*60*1000);
    ensureStaffMagicLinksSheet_().appendRow([token,now,email,user.username,expires,'','active',String(payload.requestIp||'')]);
    var loginUrl=appUrl+(appUrl.indexOf('?')>-1?'&':'?')+'staff_token='+encodeURIComponent(token);
    sendEmailSafe_({
      to:email,
      subject:"Women's Retreat 2026 – Staff Login Link",
      htmlBody:'<p>Hello '+escapeHtml(user.username)+',</p><p>Click the link below to sign in to the IMSDA Registration Manager:</p><p><a href="'+escapeHtml(loginUrl)+'" style="font-size:1.1em;font-weight:bold;">Sign In</a></p><p>This link expires in 30 minutes and can only be used once. If you did not request this, please ignore this email.</p><p>IMSDA</p>'
    });
    return {success:true,message:genericMsg};
  }catch(e){return {success:false,message:e.message};}
}

// payload: {token, requestIp}
// Validates a staff magic login token: checks it exists, is active, and is not expired.
// Marks it as used on success. Returns {success, username} or {success:false, message}.
function staffValidateMagicToken(payload){
  try{
    var token=String((payload&&payload.token)||'').trim();
    if(!token)return {success:false,message:'Token is required'};
    var sh=ensureStaffMagicLinksSheet_();var vals=sh.getDataRange().getValues();
    for(var i=1;i<vals.length;i++){
      if(String(vals[i][0])!==token)continue;
      if(String(vals[i][6]||'')!=='active')return {success:false,message:'This link has already been used or is invalid.'};
      var expires=vals[i][4] instanceof Date?vals[i][4]:new Date(vals[i][4]);
      if(isNaN(expires.getTime())||expires<new Date())return {success:false,message:'This login link has expired. Please request a new one.'};
      sh.getRange(i+1,6).setValue(new Date());
      sh.getRange(i+1,7).setValue('used');
      var username=String(vals[i][3]||'');
      logAudit_('staffMagicLogin','',username,'Staff magic-link login',String(payload.requestIp||''));
      return {success:true,username:username};
    }
    return {success:false,message:'Invalid or expired login link.'};
  }catch(e){return {success:false,message:e.message};}
}
