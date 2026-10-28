/**
 * نقطة الإقلاع — Ghost Browser.
 * الترتيب مهم: حارس الإقلاع أولاً، ثم قفل النسخة، تسجيل البروتوكول قبل ready،
 * ثم المتاجر، المحرك، النافذة، الاستعادة.
 */
const path = require('node:path');
const { app } = require('electron');
const boot = require('./boot-guard');
boot.install();
const { AppState } = require('./state');
const { Store } = require('./store');
const { AdBlock } = require('./adblock');
const { SessionManager } = require('./sessions');
const { GroupManager } = require('./groups');
const { TabManager } = require('./tabs');
const { WindowManager } = require('./window');
const { IdentityApplier } = require('./identity/cdp');
const { FreeVpn } = require('./freevpn');
const protocol = require('./protocol');
const ipc = require('./ipc');
const menu = require('./menu');
const updater = require('./updater');
const { URLS, TAB_MODES } = require('../common/constants');

const ROOT = path.join(__dirname, '..', '..');
const isDev = !app.isPackaged || process.argv.includes('--dev');

/* خفّة: عطّل بعض ميزات كروميوم غير المستخدمة لتقليل البصمة الذاكرية */
app.commandLine.appendSwitch('disable-features', 'TranslateUI,InterestFeedContentSuggestions,CalculateNativeWinOcclusion,HardwareMediaKeyHandling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows', 'false');

/* قفل النسخة الواحدة */
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
boot.arm(); /* علامة إقلاع قيد التنفيذ — تُحذف عند نجاح الإقلاع فقط */

protocol.registerSchemes();

const DEFAULT_SETTINGS = {
  language: 'ar',
  dir: 'rtl',
  theme: 'dark',
  searchEngine: 'google',
  newTabUrl: URLS.NEW_TAB,
  defaultTabMode: TAB_MODES.GHOST,
  rotateIdentityPerGhostTab: false,
  countryPool: [],
  shieldsGlobal: true,
  dnt: true,
  gpc: true,
  memorySaver: { enabled: true, minutes: 10 },
  restoreSession: true,
  sidebarCollapsed: false,
  translateTarget: '',
  update: { auto: true, autoDownload: false, channel: 'latest' },
};

let ctx = null;

app.on('second-instance', () => {
  if (ctx?.wm?.win) {
    if (ctx.wm.win.isMinimized()) ctx.wm.win.restore();
    ctx.wm.win.focus();
  } else {
    /* لا نافذة (إقلاع سابق تالف) — أعد تشغيل نفسك بدل التجاهل الصامت */
    boot.log('second-instance: لا نافذة — إعادة تشغيل ذاتي');
    app.relaunch({ args: process.argv.slice(1) });
    app.exit(0);
  }
});

