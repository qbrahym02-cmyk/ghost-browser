/**
 * مدير التابات: كل تاب = WebContentsView مستقل بجلسته الخاصة.
 *  - ghost : جهاز جديد تماماً، يُمحى أثره عند الإغلاق.
 *  - keep  : جهاز خاص محفوظ يبقى بعد إعادة التشغيل.
 *  - shared: جلسة القروب المشتركة.
 * يشمل: تجميد الذاكرة، الترويج (حفظ جلسة شبح)، التدوير، لقطة شاشة، بحث، زوم.
 */
const path = require('node:path');
const crypto = require('node:crypto');
const { WebContentsView, Menu, MenuItem, session, shell } = require('electron');
const { TAB_MODES, URLS, LIMITS } = require('../common/constants');
const { buildIdentity } = require('../common/identity');
const { makeT } = require('../common/strings');
const { translateUrl } = require('../common/translate');

const uid = () => crypto.randomBytes(6).toString('base64url');

class TabManager {
  #memoryTimer = null;

  constructor(deps) {
    this.state = deps.state;
    this.store = deps.store;
    this.sessions = deps.sessions;
    this.groups = deps.groups;
    this.applier = deps.applier;
    this.layout = deps.layout;
    this.adblock = deps.adblock;
    this.settings = () => this.state.state.settings;
    this.t = makeT(() => this.settings().language || 'ar');
    /** @type {Map<string, object>} */
    this.tabs = new Map();
    this.order = [];
    this.activeTabId = null;
    this.htmlFullscreenTab = null;
    this.#memoryTimer = null;
  }

