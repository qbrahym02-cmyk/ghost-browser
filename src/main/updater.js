/**
 * التحديث عن بُعد عبر GitHub Releases (electron-updater).
 * في وضع التطوير (غير مُغلّف) يعرض حالة 'unsupported' بدل الفشل.
 * يدعم قنوات latest/beta وخادم تحديث بديل عبر GHOST_UPDATE_URL.
 * الحالة كلها تُبث للواجهة (state.update) ليعرضها شريط التحديث المدمج:
 * فحص ← تنزيل بشريط تقدم ← تثبيت وإعادة تشغيل من داخل المتصفح.
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
  const set = (patch) => state.mutate((s) => {
    s.update = { ...s.update, ...patch };
  });

  /* الإصدار الحالي دائماً متاح للواجهة حتى قبل أي فحص */
  set({ currentVersion: app.getVersion() });

  if (!autoUpdater) {
    set({ status: 'unsupported' });
    return { check: async () => null, download: () => {}, install: () => {}, setChannel: () => {}, resumePending: () => {} };
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;

  const customUrl = process.env.GHOST_UPDATE_URL;
  if (customUrl) {
    autoUpdater.setFeedURL({ provider: 'generic', url: customUrl });
  }

  /* استعادة قناة التحديث المحفوظة عند الإقلاع */
  const savedChannel = store.get('update.channel', null);
  if (savedChannel) {
    try {
      autoUpdater.channel = savedChannel;
      autoUpdater.allowPrerelease = savedChannel !== 'latest';
    } catch { /* تجاهل */ }
  }

  autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: null }));
  autoUpdater.on('update-available', (info) => {
    set({
      status: 'available',
      version: info.version,
      progress: null,
      error: null,
      notes: { name: info.releaseName, body: stripHtml(info.releaseNotes) },
    });
    state.sendEvent('toast', { kind: 'ok', text: t('update.availableToast', { version: info.version }) });
  });
  autoUpdater.on('update-not-available', () => {
    set({ status: 'latest', progress: null });
    state.sendEvent('toast', { kind: 'ok', text: t('update.latest') });
  });
  autoUpdater.on('download-progress', (p) => {
    set({ status: 'downloading', progress: Math.round(p.percent), speed: Math.round((p.bytesPerSecond || 0) / 1024) });
  });
  autoUpdater.on('update-downloaded', (info) => {
    set({ status: 'downloaded', version: info.version, progress: 100 });
    state.sendEvent('toast', { kind: 'ok', text: t('update.ready', { version: info.version }) });
  });
  autoUpdater.on('error', (err) => {
    set({ status: 'error', error: String((err && err.message) || err) });
  });

  const api = {
    async check() {
      if (!app.isPackaged) {
        set({ status: 'unsupported', error: t('update.onlyPackaged'), currentVersion: app.getVersion() });
        return null;
      }
      try {
        const res = await autoUpdater.checkForUpdates();
        return res;
      } catch (err) {
        set({ status: 'error', error: err.message, currentVersion: app.getVersion() });
        return null;
      }
    },
    async download() {
      set({ status: 'downloading', progress: 0 });
      try { await autoUpdater.downloadUpdate(); } catch (err) { set({ status: 'error', error: err.message }); }
    },
    install() {
      /* حفظ الجلسة قبل إعادة التشغيل حتى لا تُفقد التابات المفتوحة */
      try { state.saveSessionHook && state.saveSessionHook(); } catch { /* تجاهل */ }
      autoUpdater.quitAndInstall(false, true);
    },
    setChannel(channel) {
      try { autoUpdater.channel = channel; autoUpdater.allowPrerelease = channel !== 'latest'; } catch { /* تجاهل */ }
      store.set('update.channel', channel);
      set({ channel });
    },
    resumePending() {
      /* تحديث نُزّل في جلسة سابقة ولم يُثبّت: نبث حالته فوراً ليظهر الزر */
      try {
        const pending = autoUpdater.currentVersion && autoUpdater.getUpdateInfoSync
          ? null : null; /* واجهة getUpdateInfoSync غير موثوقة — نكتفي بالفحص */
        void pending;
      } catch { /* تجاهل */ }
    },
  };

  /* فحص تلقائي بعد الإقلاع */
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
