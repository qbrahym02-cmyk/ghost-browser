/**
 * مانع الإعلانات والتتبع.
 * المحرك الأساسي: @ghostery/adblocker-electron (سريع، فلترة شبكة + تجميلية).
 * قوائم محلية مضمّنة (ghost-core) تعمل بدون إنترنت، مع تحديث اختياري عن بُعد
 * (EasyList / EasyPrivacy / Annoyances) يُخزَّن في userData/filters.
 * إذا فشل تحميل المحرك لأي سبب → مانع احتياطي خفيف عبر webRequest.
 */
const fs = require('node:fs');
const path = require('node:path');
const { ipcMain, session } = require('electron');
const { FILTER_SOURCES } = require('../common/constants');

/** حماية: ghostery يسجّل ipcMain.handle لكل جلسة؛ نجعل التسجيل idempotent بعدّاد مراجع. */
let ipcPatched = false;
function patchIpcMainOnce() {
  if (ipcPatched) return;
  ipcPatched = true;
  const counts = new Map();
  const origHandle = ipcMain.handle.bind(ipcMain);
  const origRemove = ipcMain.removeHandler.bind(ipcMain);
  ipcMain.handle = (channel, listener) => {
    if (typeof channel === 'string' && channel.startsWith('@ghostery/')) {
      const n = (counts.get(channel) || 0) + 1;
      counts.set(channel, n);
      if (n > 1) return undefined; // مسجَّل مسبقاً — نتجاهل بهدوء
    }
    return origHandle(channel, listener);
  };
  ipcMain.removeHandler = (channel) => {
    if (typeof channel === 'string' && counts.has(channel)) {
      const n = (counts.get(channel) || 1) - 1;
      counts.set(channel, n);
      if (n > 0) return undefined;
    }
    return origRemove(channel);
  };
}

function loadEngine() {
  patchIpcMainOnce();
  // eslint-disable-next-line global-require
  const { ElectronBlocker } = require('@ghostery/adblocker-electron');
  class CountingBlocker extends ElectronBlocker {
    onBeforeRequest(details, callback) {
      super.onBeforeRequest(details, (response) => {
        if (response && response.cancel && this.__onBlock) this.__onBlock(details);
        callback(response);
      });
    }
  }
  return CountingBlocker;
}

class AdBlock {
  #pending = 0;
  #flushTimer = null;

  /**
   * @param {object} deps { app, state, coreListPath, filtersDir }
   */
  constructor(deps) {
    this.app = deps.app;
    this.state = deps.state;
    this.coreListPath = deps.coreListPath;
    this.filtersDir = deps.filtersDir;
    this.blocker = null;
    this.engine = null; // 'ghostery' | 'fallback'
    /** Session → {on} : السجلات الحية لإعادة التمكين بعد تحديث القوائم */
    this.live = new Map();
    this.fallbackRules = null;
    this.#pending = 0;
    this.#flushTimer = null;
  }

  async init() {
    fs.mkdirSync(this.filtersDir, { recursive: true });
    try {
      const CountingBlocker = loadEngine();
      const text = this.#combinedLists(this.#enabledKinds());
      this.blocker = CountingBlocker.parse(text, {
        loadCosmeticFilters: true,
        loadNetworkFilters: true,
        loadExtendedSelectors: true,
        enableOptimizations: true,
      });
      this.blocker.__onBlock = (details) => this.#count(details);
      this.engine = 'ghostery';
    } catch (err) {
      console.warn('[ghost][adblock] محرك ghostery غير متاح، تفعيل المانع الاحتياطي:', err.message);
      this.engine = 'fallback';
      this.fallbackRules = this.#parseFallback(this.#combinedLists(this.#enabledKinds()));
    }
    this.state.mutate((s) => {
      s.adblock.engine = this.engine;
      s.adblock.lists = this.#listStatus();
      s.adblock.lastUpdate = this.#readMeta().lastUpdate || null;
    });
  }

