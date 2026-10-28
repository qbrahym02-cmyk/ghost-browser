/**
 * التحديث عن بُعد عبر GitHub Releases (electron-updater).
 * في وضع التطوير (غير مُغلّف) يعرض حالة 'unsupported' بدل الفشل.
 * يدعم قنوات latest/beta وخادم تحديث بديل عبر GHOST_UPDATE_URL.
 */
const { app } = require('electron');
const { makeT } = require('../common/strings');

function init({ state, store }) {
  let autoUpdater = null;
  try {
    // eslint-disable-next-line global-require
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    console.warn('[ghost][update] electron-updater غير متاح:', err.message);
  }

  const t = makeT(() => state.state.settings.language || 'ar');
  const set = (patch) => state.mutate((s) => { Object.assign(s.update, patch); });

  if (!autoUpdater) {
    set({ status: 'unsupported' });
    return { check: async () => null, install: () => {}, setChannel: () => {} };
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;

  const customUrl = process.env.GHOST_UPDATE_URL;
  if (customUrl) {
    autoUpdater.setFeedURL({ provider: 'generic', url: customUrl });
  }

  autoUpdater.on('checking-for-update', () => set({ status: 'checking' }));
  autoUpdater.on('update-available', (info) => set({ status: 'available', version: info.version, info: { name: info.releaseName, notes: stripHtml(info.releaseNotes) } }));
  autoUpdater.on('update-not-available', () => {
    set({ status: 'latest' });
    state.sendEvent('toast', { kind: 'ok', text: t('update.latest') });
  });
  autoUpdater.on('download-progress', (p) => set({ status: 'downloading', progress: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => {
    set({ status: 'downloaded', version: info.version });
    state.sendEvent('toast', { kind: 'ok', text: t('update.ready', { version: info.version }) });
  });
  autoUpdater.on('error', (err) => set({ status: 'error', error: String(err && err.message || err) }));

  const api = {
    async check() {
      if (!app.isPackaged) {
        set({ status: 'unsupported', error: t('update.onlyPackaged') });
        return null;
      }
      try {
        const res = await autoUpdater.checkForUpdates();
        return res;
      } catch (err) {
        set({ status: 'error', error: err.message });
        return null;
      }
    },
    async download() {
      try { await autoUpdater.downloadUpdate(); } catch (err) { set({ status: 'error', error: err.message }); }
    },
    install() {
      autoUpdater.quitAndInstall(false, true);
    },
    setChannel(channel) {
      try { autoUpdater.channel = channel; autoUpdater.allowPrerelease = channel !== 'latest'; } catch { /* تجاهل */ }
      store.set('update.channel', channel);
    },
  };

  // فحص تلقائي بعد الإقلاع
  if (store.get('update.auto', true) && app.isPackaged) {
    setTimeout(() => api.check().then((r) => {
      if (r && r.updateInfo && state.state.update.status === 'available' && store.get('update.autoDownload', false)) api.download();
    }).catch(() => {}), 8000);
  }
  return api;
}

function stripHtml(v) {
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : x.note || '')).join('\n');
  if (typeof v === 'string') return v.replace(/<[^>]+>/g, '');
  return '';
}

module.exports = { init };
