var WR26_CONFIG_CACHE = null;
function getConfig(){
  if(WR26_CONFIG_CACHE) return WR26_CONFIG_CACHE;
  var sh=getSS().getSheetByName('Config'); var vals=sh.getRange(1,1,sh.getLastRow(),2).getValues(); var cfg={};
  vals.forEach(function(r){ if(r[0]) cfg[String(r[0]).trim()]=r[1]; });
  WR26_CONFIG_CACHE={SECRET:cfg.SECRET||'',EVENT_NAME:cfg.EVENT_NAME||"Women's Retreat 2026",EVENT_DATES:cfg.EVENT_DATES||'October 9–11, 2026',EVENT_LOCATION:cfg.EVENT_LOCATION||'Des Moines, IA',CAPACITY:Number(cfg.CAPACITY||350),ADMIN_EMAIL:cfg.ADMIN_EMAIL||'',NOTIFICATION_EMAIL:cfg.NOTIFICATION_EMAIL||'',EDIT_PAGE_URL:cfg.EDIT_PAGE_URL||'',PAYMENT_DEFAULT:String(cfg.PAYMENT_DEFAULT||'pay_later').toLowerCase(),CHILDCARE_MESSAGE:cfg.CHILDCARE_MESSAGE||'Childcare interest has been noted. If only a few children register, a dedicated childcare program may not be offered. We will confirm childcare details closer to the event.',WORKER_REGISTRATION_URL:cfg.WORKER_REGISTRATION_URL||'',SQUARE_FEE_ENABLED:String(cfg.SQUARE_FEE_ENABLED||'false').toLowerCase()==='true',SQUARE_FEE_PERCENT:Number(cfg.SQUARE_FEE_PERCENT||0),SQUARE_FEE_FIXED:Number(cfg.SQUARE_FEE_FIXED||0)};
  return WR26_CONFIG_CACHE;
}