  /* ------------------------------------------------------------- إنشاء */
  create(opts = {}) {
    const { groupId, url, mode, index, activate = true, background = false, rotate } = opts;
    const s = this.state.state;
    if (this.tabs.size >= LIMITS.MAX_TABS) {
      this.state.sendEvent('toast', { kind: 'warn', text: this.t('tabs.max') });
      return null;
    }
    const group = this.groups.get(groupId) || this.groups.active();
    const tabMode = mode || group.tabMode || s.settings.defaultTabMode || TAB_MODES.GHOST;
    const id = (opts && opts.id && !this.tabs.has(opts.id)) ? opts.id : uid();

    let identity = group.identity;
    const shouldRotate = rotate || (tabMode === TAB_MODES.GHOST && s.settings.rotateIdentityPerGhostTab);
    if (shouldRotate) {
      const pool = (s.settings.countryPool && s.settings.countryPool.length) ? s.settings.countryPool : Object.keys(require('../common/countries').PRESETS);
      const presetId = pool[Math.floor(Math.random() * pool.length)];
      identity = buildIdentity({ presetId, seedString: id });
    }

    const ses = this.sessions.acquire({ id, mode: tabMode }, group);
    const view = new WebContentsView({
      webPreferences: {
        partition: this.sessions.partitionFor({ id, mode: tabMode }, group),
        preload: path.join(__dirname, '..', 'preload', 'page-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        spellcheck: false,
        backgroundThrottling: true,
        safeDialogs: true,
        enableWebSQL: false,
      },
    });
    view.setBackgroundColor('#0B0A12');

    const tab = {
      id,
      groupId: group.id,
      mode: tabMode,
      partition: this.sessions.partitionFor({ id, mode: tabMode }, group),
      view,
      identity,
      url: url || this.settings().newTabUrl || URLS.NEW_TAB,
      title: this.t('tabs.newTab'),
      favicons: [],
      loading: false,
      canGoBack: false,
      canGoForward: false,
      audible: false,
      muted: false,
      zoom: 0,
      crashed: false,
      discarded: false,
      frozen: false,
      blocked: 0,
      error: null,
      degraded: false,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };
    this.tabs.set(id, tab);
    if (index != null && index >= 0 && index < this.order.length) this.order.splice(index, 0, id);
    else this.order.push(id);

    group.stats.tabsOpened = (group.stats.tabsOpened || 0) + 1;
    this.#wire(tab, ses);
    this.layout.addTabView(view);
    this.applier.watch(view.webContents, () => tab.identity);
    this.applier.apply(view.webContents, identity);
    this.#load(tab, tab.url);

    if (activate && !background) this.activate(id);
    this.#sync();
    return tab;
  }

  /* ------------------------------------------------------------- أحداث */
  #wire(tab, ses) {
    const wc = tab.view.webContents;

    wc.on('page-title-updated', (e, title) => { tab.title = title; this.#sync(); });
    wc.on('page-favicon-updated', (e, favicons) => {
      const pickFav = (favicons || []).find((f) => f.startsWith('data:') ? f.length < LIMITS.FAVICON_MAX_BYTES : f.startsWith('https:'));
      if (pickFav) { tab.favicons = [pickFav]; this.#sync(); }
    });
    wc.on('did-start-loading', () => { tab.loading = true; tab.error = null; this.#sync(); });
    wc.on('did-stop-loading', () => {
      tab.loading = false;
      tab.canGoBack = wc.navigationHistory.canGoBack();
      tab.canGoForward = wc.navigationHistory.canGoForward();
      this.#verifyInjection(tab);
      this.#sync();
    });
    wc.on('did-navigate', (e, url) => {
      tab.url = url;
      tab.canGoBack = wc.navigationHistory.canGoBack();
      tab.canGoForward = wc.navigationHistory.canGoForward();
      this.#sync();
    });
    wc.on('did-navigate-in-page', (e, url) => { tab.url = url; this.#sync(); });
    wc.on('did-fail-load', (e, code, desc, url, isMain) => {
      if (!isMain || code === -3) return;
      tab.error = { code, desc, url };
      tab.loading = false;
      this.#sync();
    });
    wc.on('render-process-gone', (e, details) => {
      tab.crashed = true;
      this.state.sendEvent('toast', { kind: 'error', text: this.t('tabs.crashed', { title: tab.title }) });
      this.#sync();
    });
    wc.on('certificate-error', (e) => { e.preventDefault(); });
    wc.on('will-navigate', (e, url) => {
      if (!this.#isAllowedUrl(url)) { e.preventDefault(); this.state.sendEvent('toast', { kind: 'warn', text: 'محظور: بروتوكول غير آمن' }); }
    });
    wc.on('will-prevent-unload', (e) => e.preventDefault());
    wc.on('enter-html-full-screen', () => { this.htmlFullscreenTab = tab.id; this.layout.setHtmlFullscreen(true); });
    wc.on('leave-html-full-screen', () => { this.htmlFullscreenTab = null; this.layout.setHtmlFullscreen(false); });
    try {
      wc.on('audio-state-changed', (e, audible) => { tab.audible = audible; this.#sync(); });
    } catch { /* إصدار أقدم */ }

    wc.setWindowOpenHandler(({ url }) => {
      if (this.#isAllowedUrl(url)) {
        setImmediate(() => this.create({ groupId: tab.groupId, mode: tab.mode === TAB_MODES.SHARED ? TAB_MODES.SHARED : TAB_MODES.GHOST, url }));
      }
      return { action: 'deny' };
    });

    wc.on('context-menu', (e, params) => this.#pageContextMenu(tab, params).popup());

    wc.on('login', (e, details, authInfo, cb) => {
      const g = this.groups.get(tab.groupId);
      if (authInfo.scheme === 'basic' && g && g.proxy && g.proxy.username) {
        e.preventDefault();
        cb(g.proxy.username, g.proxy.password || '');
      }
    });

    /* التحميلات — خطاف واحد لكل جلسة */
    if (!ses.__ghostDownloads) {
      ses.__ghostDownloads = true;
      ses.on('will-download', (e, item) => require('./downloads').handleItem(this.state, item));
    }
  }

  #pageContextMenu(tab, params) {
    const wc = tab.view.webContents;
    const menu = new Menu();
    if (params.linkURL) {
      menu.append(new MenuItem({ label: this.t('ctx.openGhost'), click: () => this.create({ groupId: tab.groupId, mode: TAB_MODES.GHOST, url: params.linkURL }) }));
      menu.append(new MenuItem({ label: this.t('ctx.openSame'), click: () => this.create({ groupId: tab.groupId, mode: tab.mode, url: params.linkURL, background: true }) }));
      menu.append(new MenuItem({ label: this.t('ctx.copyLink'), click: () => { require('electron').clipboard.writeText(params.linkURL); } }));
      menu.append(new MenuItem({ type: 'separator' }));
    }
    if (params.selectionText) menu.append(new MenuItem({ label: this.t('ctx.copy'), role: 'copy' }));
    menu.append(new MenuItem({ label: this.t('ctx.paste'), role: 'paste', enabled: params.isEditable }));
    menu.append(new MenuItem({ type: 'separator' }));
    menu.append(new MenuItem({ label: tab.loading ? this.t('ctx.stop') : this.t('ctx.reload'), click: () => (tab.loading ? wc.stop() : wc.reload()) }));
    menu.append(new MenuItem({ label: this.t('ctx.saveAs'), click: () => wc.downloadURL(tab.url) }));
    menu.append(new MenuItem({ type: 'separator' }));
    if (/^https?:/.test(tab.url)) {
      menu.append(new MenuItem({ label: this.t('ctx.translate'), click: () => this.translate(tab.id) }));
      menu.append(new MenuItem({ label: this.t('ctx.qr'), click: () => this.state.sendEvent('open-qr', { url: tab.url }) }));
      menu.append(new MenuItem({ type: 'separator' }));
    }
    menu.append(new MenuItem({ label: this.t('ctx.screenshot'), click: () => this.screenshot(tab.id) }));
    menu.append(new MenuItem({ label: this.t('ctx.inspect'), click: () => wc.inspectElement(params.x, params.y) }));
    return menu;
  }

  #isAllowedUrl(url) {
    try {
      const u = new URL(url);
      return ['http:', 'https:', 'ghost:', 'about:', 'data:', 'blob:', 'magnet:'].includes(u.protocol);
    } catch { return false; }
  }

  #verifyInjection(tab) {
    const wc = tab.view.webContents;
    if (!tab.url.startsWith('http')) return;
    this.applier.verify(wc).then((ok) => {
      if (ok) { tab.degraded = false; return; }
      tab.degraded = true;
      this.applier.applyDegraded(wc, tab.identity);
      this.#sync();
    }).catch(() => {});
  }

  /* ------------------------------------------------------------- تنقّل */
  #load(tab, url) {
    const target = url || URLS.NEW_TAB;
    try {
      tab.view.webContents.loadURL(target);
    } catch (err) {
      tab.error = { code: -1, desc: err.message, url: target };
    }
  }

  navigate(id, input) {
    const tab = this.get(id);
    if (!tab) return;
    const url = normalizeInput(input, this.settings().searchEngine);
    tab.url = url;
    tab.crashed = false;
    this.#load(tab, url);
    this.#sync();
  }

  /** ترجمة الصفحة الحالية عبر وسيط Google Translate (أو العودة للأصل). */
  translate(id, to) {
    const tab = this.get(id);
    if (!tab || !/^https?:/.test(tab.url)) return false;
    const target = to || this.settings().translateTarget || (this.settings().language === 'en' ? 'en' : 'ar');
    const url = translateUrl(tab.url, target);
    if (!url) return false;
    this.navigate(id, url);
    return true;
  }

  back(id) { const t = this.get(id); if (t && t.view.webContents.navigationHistory.canGoBack()) t.view.webContents.navigationHistory.goBack(); }
  forward(id) { const t = this.get(id); if (t && t.view.webContents.navigationHistory.canGoForward()) t.view.webContents.navigationHistory.goForward(); }
  reload(id, hard) {
    const t = this.get(id);
    if (!t) return;
    if (t.crashed || t.frozen) { this.thaw(id); return; }
    if (hard) t.view.webContents.reloadIgnoringCache(); else t.view.webContents.reload();
  }
  stop(id) { const t = this.get(id); if (t) t.view.webContents.stop(); }

  /* ------------------------------------------------------------- دورة حياة */
  get(id) { return this.tabs.get(id) || null; }
  active() { return this.get(this.activeTabId); }
  byWebContentsId(wcId) {
    for (const t of this.tabs.values()) {
      if (t.view && !t.view.webContents.isDestroyed() && t.view.webContents.id === wcId) return t;
    }
    return null;
  }

  activate(id) {
    const tab = this.get(id);
    if (!tab) return;
    if (tab.frozen) this.thaw(id);
    this.activeTabId = id;
    tab.lastActiveAt = Date.now();
    this.state.patch('activeTabId', id);
    this.layout.activateTab(tab.view);
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.focus();
    this.groups.activate(tab.groupId);
    this.#sync();
  }

  /* ------------------------------------------------------------- عرض مقسوم */
  /** يثبّت تاباً ثانياً بجانب التاب النشط (سبليت فيو) أو يفكه. */
  toggleSplit(id) {
    const tab = this.get(id);
    if (!tab) return false;
    const current = this.state.state.ui.splitTabId;
    if (current === id) {
      this.state.patch('ui.splitTabId', null);
      this.layout.clearSplitView();
      this.#sync();
      return false;
    }
    if (tab.frozen) this.thaw(id);
    const live = this.get(id);
    this.state.patch('ui.splitTabId', id);
    this.layout.setSplitView(live.view);
    /* إن كان التاب المثبّت هو النشط نفسه، اجعل تاباً آخر هو الأساس */
    if (this.activeTabId === id) {
      const other = this.order.find((x) => x !== id);
      if (other) this.activate(other);
      else this.create({ groupId: live.groupId, mode: live.mode, activate: true });
    } else {
      this.activate(this.activeTabId || id);
    }
    this.#sync();
    return true;
  }

  /** يعيد ربط عرض التاب الثانوي بعد إعادة بناء العرض (ترويج/إيقاظ). */
  #syncSplitView(tab) {
    if (this.state.state.ui.splitTabId === tab.id) {
      this.layout.setSplitView(tab.view);
    }
  }

  close(id) {
    const tab = this.get(id);
    if (!tab) return;
    const idx = this.order.indexOf(id);
    this.order = this.order.filter((x) => x !== id);
    this.tabs.delete(id);
    if (this.state.state.ui.splitTabId === id) this.state.patch('ui.splitTabId', null);
    try {
      this.layout.removeTabView(tab.view);
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    } catch { /* تجاهل */ }
    if (tab.mode === TAB_MODES.GHOST) this.sessions.releaseGhost(tab.partition);
    if (this.activeTabId === id) {
      const next = this.order[Math.min(idx, this.order.length - 1)];
      if (next) this.activate(next);
      else {
        this.activeTabId = null;
        this.layout.activateTab(null);
        this.state.patch('activeTabId', null);
      }
    }
    this.#sync();
  }

  move(id, toIndex) {
    const from = this.order.indexOf(id);
    if (from < 0) return;
    this.order.splice(from, 1);
    this.order.splice(Math.max(0, Math.min(toIndex, this.order.length)), 0, id);
    this.#sync();
  }

  duplicate(id, { fresh = true } = {}) {
    const tab = this.get(id);
    if (!tab) return null;
    return this.create({
      groupId: tab.groupId,
      mode: fresh ? TAB_MODES.GHOST : tab.mode,
      url: tab.url,
      rotate: fresh,
    });
  }

  /** تحويل تاب شبح إلى تاب محفوظ مع نقل الكوكيز. */
  async promote(id) {
    const tab = this.get(id);
    if (!tab || tab.mode !== TAB_MODES.GHOST) return false;
    const oldPartition = tab.partition;
    const oldSes = session.fromPartition(oldPartition);
    let cookies = [];
    try { cookies = await oldSes.cookies.get({}); } catch { /* تجاهل */ }
    const group = this.groups.get(tab.groupId);

    tab.mode = TAB_MODES.KEEP;
    tab.partition = this.sessions.partitionFor({ id: tab.id, mode: TAB_MODES.KEEP }, group);
    const newSes = this.sessions.acquire({ id: tab.id, mode: TAB_MODES.KEEP }, group);
    for (const c of cookies) {
      try {
        const domain = (c.domain || '').replace(/^\./, '');
        await newSes.cookies.set({
          url: `${c.secure ? 'https' : 'http'}://${domain}${c.path || '/'}`,
          name: c.name, value: c.value, domain: c.domain, path: c.path,
          secure: c.secure, httpOnly: c.httpOnly,
          expirationDate: c.expirationDate, sameSite: c.sameSite,
        });
      } catch { /* كوكيز غير قابلة للنقل */ }
    }
    // إعادة بناء العرض بالجلسة الجديدة
    const url = tab.url;
    try {
      this.layout.removeTabView(tab.view);
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    } catch { /* تجاهل */ }
    const view = new WebContentsView({
      webPreferences: {
        partition: tab.partition,
        preload: path.join(__dirname, '..', 'preload', 'page-preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true,
      },
    });
    tab.view = view;
    tab.frozen = false;
    this.layout.addTabView(view);
    this.#wire(tab, newSes);
    this.applier.watch(view.webContents, () => tab.identity);
    this.applier.apply(view.webContents, tab.identity);
    this.#load(tab, url);
    if (this.activeTabId === id) this.layout.activateTab(view);
    this.#syncSplitView(tab);
    this.sessions.releaseGhost(oldPartition);
    this.state.sendEvent('toast', { kind: 'ok', text: this.t('tabs.promoted') });
    this.#sync();
    return true;
  }

  /* ------------------------------------------------------------- تجميد الذاكرة */
  freeze(id) {
    const tab = this.get(id);
    if (!tab || tab.frozen || this.activeTabId === id) return false;
    if (this.state.state.ui.splitTabId === id) {
      this.state.patch('ui.splitTabId', null);
      this.layout.clearSplitView();
    }
    tab.frozen = true;
    tab.frozenUrl = tab.view.webContents.isDestroyed() ? tab.url : (tab.view.webContents.getURL() || tab.url);
    try {
      this.layout.removeTabView(tab.view);
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    } catch { /* تجاهل */ }
    this.#sync();
    return true;
  }

  thaw(id) {
    const tab = this.get(id);
    if (!tab || !tab.frozen) return;
    tab.frozen = false;
    const group = this.groups.get(tab.groupId);
    const ses = this.sessions.acquire({ id: tab.id, mode: tab.mode }, group);
    const view = new WebContentsView({
      webPreferences: {
        partition: tab.partition,
        preload: path.join(__dirname, '..', 'preload', 'page-preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true,
      },
    });
    tab.view = view;
    this.layout.addTabView(view);
    this.#wire(tab, ses);
    this.applier.watch(view.webContents, () => tab.identity);
    this.applier.apply(view.webContents, tab.identity);
    this.#load(tab, tab.frozenUrl || tab.url);
    if (this.activeTabId === id) this.layout.activateTab(view);
    this.#syncSplitView(tab);
    this.#sync();
  }

  startMemorySaver() {
    if (this.#memoryTimer) return;
    this.#memoryTimer = setInterval(() => {
      const st = this.settings().memorySaver;
      if (!st || st.enabled === false) return;
      const mins = st.minutes || 10;
      const now = Date.now();
      for (const tab of this.tabs.values()) {
        if (tab.id === this.activeTabId || tab.frozen || tab.loading) continue;
        if (now - tab.lastActiveAt > mins * 60 * 1000) this.freeze(tab.id);
      }
    }, 60 * 1000);
  }

  /* ------------------------------------------------------------- أدوات التاب */
  setZoom(id, level) {
    const tab = this.get(id);
    if (!tab) return;
    tab.zoom = Math.max(-3, Math.min(3, level));
    tab.view.webContents.setZoomLevel(tab.zoom);
    this.#sync();
  }

  toggleMute(id) {
    const tab = this.get(id);
    if (!tab) return;
    tab.muted = !tab.muted;
    tab.view.webContents.setAudioMuted(tab.muted);
    this.#sync();
  }

  find(id, text, opts = {}) {
    const tab = this.get(id);
    if (!tab) return;
    if (!text) { tab.view.webContents.stopFindInPage('clearSelection'); return; }
    tab.view.webContents.findInPage(text, { findNext: opts.next !== false, forward: opts.backward !== true });
  }

  async screenshot(id) {
    const tab = this.get(id);
    if (!tab) return null;
    try {
      const image = await tab.view.webContents.capturePage();
      const file = path.join(require('electron').app.getPath('pictures'), `ghost-${Date.now()}.png`);
      require('node:fs').writeFileSync(file, image.toPNG());
      this.state.sendEvent('toast', { kind: 'ok', text: this.t('tabs.shotSaved', { file }) });
      shell.showItemInFolder(file);
      return file;
    } catch (err) {
      this.state.sendEvent('toast', { kind: 'error', text: this.t('tabs.shotFail', { err: err.message }) });
      return null;
    }
  }

  openDevTools(id) {
    const tab = this.get(id);
    if (tab && !tab.view.webContents.isDestroyed()) tab.view.webContents.toggleDevTools();
  }

  /* ------------------------------------------------------------- استعادة/حفظ */
  saveSession() {
    const snapshot = this.order
      .map((id) => this.tabs.get(id))
      .filter((t) => t && t.mode !== TAB_MODES.GHOST)
      .map((t) => ({ id: t.id, groupId: t.groupId, mode: t.mode, url: t.url, title: t.title, partition: t.partition }));
    this.store.set('lastSession', { tabs: snapshot, activeId: this.activeTabId, at: Date.now() });
  }

  restoreSession() {
    const snap = this.store.get('lastSession', null);
    if (!snap || !this.settings().restoreSession) return 0;
    let n = 0;
    for (const t of snap.tabs || []) {
      if (!this.groups.get(t.groupId)) continue;
      const tab = this.create({ id: t.id, groupId: t.groupId, mode: t.mode, url: t.url, activate: false });
      if (tab) n++;
    }
    if (snap.activeId && this.get(snap.activeId)) this.activate(snap.activeId);
    else if (this.order.length) this.activate(this.order[0]);
    return n;
  }

  /** لقطة قابلة للإرسال للواجهات. */
  serialize() {
    return this.order.map((id) => {
      const t = this.tabs.get(id);
      if (!t) return null;
      return {
        id: t.id, groupId: t.groupId, mode: t.mode, title: t.title, url: t.url,
        favicons: t.favicons, loading: t.loading, canGoBack: t.canGoBack, canGoForward: t.canGoForward,
        audible: t.audible, muted: t.muted, zoom: t.zoom, crashed: t.crashed, frozen: t.frozen,
        blocked: t.blocked, error: t.error, degraded: t.degraded, split: this.state.state.ui.splitTabId === t.id,
        identity: {
          flag: t.identity.flag, country: t.identity.country, city: t.identity.city,
          timezone: t.identity.timezone, locale: t.identity.locale, webrtc: t.identity.webrtc,
        },
      };
    }).filter(Boolean);
  }

  #sync() {
    this.state.mutate((s) => {
      s.tabs = this.serialize();
      s.activeTabId = this.activeTabId;
    });
  }
}

/** يحوّل مدخل شريط العنوان إلى URL أو استعلام بحث. */
function normalizeInput(input, searchEngine = 'google') {
  const v = (input || '').trim();
  if (!v) return URLS.NEW_TAB;
  if (/^ghost:/i.test(v)) return v;
  if (/^localhost(:\d+)?([/?#].*)?$/i.test(v) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?([/?#].*)?$/.test(v)) {
    return `https://${v}`;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return v;
  const looksLikeUrl = /^[\w-]+(\.[\w-]+)+([/?#].*)?$/.test(v) || /^localhost(:\d+)?/.test(v) || /^\d{1,3}(\.\d{1,3}){3}/.test(v);
  if (looksLikeUrl) return v.startsWith('http') ? v : `https://${v}`;
  const engines = {
    google: 'https://www.google.com/search?q=',
    duckduckgo: 'https://duckduckgo.com/?q=',
    bing: 'https://www.bing.com/search?q=',
    brave: 'https://search.brave.com/search?q=',
  };
  return (engines[searchEngine] || engines.google) + encodeURIComponent(v);
}

module.exports = { TabManager, normalizeInput };
