var WR26_CONFIG_CACHE = null;
var WR26_CONFIG_CACHE_AT = 0;
// Short TTL so a Config edit made during a long-lived or repeated execution is
// picked up without redeploying. wr26EnsureSheetSetup() also resets the cache.
var WR26_CONFIG_TTL_MS = 30000;
function getConfig(){
  if(WR26_CONFIG_CACHE && (Date.now()-WR26_CONFIG_CACHE_AT) < WR26_CONFIG_TTL_MS) return WR26_CONFIG_CACHE;
  var sh=getSS().getSheetByName('Config'); var vals=sh.getRange(1,1,sh.getLastRow(),2).getValues(); var cfg={};
  vals.forEach(function(r){ if(r[0]) cfg[String(r[0]).trim()]=r[1]; });
  WR26_CONFIG_CACHE={SECRET:cfg.SECRET||'',ADMIN_EMAIL:cfg.ADMIN_EMAIL||'',NOTIFICATION_EMAIL:cfg.NOTIFICATION_EMAIL||'',CAPACITY:Number(cfg.CAPACITY||350),EVENT_NAME:cfg.EVENT_NAME||"Women's Retreat 2026",EVENT_DATES:cfg.EVENT_DATES||'October 9–11, 2026',EVENT_LOCATION:cfg.EVENT_LOCATION||'Des Moines, IA',GAS_VERSION:cfg.GAS_VERSION||'1.0.0',EARLY_BIRD_PRICE:Number(cfg.EARLY_BIRD_PRICE||120),REGULAR_PRICE:Number(cfg.REGULAR_PRICE||140),EARLY_BIRD_END_DATE:cfg.EARLY_BIRD_END_DATE||'2026-08-14',REGULAR_END_DATE:cfg.REGULAR_END_DATE||'2026-09-17',OPEN_CAMP_MEETING_DATE:cfg.OPEN_CAMP_MEETING_DATE||'2026-06-03',EDIT_PAGE_URL:cfg.EDIT_PAGE_URL||'',PORTAL_URL:cfg.PORTAL_URL||'',PORTAL_LINK_TTL_DAYS:Number(cfg.PORTAL_LINK_TTL_DAYS||60),PAYMENT_DEFAULT:String(cfg.PAYMENT_DEFAULT||'pay_later').toLowerCase(),WORKER_REGISTRATION_URL:cfg.WORKER_REGISTRATION_URL||'',CHILDCARE_ENABLED:String(cfg.CHILDCARE_ENABLED||'true').toLowerCase()==='true',CHILDCARE_MINIMUM_CHILDREN:Number(cfg.CHILDCARE_MINIMUM_CHILDREN||0),CHILDCARE_MESSAGE:cfg.CHILDCARE_MESSAGE||'Childcare interest has been noted. If only a few children register, a dedicated childcare program may not be offered. We will confirm childcare details closer to the event.',SQUARE_FEE_ENABLED:String(cfg.SQUARE_FEE_ENABLED||'true').toLowerCase()==='true',SQUARE_FEE_PERCENT:Number(cfg.SQUARE_FEE_PERCENT||2.9),SQUARE_FEE_FIXED:Number(cfg.SQUARE_FEE_FIXED||0.30),SEMINAR_FULL_BEHAVIOR:cfg.SEMINAR_FULL_BEHAVIOR||'allow_with_review',SEMINAR_CAPACITY_DEFAULT:Number(cfg.SEMINAR_CAPACITY_DEFAULT||0),CHECKIN_PIN:String(cfg.CHECKIN_PIN||''),CHECKIN_TOKEN:String(cfg.CHECKIN_TOKEN||''),MAGIC_LINK_ENFORCE_IP:String(cfg.MAGIC_LINK_ENFORCE_IP||'false').toLowerCase()==='true',MAGIC_LINK_COOLDOWN_SECONDS:Number(cfg.MAGIC_LINK_COOLDOWN_SECONDS||60)};
  WR26_CONFIG_CACHE_AT=Date.now();
  return WR26_CONFIG_CACHE;
}
