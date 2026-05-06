function getSS(){return SpreadsheetApp.getActiveSpreadsheet();}
function randHex4(){return ('0000'+Math.floor(Math.random()*65535).toString(16)).slice(-4).toUpperCase();}
function generateRegistrationId(){return 'WR26-'+Date.now()+'-'+randHex4();}
function generateWaitlistId(){return 'WL26-'+Date.now()+'-'+randHex4();}
function generateQRUrl(token){return 'https://api.qrserver.com/v1/create-qr-code/?data='+encodeURIComponent(token)+'&size=200x200';}
function formatDate(d){return Utilities.formatDate(new Date(d),Session.getScriptTimeZone(),'M/d/yyyy h:mm a');}
function isDuplicateEntry(entryId){var s=getSS().getSheetByName('Registrations');if(s.getLastRow()<2)return false;var v=s.getRange(2,22,s.getLastRow()-1,1).getValues();return v.some(function(r){return String(r[0])===String(entryId);});}
function isDuplicateWaitlistEntry(entryId){var s=getSS().getSheetByName('Waitlist');if(s.getLastRow()<2)return false;var v=s.getRange(2,9,s.getLastRow()-1,1).getValues();return v.some(function(r){return String(r[0])===String(entryId);});}
function jsonResponse(data){return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);}
