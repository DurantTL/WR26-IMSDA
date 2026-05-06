var WR26_CONFIG_CACHE = null;
function getConfig(){
  if(WR26_CONFIG_CACHE) return WR26_CONFIG_CACHE;
  var sh=getSS().getSheetByName('Config'); var vals=sh.getRange(1,1,sh.getLastRow(),2).getValues(); var cfg={};
  vals.forEach(function(r){ if(r[0]) cfg[String(r[0]).trim()]=r[1]; });
  WR26_CONFIG_CACHE={SECRET:cfg.SECRET||'',EVENT_NAME:cfg.EVENT_NAME||"Women's Retreat 2026",EVENT_DATES:cfg.EVENT_DATES||'October 9–11, 2026',EVENT_LOCATION:cfg.EVENT_LOCATION||'Des Moines, IA',CAPACITY:Number(cfg.CAPACITY||350),ADMIN_EMAIL:cfg.ADMIN_EMAIL||'',NOTIFICATION_EMAIL:cfg.NOTIFICATION_EMAIL||'',EDIT_PAGE_URL:cfg.EDIT_PAGE_URL||''};
  return WR26_CONFIG_CACHE;
}
