/**
 * جسر الأوامر بين واجهات العرض والعملية الرئيسية.
 * كل شيء يمر عبر قناتين: ghost:action (طلب/استجابة) و ghost:state (بث).
 */
const { ipcMain, dialog, app, shell, session } = require('electron');
const fs = require('node:fs');
const { IPC, TAB_MODES, URLS, PARTITION } = require('../common/constants');
const { buildIdentity } = require('../common/identity');
const { PRESETS } = require('../common/countries');
const { makeT } = require('../common/strings');

function install(deps) {
  const { state, store, tabs, groups, sessions, adblock, layout, updater, win: wm } = deps;
  const t = makeT(() => state.state.settings.language || 'ar');

  ipcMain.handle(IPC.GET_STATE, () => state.state);
  ipcMain.handle('ghost:whoami', (event) => tabs.byWebContentsId(event.sender.id)?.id || null);

  ipcMain.handle(IPC.ACTION, async (event, msg) => {
    const { type } = msg || {};
    const active = () => tabs.active();
    try {
      switch (type) {
        /* ---------------------------------------------------------- تابات */
        case 'tab:new':
          return tabs.create({ groupId: msg.groupId, url: msg.url, mode: msg.mode, index: msg.index, rotate: msg.rotate })?.id || null;
        case 'tab:close': return tabs.close(msg.id), true;
        case 'tab:activate': return tabs.activate(msg.id), true;
        case 'tab:move': return tabs.move(msg.id, msg.index), true;
        case 'tab:navigate': return tabs.navigate(msg.id, msg.url), true;
        case 'tab:back': return tabs.back(msg.id), true;
        case 'tab:forward': return tabs.forward(msg.id), true;
        case 'tab:reload': return tabs.reload(msg.id, msg.hard), true;
        case 'tab:stop': return tabs.stop(msg.id), true;
        case 'tab:duplicate': return tabs.duplicate(msg.id, { fresh: msg.fresh !== false })?.id || null;
        case 'tab:promote': return tabs.promote(msg.id);
        case 'tab:freeze': return tabs.freeze(msg.id);
        case 'tab:thaw': return tabs.thaw(msg.id), true;
        case 'tab:mute': return tabs.toggleMute(msg.id), true;
        case 'tab:zoom': {
          const t = tabs.get(msg.id) || active();
          if (!t) return false;
          tabs.setZoom(t.id, msg.level != null ? msg.level : t.zoom + (msg.delta || 0));
          return true;
        }
        case 'tab:find': return tabs.find(msg.id || active()?.id, msg.text, msg), true;
        case 'tab:find-stop': { const t = tabs.get(msg.id) || active(); if (t) t.view.webContents.stopFindInPage('clearSelection'); return true; }
        case 'tab:screenshot': return tabs.screenshot(msg.id || active()?.id);
        case 'tab:devtools': return tabs.openDevTools(msg.id || active()?.id), true;
        case 'tab:split': return tabs.toggleSplit(msg.id || active()?.id);
        case 'tab:translate': return tabs.translate(msg.id || active()?.id, msg.to);
        case 'tab:open-external': {
          const t = tabs.get(msg.id) || active();
          if (t && /^https?:/.test(t.url)) shell.openExternal(t.url);
          return true;
        }

        /* ---------------------------------------------------------- قروبات */
        case 'group:new': return groups.create(msg)?.id;
        case 'group:update': return !!groups.update(msg.id, msg.patch);
        case 'group:set-preset': {
          const g = groups.get(msg.id);
          if (!g) return false;
          const identity = buildIdentity({ presetId: msg.presetId, seedString: g.id });
          groups.update(g.id, { identity });
          return true;
        }
        case 'group:reroll': return !!groups.reroll(msg.id, msg.presetId);
        case 'group:delete': {
          const had = groups.remove(msg.id);
          if (had && msg.wipe) await sessions.wipeGroup(msg.id);
          return had;
        }
        case 'group:activate': return groups.activate(msg.id), true;
        case 'group:wipe': {
          const n = await sessions.wipeGroup(msg.id);
          state.sendEvent('toast', { kind: 'ok', text: t('group.wiped') });
          return n;
        }
        case 'group:proxy-check': {
          /* فحص IP عبر جلسة القروب نفسها (يشمل بروكسيه وهويته) */
          const g = groups.get(msg.id);
          if (!g) return { error: 'no group' };
          state.sendEvent('toast', { kind: 'ok', text: t('group.ipChecking') });
          try {
            const ses = session.fromPartition(PARTITION.shared(g.id));
            if (g.proxy && g.proxy.enabled && g.proxy.url) {
              await ses.setProxy({ proxyRules: g.proxy.url, proxyBypassRules: g.proxy.bypass || '<-loopback>' });
            } else {
              await ses.setProxy({ mode: 'system' });
            }
            if (typeof ses.fetch !== 'function') throw new Error('session.fetch unavailable');
            let info = null;
            try {
              const r = await ses.fetch('https://ipinfo.io/json', { signal: AbortSignal.timeout(12000) });
              if (!r.ok) throw new Error(`HTTP ${r.status}`);
              info = await r.json();
            } catch {
              const r = await ses.fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(12000) });
              if (!r.ok) throw new Error(`HTTP ${r.status}`);
              info = await r.json();
            }
            const res = {
              ip: info.ip || '—',
              country: info.country || '—',
              city: info.city || info.region || '—',
              timezone: info.timezone || '—',
              at: Date.now(),
            };
            groups.update(g.id, { proxy: { lastCheck: res } });
            state.sendEvent('toast', { kind: 'ok', text: t('group.ipOk', { ip: res.ip, country: res.country }) });
            return res;
          } catch (err) {
            const e = { error: err.message, at: Date.now() };
            groups.update(g.id, { proxy: { lastCheck: e } });
            state.sendEvent('toast', { kind: 'error', text: t('group.ipFail', { err: err.message }) });
            return e;
          }
        }
        case 'group:cookies': {
          const sesList = sessions.forGroup(msg.id);
          const seen = new Set();
          const out = [];
          for (const { ses } of sesList) {
            let cs = [];
            try { cs = await ses.cookies.get({}); } catch { /* تجاهل */ }
            for (const c of cs) {
              const key = `${c.domain}${c.path}${c.name}`;
              if (seen.has(key)) continue;
              seen.add(key);
              out.push({ domain: c.domain, name: c.name, path: c.path, secure: c.secure, httpOnly: c.httpOnly, expirationDate: c.expirationDate });
            }
          }
          return out.slice(0, 500);
        }
        case 'group:export': {
          const text = groups.exportJSON(msg.id);
          if (!text) return false;
          const g = groups.get(msg.id);
          const { canceled, filePath } = await dialog.showSaveDialog(wm.win, {
            defaultPath: `ghost-group-${g.name}.json`,
            filters: [{ name: 'JSON', extensions: ['json'] }],
          });
          if (canceled || !filePath) return false;
          fs.writeFileSync(filePath, text, 'utf8');
          return filePath;
        }
        case 'group:import': {
          const { canceled, filePaths } = await dialog.showOpenDialog(wm.win, {
            filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'],
          });
          if (canceled || !filePaths[0]) return false;
          const res = groups.importJSON(fs.readFileSync(filePaths[0], 'utf8'));
          if (res && res.error) { state.sendEvent('toast', { kind: 'error', text: t('group.importFail', { err: res.error }) }); return false; }
          state.sendEvent('toast', { kind: 'ok', text: t('group.imported', { name: res.name }) });
          return res?.id || true;
        }

        /* ---------------------------------------------------------- واجهة */
        case 'ui:overlay-push':
          state.mutate((s) => { s.ui.overlayStack.push({ kind: msg.kind, params: msg.params || {} }); });
          layout.setOverlayVisible(true);
          return true;
        case 'ui:overlay-pop':
          state.mutate((s) => { s.ui.overlayStack.pop(); });
          layout.setOverlayVisible(state.state.ui.overlayStack.length > 0);
          return true;
        case 'ui:overlay-close':
          state.mutate((s) => { s.ui.overlayStack = []; });
          layout.setOverlayVisible(false);
          return true;
        case 'ui:sidebar-toggle':
          state.mutate((s) => { s.ui.sidebarCollapsed = !s.ui.sidebarCollapsed; });
          store.set('sidebarCollapsed', state.state.ui.sidebarCollapsed);
          layout.layout();
          return true;
        case 'ui:immersive': return wm.toggleImmersive(), true;
        case 'ui:focus-address': return state.sendEvent('focus-address', {}), true;

        /* ---------------------------------------------------------- نافذة */
        case 'win:min': return wm.minimize(), true;
        case 'win:max': return wm.toggleMaximize(), true;
        case 'win:close': return wm.close(), true;
        case 'win:fullscreen': return wm.toggleFullscreen(), true;

        /* ---------------------------------------------------------- إعدادات */
        case 'settings:update': {
          const before = state.state.settings;
          state.mutate((s) => {
            s.settings = deepMerge(s.settings, msg.patch);
          });
          store.set('settings', state.state.settings);
          if (msg.patch.dir && msg.patch.dir !== before.dir) {
            state.patch('ui.dir', msg.patch.dir);
            layout.layout();
          }
          if (msg.patch.language && msg.patch.language !== before.language) {
            /* إعادة بناء قائمة التطبيق باللغة الجديدة */
            try { deps.menu && deps.menu.rebuild && deps.menu.rebuild(); } catch { /* تجاهل */ }
          }
          if (msg.patch.update && msg.patch.update.channel) updater.setChannel(msg.patch.update.channel);
          return true;
        }

        /* ---------------------------------------------------------- دروع/حجب */
        case 'shields:toggle-group': {
          const g = groups.get(msg.id);
          if (!g) return false;
          groups.update(g.id, { shields: { [msg.kind]: msg.enabled } });
          return true;
        }
        case 'adblock:update-lists': return adblock.updateLists();

        /* ---------------------------------------------------------- إشارات */
        case 'panic': {
          const ghosts = [...tabs.tabs.values()].filter((tb) => tb.mode === TAB_MODES.GHOST);
          for (const tb of ghosts) tabs.close(tb.id);
          if (!tabs.active()) tabs.create({});
          state.sendEvent('toast', { kind: 'warn', text: t('panic.done', { n: ghosts.length }) });
          return ghosts.length;
        }

        /* ---------------------------------------------------------- صفحات داخلية */
        case 'open:newtab': return tabs.create({ url: URLS.NEW_TAB, groupId: msg.groupId })?.id || null;
        case 'open:leaktest': return tabs.create({ url: URLS.LEAK_TEST, groupId: msg.groupId || active()?.groupId })?.id || null;

        /* ---------------------------------------------------------- إشارات مرجعية */
        case 'bookmark:add': {
          const t = tabs.get(msg.id) || active();
          if (!t) return false;
          const list = store.get('bookmarks', []);
          if (list.some((b) => b.url === t.url)) return false;
          list.unshift({ id: Math.random().toString(36).slice(2, 8), groupId: t.groupId, url: t.url, title: t.title, at: Date.now() });
          store.set('bookmarks', list);
          state.mutate((s) => { s.bookmarks = list; });
          return true;
        }
        case 'bookmark:remove': {
          const list = store.get('bookmarks', []).filter((b) => b.id !== msg.id);
          store.set('bookmarks', list);
          state.mutate((s) => { s.bookmarks = list; });
          return true;
        }

        /* ---------------------------------------------------------- حزم جلسات */
        case 'bundle:save': {
          const bundles = store.get('bundles', []);
          const snap = [...tabs.tabs.values()]
            .filter((t) => t.groupId === (msg.groupId || t.groupId))
            .map((t) => ({ groupId: t.groupId, mode: t.mode === TAB_MODES.GHOST ? TAB_MODES.GHOST : t.mode, url: t.url, title: t.title }));
          bundles.unshift({ id: Math.random().toString(36).slice(2, 8), name: msg.name || `حزمة ${new Date().toLocaleString('ar')}`, at: Date.now(), tabs: snap });
          store.set('bundles', bundles.slice(0, 20));
          state.mutate((s) => { s.sessionBundles = bundles.slice(0, 20); });
          return true;
        }
        case 'bundle:restore': {
          const b = store.get('bundles', []).find((x) => x.id === msg.id);
          if (!b) return false;
          for (const tb of b.tabs) tabs.create({ groupId: tb.groupId, mode: tb.mode, url: tb.url, background: true });
          state.sendEvent('toast', { kind: 'ok', text: t('bundle.restored', { name: b.name, n: b.tabs.length }) });
          return true;
        }
        case 'bundle:delete': {
          const bundles = store.get('bundles', []).filter((x) => x.id !== msg.id);
          store.set('bundles', bundles);
          state.mutate((s) => { s.sessionBundles = bundles; });
          return true;
        }

        /* ---------------------------------------------------------- تحميلات */
        case 'download:open': return require('./downloads').open(msg.id), true;
        case 'download:show': return require('./downloads').show(msg.id), true;
        case 'download:cancel': return require('./downloads').cancel(msg.id), true;

        /* ---------------------------------------------------------- تحديث */
        case 'update:check': return updater.check(), true;
        case 'update:download': return updater.download(), true;
        case 'update:install': return updater.install(), true;

        /* ---------------------------------------------------------- متفرقات */
        case 'app:version': return { version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome };
        case 'app:open-external': return shell.openExternal(msg.url), true;
        case 'presets:list': return Object.values(PRESETS);
        default:
          return { error: `unknown action: ${type}` };
      }
    } catch (err) {
      console.error('[ghost][ipc]', type, err);
      return { error: err.message };
    }
  });
}

function deepMerge(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

module.exports = { install, deepMerge };
