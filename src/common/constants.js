/** ثوابت التطبيق المشتركة بين كل العمليات. */
module.exports = {
  APP_ID: 'app.ghost.browser',
  APP_NAME: 'Ghost Browser',
  PROTOCOL: 'ghost',
  URLS: {
    NEW_TAB: 'ghost://newtab/',
    LEAK_TEST: 'ghost://leaktest/',
    HOME: 'ghost://newtab/',
  },
  /** أوضاع جلسة التاب:
   *  ghost  — جهاز جديد لكل تاب بجلسة معزولة تُحفظ على القرص،
   *           تُستعاد بعد إعادة التشغيل وتمسح عند إغلاق التاب (الافتراضي).
   *  keep   — جهاز خاص بالتاب يُحفظ على القرص ولا يُمسح عند إغلاقه.
   *  shared — كل تابات القروب تتشارك جلسة واحدة (مثل متصفح عادي). */
  TAB_MODES: { GHOST: 'ghost', KEEP: 'keep', SHARED: 'shared' },
  PARTITION: {
    /* جلسات الشبح الآن persistent أيضاً — البيانات تبقى بعد إعادة التشغيل
       (مطلب المستخدم) وتمسح فوراً عند إغلاق التاب عبر releaseGhost.
       بادئة gtab خاصة بالأشباح حتى لا تتصادم مع جلسات keep القديمة. */
    ghost: (tabId) => `persist:ghost-gtab-${tabId}`,
    ghostPersist: (tabId) => `persist:ghost-gtab-${tabId}`,
    keep: (tabId) => `persist:ghost-tab-${tabId}`,
    shared: (groupId) => `persist:ghost-group-${groupId}`,
  },
  IPC: {
    GET_STATE: 'ghost:get-state',
    ACTION: 'ghost:action',
    STATE: 'ghost:state',
    EVENT: 'ghost:event',
    /** قناة مانع الإعلانات (ghostery preload) */
    ADBLOCK_BACKGROUND: 'ghost:adblock-bg',
  },
  LIMITS: {
    MAX_TABS: 50,
    FAVICON_MAX_BYTES: 32 * 1024,
    STATE_BROADCAST_MS: 16,
  },
  /** ارتفاع شريط الواجهة (شريط التابات + شريط العنوان) بالبكسل. */
  CHROME_H: 92,
  SIDEBAR_W: 268,
  SIDEBAR_W_COLLAPSED: 62,
  /** مصادر قوائم الحجب للتحديث عن بُعد. */
  FILTER_SOURCES: [
    { id: 'easylist', name: 'EasyList (إعلانات)', url: 'https://easylist.to/easylist/easylist.txt', kind: 'ads' },
    { id: 'easyprivacy', name: 'EasyPrivacy (تتبع)', url: 'https://easylist.to/easylist/easyprivacy.txt', kind: 'trackers' },
    { id: 'annoyances', name: 'EasyList Cookie/Annoyances', url: 'https://secure.fanboy.co.nz/fanboy-annoyance.txt', kind: 'annoyances', optional: true },
  ],
  UPDATE_CHANNELS: ['latest', 'beta'],
};