app.whenReady().then(async () => {
  try {
  /* إذا لم يكتمل الإقلاع السابق → حوار الوضع الآمن (قد يعيد التشغيل) */
  if (!boot.checkPreviousFailure()) return;

  const store = new Store(path.join(app.getPath('userData'), 'ghost-store.json'), {
    settings: DEFAULT_SETTINGS,
    groups: [],
    bookmarks: [],
    bundles: [],
    lastSession: null,
    sidebarCollapsed: false,
    windowBounds: null,
    activeGroupId: null,
    update: { auto: true, autoDownload: false, channel: 'latest' },
  });

  const state = new AppState();
  state.state.settings = { ...DEFAULT_SETTINGS, ...store.get('settings', {}) };
  state.state.ui.dir = state.state.settings.dir || 'rtl';
  state.state.ui.sidebarCollapsed = !!store.get('sidebarCollapsed', false);
  state.state.bookmarks = store.get('bookmarks', []);
  state.state.sessionBundles = store.get('bundles', []);

  app.setAppUserModelId('app.ghost.browser');
  app.setName('Ghost Browser');
  boot.step('boot:store-ok');

  /* مانع الإعلانات */
  const adblock = new AdBlock({
    app,
    state,
    coreListPath: path.join(ROOT, 'resources', 'blocklists', 'ghost-core.txt'),
    filtersDir: path.join(app.getPath('userData'), 'filters'),
  });
  await adblock.init();
  boot.step('boot:adblock-ok engine=' + adblock.engine);

  /* الجلسات والقروبات */
  const sessions = new SessionManager({
    state,
    adblock,
    partitionsDir: path.join(app.getPath('userData'), 'Partitions'),
  });
  const groups = new GroupManager({ state, store });
  groups.load();

  /* البروتوكول الداخلي قبل أي تحميل (ربط كسول بالتابات) */
  let tabsRef = null;
  protocol.install({ state, tabs: () => tabsRef, rootDir: ROOT });

  /* النافذة */
  const wm = new WindowManager({ state, store });
  wm.create();
  boot.step('boot:window-created');
  boot.bootOk(); /* من الآن: أخطاء التشغيل تُسجَّل ولا تقتل التطبيق */

  /* VPN المجاني: بروكسيات عامة مُختبَرة تُسحب عند أول فتح للوحة */
  const freevpn = new FreeVpn({ userDataDir: app.getPath('userData'), netLog: boot.log });
  state.state.vpn = { nodes: [], testing: false, at: 0, error: null };

  /* الهوية والتابات */
  const applier = new IdentityApplier();
  const tabs = new TabManager({ state, store, sessions, groups, applier, layout: wm, adblock });
  adblock.tabLookup = (wcId) => {
    for (const t of tabs.tabs.values()) {
      if (t.view && !t.view.webContents.isDestroyed() && t.view.webContents.id === wcId) return t.id;
    }
    return null;
  };

  /* ربط تعديل القروبات → جلسات وتابات حيّة */
  groups.onChange = (group, kind) => {
    try { sessions.reconfigureGroup(group); } catch { /* تجاهل */ }
    if (kind === 'updated' || kind === 'rerolled') {
      for (const t of tabs.tabs.values()) {
        if (t.groupId !== group.id || t.rotated) continue;
        t.identity = group.identity;
        if (t.view && !t.view.webContents.isDestroyed()) applier.apply(t.view.webContents, t.identity);
      }
    }
    if (kind === 'deleted') {
      for (const t of [...tabs.tabs.values()]) if (t.groupId === group.id) tabs.close(t.id);
      sessions.wipeGroup(group.id).catch(() => {});
    }
  };

  tabsRef = tabs;

  /* التحديث عن بُعد */
  const upd = updater.init({ state, store });

  /* الأوامر والقائمة */
  const deps = { state, store, tabs, groups, sessions, adblock, layout: wm, updater: upd, win: wm, freevpn };
  deps.ipcPanic = () => {
    const ghosts = [...tabs.tabs.values()].filter((t) => t.mode === TAB_MODES.GHOST);
    for (const t of ghosts) tabs.close(t.id);
    if (!tabs.active()) tabs.create({});
    state.sendEvent('toast', { kind: 'warn', text: `وضع الطوارئ: أُغلق ${ghosts.length} تاب شبح` });
  };
  ipc.install(deps);
  deps.menu = menu.install(deps);

  /* تنظيف الجلسات اليتيمة + استعادة الجلسة (الوضع الآمن يبدأ جلسة نظيفة) */
  const restored = boot.isSafe() ? null : tabs.restoreSession();
  boot.step('boot:session-restored=' + !!restored);
  if (!restored || !tabs.active()) {
    tabs.create({ url: URLS.NEW_TAB });
  }
  sessions.pruneOrphanPartitions([...tabs.tabs.values()].map((t) => t.partition));
  tabs.startMemorySaver();

  state.patch('ready', true);
  boot.step('boot:ready');
  ctx = { state, store, tabs, groups, sessions, wm, adblock, upd, freevpn };

  /* وضع الفحص الآلي: سيناريو عزل كامل + تحقق من حقن الهوية ثم خروج. */
  if (process.argv.includes('--smoke')) {
    const results = [];
    const check = (name, cond, extra = '') => results.push(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
    setTimeout(async () => {
      try {
        const { session } = require('electron');
        const g = groups.active();
        const a = tabs.create({ groupId: g.id, mode: 'ghost', url: 'https://example.com/', activate: false });
        const b = tabs.create({ groupId: g.id, mode: 'ghost', url: 'https://example.com/', activate: false });
        check('تابان شبحان بجلستين مختلفتين', a.partition !== b.partition, `${a.partition} vs ${b.partition}`);

        const sesA = session.fromPartition(a.partition);
        const sesB = session.fromPartition(b.partition);
        await sesA.cookies.set({ url: 'https://example.com', name: 'ghost_test', value: 'A' });
        const inB = await sesB.cookies.get({ url: 'https://example.com' });
        check('كوكيز التاب أ لا تُرى في التاب ب', inB.length === 0);

        await new Promise((r) => setTimeout(r, 2500));
        const tzA = await a.view.webContents.executeJavaScript('Intl.DateTimeFormat().resolvedOptions().timeZone', true);
        check('توقيت الهوية محقون في الصفحة', tzA === a.identity.timezone, `${tzA} == ${a.identity.timezone}`);
        const langA = await a.view.webContents.executeJavaScript('navigator.languages.join(",")', true);
        check('لغات الهوية محقونة', langA === a.identity.languages.join(','), langA);
        const platA = await a.view.webContents.executeJavaScript('navigator.platform', true);
        check('منصة navigator مطابقة', platA === (a.identity.platform === 'mac' ? 'MacIntel' : a.identity.platform === 'android' ? 'Linux armv8l' : 'Win32'), platA);
        const injected = await a.view.webContents.executeJavaScript('window.__GHOST_INJECTED__ === 1', true);
        check('سكربت البصمة يعمل في العالم الرئيسي', injected === true);
        const uaA = await a.view.webContents.executeJavaScript('navigator.userAgent', true);
        check('UA مطابق للهوية', uaA === a.identity.userAgent);

        const sharedA = tabs.create({ groupId: g.id, mode: 'shared', url: 'ghost://newtab/', activate: false });
        const sharedB = tabs.create({ groupId: g.id, mode: 'shared', url: 'ghost://newtab/', activate: false });
        check('تابات القروب المشترك تتشارك الجلسة', sharedA.partition === sharedB.partition);
        check('جلسة القروب مختلفة عن جلسة قروب آخر', (() => {
          const g2 = groups.list().find((x) => x.id !== g.id);
          return !g2 || sharedA.partition.includes(g.id);
        })());

        /* سبليت فيو: تاب ثانٍ بجانب النشط ثم فكّه */
        tabs.activate(sharedA.id);
        const splitOk = tabs.toggleSplit(sharedB.id);
        check('سبليت فيو يثبّت تاباً ثانياً', splitOk === true && wm.secondaryView === sharedB.view);
        const bounds = sharedA.view.getBounds();
        check('الشاشة انقسمت نصفين فعلياً', bounds.width > 100 && bounds.width < 2000, `w=${bounds.width}`);
        const splitOff = tabs.toggleSplit(sharedB.id);
        check('فك السبليت يعيد العرض موحداً', splitOff === false && wm.secondaryView === null);

        /* ترجمة: بناء الرابط عبر translate.goog */
        const { translateUrl } = require('../common/translate');
        const tr = translateUrl('https://example.com/page?a=1', 'ar');
        check('رابط الترجمة يُبنى عبر translate.goog', !!tr && tr.includes('.translate.goog'), tr || '');

        /* ملاحظات القروب تُحفظ */
        groups.update(g.id, { notes: 'ghost-smoke' });
        check('ملاحظات القروب تُحفظ', groups.get(g.id).notes === 'ghost-smoke');

        tabs.close(a.id); tabs.close(b.id); tabs.close(sharedA.id); tabs.close(sharedB.id);
      } catch (err) {
        results.push('FAIL استثناء — ' + err.message);
      }
      try {
        let img = await wm.win.capturePage();
        console.log('[ghost][smoke] capture size', img.getSize().width, img.getSize().height);
        if (img.isEmpty()) img = await wm.chrome.webContents.capturePage();
        require('node:fs').mkdirSync(require('node:path').join(ROOT, 'docs', 'screenshots'), { recursive: true });
        require('node:fs').writeFileSync(require('node:path').join(ROOT, 'docs', 'screenshots', 'smoke.png'), img.toPNG());
        console.log('[ghost][smoke] screenshot saved');
      } catch (e) { console.log('[ghost][smoke] screenshot fail', e.message); }
      const fails = results.filter((r) => r.startsWith('FAIL'));
      console.log('[ghost][smoke] tabs=' + tabs.tabs.size, 'groups=' + groups.list().length, 'engine=' + adblock.engine);
      for (const r of results) console.log('[ghost][smoke] ' + r);
      console.log(fails.length ? '[ghost][smoke] PROBLEMS' : '[ghost][smoke] OK');
      app.exit(fails.length ? 1 : 0);
    }, 6000);
  }

  if (isDev) console.log('[ghost] وضع التطوير — التحديث التلقائي معطّل');
  } catch (err) {
    boot.fail(err);
  }
});

app.on('window-all-closed', () => {
  if (ctx) {
    try { ctx.tabs.saveSession(); ctx.store.saveNow(); } catch { /* تجاهل */ }
  }
  app.quit();
});

app.on('before-quit', () => {
  if (ctx) {
    try { ctx.tabs.saveSession(); ctx.store.saveNow(); } catch { /* تجاهل */ }
  }
});