  #enabledKinds() {
    const s = this.state.state;
    const kinds = new Set(['ads', 'trackers']);
    if (s.groups.some((g) => g.shields.annoyances)) kinds.add('annoyances');
    return [...kinds];
  }

  #listStatus() {
    return FILTER_SOURCES.map((src) => {
      const f = path.join(this.filtersDir, `${src.id}.txt`);
      let size = 0, present = false;
      try { size = fs.statSync(f).size; present = true; } catch { /* غير منزّلة */ }
      return { id: src.id, name: src.name, kind: src.kind, present, size };
    });
  }

  #readMeta() {
    try { return JSON.parse(fs.readFileSync(path.join(this.filtersDir, 'meta.json'), 'utf8')); }
    catch { return {}; }
  }

  /** يجمع القوائم المنزّلة (إن وُجدت) + القائمة الأساسية المضمّنة. */
  #combinedLists(kinds) {
    const parts = [];
    try { parts.push(fs.readFileSync(this.coreListPath, 'utf8')); } catch { parts.push(''); }
    for (const src of FILTER_SOURCES) {
      if (!kinds.includes(src.kind)) continue;
      try { parts.push(fs.readFileSync(path.join(this.filtersDir, `${src.id}.txt`), 'utf8')); } catch { /* لم تُنزَّل بعد */ }
    }
    return parts.join('\n');
  }

  #parseFallback(text) {
    const domains = new Set();
    const css = [];
    for (const line of text.split('\n')) {
      const l = line.trim();
      if (!l || l.startsWith('!') || l.startsWith('[')) continue;
      const net = l.match(/^\|\|([a-z0-9.-]+)\^?$/i);
      if (net) { domains.add(net[1].toLowerCase()); continue; }
      if (l.includes('##')) css.push(l);
    }
    return { domains, css };
  }

  #count(details) {
    this.#pending++;
    if (!this.#flushTimer) {
      this.#flushTimer = setTimeout(() => {
        this.#flushTimer = null;
        const n = this.#pending; this.#pending = 0;
        if (!n) return;
        const tabId = this.tabLookup ? this.tabLookup(details.webContentsId) : null;
        this.state.mutate((s) => {
          s.stats.blockedTotal += n;
          s.stats.blockedSession += n;
          const tab = tabId ? s.tabs.find((t) => t.id === tabId) : null;
          if (tab) tab.blocked += n;
        });
      }, 400);
    }
  }

  /** مزامنة جلسة مع دروع القروب الخاص بها. */
  syncSession(ses, shields) {
    const on = shields && (shields.ads || shields.trackers);
    if (this.engine === 'ghostery') {
      const was = this.blocker.isBlockingEnabled(ses);
      if (on && !was) this.blocker.enableBlockingInSession(ses);
      if (!on && was) this.blocker.disableBlockingInSession(ses);
    } else if (this.engine === 'fallback') {
      if (on) this.#enableFallback(ses);
      else this.#disableFallback(ses);
    }
    this.live.set(ses, { on: !!on });
  }

  #enableFallback(ses) {
    if (ses.__ghostFallback) return;
    ses.__ghostFallback = true;
    ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, cb) => {
      try {
        const host = new URL(details.url).hostname.replace(/^www\./, '');
        if (this.fallbackRules && this.#matchHost(host)) {
          this.#count(details);
          return cb({ cancel: true });
        }
      } catch { /* تجاهل */ }
      cb({});
    });
  }

  #disableFallback(ses) {
    if (!ses.__ghostFallback) return;
    ses.__ghostFallback = false;
    ses.webRequest.onBeforeRequest(null);
  }

  #matchHost(host) {
    if (!this.fallbackRules) return false;
    let h = host;
    while (h) {
      if (this.fallbackRules.domains.has(h)) return true;
      const i = h.indexOf('.');
      if (i < 0) break;
      h = h.slice(i + 1);
    }
    return false;
  }

  /** تحديث القوائم من الإنترنت وإعادة بناء المحرك. */
  async updateLists() {
    this.state.mutate((s) => { s.adblock.updating = true; s.adblock.error = null; });
    const results = [];
    for (const src of FILTER_SOURCES) {
      try {
        const res = await fetch(src.url, { signal: AbortSignal.timeout(25000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        if (text.length < 500) throw new Error('قائمة صغيرة بشكل مريب');
        fs.writeFileSync(path.join(this.filtersDir, `${src.id}.txt`), text, 'utf8');
        results.push({ id: src.id, ok: true, size: text.length });
      } catch (err) {
        results.push({ id: src.id, ok: false, error: err.message });
      }
    }
    const meta = this.#readMeta();
    meta.lastUpdate = new Date().toISOString();
    meta.results = results;
    fs.writeFileSync(path.join(this.filtersDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');

    // إعادة بناء المحرك بنفس الجلسات النشطة
    const active = [...this.live.entries()];
    if (this.engine === 'ghostery') {
      for (const [ses] of active) {
        try { this.blocker.disableBlockingInSession(ses); } catch { /* تجاهل */ }
      }
      try {
        const CountingBlocker = loadEngine();
        this.blocker = CountingBlocker.parse(this.#combinedLists(this.#enabledKinds()), {
          loadCosmeticFilters: true, loadNetworkFilters: true, loadExtendedSelectors: true, enableOptimizations: true,
        });
        this.blocker.__onBlock = (d) => this.#count(d);
      } catch (err) {
        this.state.mutate((s) => { s.adblock.error = err.message; });
      }
    } else {
      this.fallbackRules = this.#parseFallback(this.#combinedLists(this.#enabledKinds()));
    }
    for (const [ses, info] of active) {
      if (info.on) this.syncSession(ses, { ads: true, trackers: true, annoyances: false });
    }
    this.state.mutate((s) => {
      s.adblock.updating = false;
      s.adblock.lists = this.#listStatus();
      s.adblock.lastUpdate = meta.lastUpdate;
    });
    return results;
  }

}

module.exports = { AdBlock };
