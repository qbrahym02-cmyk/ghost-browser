/**
 * قائمة التطبيق + الاختصارات العامة (تعمل حتى والتركيز داخل صفحة).
 * تتضمن أدوار تحرير كاملة كي يعمل نسخ/لصق في كل الصفحات.
 * تُعاد البناء عند تغيير لغة الواجهة.
 */
const { Menu, app, shell } = require('electron');
const { makeT } = require('../common/strings');
const boot = require('./boot-guard');

function install(deps) {
  const { state, tabs, layout, win: wm } = deps;
  const send = (type, payload) => state.sendEvent(type, payload);
  const activeId = () => tabs.active()?.id || null;
  const t = makeT(() => state.state.settings.language || 'ar');

  function buildTemplate() {
    return [
      {
        label: t('menu.file'),
        submenu: [
          { label: t('menu.newTab'), accelerator: 'CmdOrCtrl+T', click: () => tabs.create({}) },
          { label: t('menu.newGhostTab'), accelerator: 'CmdOrCtrl+Shift+T', click: () => tabs.create({ mode: 'ghost', rotate: true }) },
          { label: t('menu.closeTab'), accelerator: 'CmdOrCtrl+W', click: () => activeId() && tabs.close(activeId()) },
          { type: 'separator' },
          { label: t('menu.split'), accelerator: 'CmdOrCtrl+Alt+S', click: () => activeId() && tabs.toggleSplit(activeId()) },
          { label: t('menu.saveBundle'), click: () => send('overlay-open-bundle-save', {}) },
          { type: 'separator' },
          { label: t('menu.quit'), role: 'quit' },
        ],
      },
      {
        label: t('menu.edit'),
        submenu: [
          { role: 'undo', label: t('menu.undo') },
          { role: 'redo', label: t('menu.redo') },
          { type: 'separator' },
          { role: 'cut', label: t('menu.cut') },
          { role: 'copy', label: t('menu.copy') },
          { role: 'paste', label: t('menu.paste') },
          { role: 'selectAll', label: t('menu.selectAll') },
        ],
      },
      {
        label: t('menu.view'),
        submenu: [
          { label: t('menu.reload'), accelerator: 'CmdOrCtrl+R', click: () => activeId() && tabs.reload(activeId()) },
          { label: t('menu.hardReload'), accelerator: 'CmdOrCtrl+Shift+R', click: () => activeId() && tabs.reload(activeId(), true) },
          { type: 'separator' },
          { label: t('menu.translate'), accelerator: 'CmdOrCtrl+Alt+T', click: () => activeId() && tabs.translate(activeId()) },
          { type: 'separator' },
          { label: t('menu.zoomIn'), accelerator: 'CmdOrCtrl+Plus', click: () => activeId() && tabs.setZoom(activeId(), (tabs.active()?.zoom || 0) + 0.5) },
          { label: t('menu.zoomOut'), accelerator: 'CmdOrCtrl+-', click: () => activeId() && tabs.setZoom(activeId(), (tabs.active()?.zoom || 0) - 0.5) },
          { label: t('menu.zoomReset'), accelerator: 'CmdOrCtrl+0', click: () => activeId() && tabs.setZoom(activeId(), 0) },
          { type: 'separator' },
          { label: t('menu.fullscreen'), accelerator: 'F11', click: () => wm.toggleFullscreen() },
          { label: t('menu.immersive'), accelerator: 'F9', click: () => wm.toggleImmersive() },
          { label: t('menu.sidebar'), accelerator: 'CmdOrCtrl+B', click: () => { state.mutate((s) => { s.ui.sidebarCollapsed = !s.ui.sidebarCollapsed; }); layout.layout(); } },
        ],
      },
      {
        label: t('menu.navigate'),
        submenu: [
          { label: t('menu.back'), accelerator: 'Alt+Left', click: () => activeId() && tabs.back(activeId()) },
          { label: t('menu.forward'), accelerator: 'Alt+Right', click: () => activeId() && tabs.forward(activeId()) },
          { type: 'separator' },
          { label: t('menu.nextTab'), accelerator: 'CmdOrCtrl+Tab', click: () => cycle(1) },
          { label: t('menu.prevTab'), accelerator: 'CmdOrCtrl+Shift+Tab', click: () => cycle(-1) },
          { type: 'separator' },
          { label: t('menu.addressBar'), accelerator: 'CmdOrCtrl+L', click: () => send('focus-address', {}) },
          { label: t('menu.find'), accelerator: 'CmdOrCtrl+F', click: () => send('open-find', {}) },
        ],
      },
      {
        label: t('menu.tools'),
        submenu: [
          { label: t('menu.palette'), accelerator: 'CmdOrCtrl+K', click: () => send('open-palette', {}) },
          { label: t('menu.settings'), accelerator: 'CmdOrCtrl+,', click: () => send('open-settings', {}) },
          { type: 'separator' },
          { label: t('menu.qr'), accelerator: 'CmdOrCtrl+Alt+Q', click: () => send('open-qr', { url: tabs.active()?.url }) },
          { label: t('menu.leaktest'), accelerator: 'CmdOrCtrl+Shift+L', click: () => tabs.create({ url: 'ghost://leaktest/' }) },
          { label: t('menu.devtools'), accelerator: 'CmdOrCtrl+Shift+I', click: () => activeId() && tabs.openDevTools(activeId()) },
          { type: 'separator' },
          { label: t('menu.panic'), accelerator: 'CmdOrCtrl+Shift+X', click: () => deps.ipcPanic() },
        ],
      },
      {
        label: t('menu.help'),
        submenu: [
          { label: t('menu.about'), click: () => send('open-about', {}) },
          { label: t('menu.checkUpdate'), click: () => { deps.updater.check(); send('open-update', {}); } },
          { type: 'separator' },
          {
            label: t('menu.openLogs'),
            click: () => {
              try { shell.showItemInFolder(boot.logFile()); } catch { /* تجاهل */ }
            },
          },
          {
            label: t('menu.safeMode'),
            click: () => {
              app.relaunch({ args: [...process.argv.slice(1), '--safe'] });
              app.exit(0);
            },
          },
        ],
      },
    ];
  }

  function cycle(dir) {
    const order = tabs.order;
    if (order.length < 2) return;
    const i = order.indexOf(tabs.activeTabId);
    const next = order[(i + dir + order.length) % order.length];
    tabs.activate(next);
  }

  function rebuild() {
    const menu = Menu.buildFromTemplate(buildTemplate());
    Menu.setApplicationMenu(menu);
    return menu;
  }

  rebuild();
  return { cycle, rebuild };
}

module.exports = { install };
