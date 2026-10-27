/**
 * النافذة والتخطيط: نافذة frameless واحدة تحتوي أربع طبقات عرض:
 *   [الشريط الجانبي] [شريط التابات+العنوان] [منطقة الصفحة] [طبقة العلويات الشفافة]
 * التخطيط يُحسب يدوياً ويدعم RTL (الشريط الجانبي يمين) ووضع الغمر وملء الشاشة HTML.
 */
const path = require('node:path');
const { BrowserWindow, WebContentsView, screen } = require('electron');
const { CHROME_H, SIDEBAR_W, SIDEBAR_W_COLLAPSED } = require('../common/constants');

class WindowManager {
  constructor({ state, store }) {
    this.state = state;
    this.store = store;
    this.win = null;
    this.chrome = null;
    this.sidebar = null;
    this.overlay = null;
    this.tabViews = new Set();
    this.activeView = null;
    this.secondaryView = null; /* التاب الثاني في العرض المقسوم */
    this.htmlFullscreen = false;
    this.immersive = false;
    this.immersivePeek = false;
    this.#revealTimer = null;
  }

  #revealTimer = null;

  create() {
    const bounds = this.store.get('windowBounds', null);
    const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
    const w = Math.min(bounds?.width || 1320, sw - 40);
    const h = Math.min(bounds?.height || 880, sh - 40);

    this.win = new BrowserWindow({
      width: w,
      height: h,
      minWidth: 900,
      minHeight: 560,
      show: false,
      frame: false,
      backgroundColor: '#0B0A12',
      icon: path.join(__dirname, '..', '..', 'resources', 'icon.png'),
      title: 'Ghost Browser',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });

    const uiPrefs = (view) => ({
      preload: path.join(__dirname, '..', 'preload', 'ui-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
      additionalArguments: [`--ghost-view=${view}`],
    });

    this.sidebar = new WebContentsView({ webPreferences: uiPrefs('sidebar') });
    this.chrome = new WebContentsView({ webPreferences: uiPrefs('chrome') });
    this.overlay = new WebContentsView({ webPreferences: uiPrefs('overlay') });
    this.overlay.setBackgroundColor('#00000000');

    const cv = this.win.contentView;
    cv.addChildView(this.sidebar);
    cv.addChildView(this.chrome);
    cv.addChildView(this.overlay);
    this.overlay.setVisible(false);

    const base = 'ghost://ui/index.html';
    this.sidebar.webContents.loadURL(`${base}?view=sidebar`);
    this.chrome.webContents.loadURL(`${base}?view=chrome`);
    this.overlay.webContents.loadURL(`${base}?view=overlay`);

    this.state.attach(this.sidebar.webContents);
    this.state.attach(this.chrome.webContents);
    this.state.attach(this.overlay.webContents);

    this.win.once('ready-to-show', () => this.win.show());
    this.win.on('resize', () => this.layout());
    this.win.on('maximize', () => this.layout());
    this.win.on('unmaximize', () => this.layout());
    this.win.on('enter-full-screen', () => { this.layout(); });
    this.win.on('leave-full-screen', () => { this.layout(); });
    this.win.on('close', () => {
      const b = this.win.getBounds();
      this.store.set('windowBounds', { width: b.width, height: b.height, x: b.x, y: b.y });
    });
    this.win.on('closed', () => { this.win = null; });

    this.layout();
    return this.win;
  }

  /* ------------------------------------------------------------ التابات */
  addTabView(view) {
    const idx = this.win.contentView.children.indexOf(this.overlay);
    this.win.contentView.addChildView(view, idx >= 0 ? idx : undefined);
    this.tabViews.add(view);
    view.setVisible(false);
    this.layout();
  }

  removeTabView(view) {
    this.tabViews.delete(view);
    if (this.activeView === view) this.activeView = null;
    if (this.secondaryView === view) this.clearSplitView();
    try { this.win.contentView.removeChildView(view); } catch { /* تجاهل */ }
    this.layout();
  }

  activateTab(view) {
    this.activeView = view;
    for (const v of this.tabViews) v.setVisible(v === view || v === this.secondaryView);
    this.layout();
  }

  /* ------------------------------------------------------------ العرض المقسوم */
  /** يثبّت تاباً ثانياً إلى جانب التاب النشط. */
  setSplitView(view) {
    this.secondaryView = view;
    view.setVisible(true);
    this.layout();
  }

  clearSplitView() {
    const v = this.secondaryView;
    this.secondaryView = null;
    if (v) {
      try { v.setVisible(false); } catch { /* تجاهل */ }
    }
    this.layout();
  }

  isSplitActive() { return !!this.secondaryView; }

  /* ------------------------------------------------------------ الطبقة العلوية */
  setOverlayVisible(visible) {
    this.overlay.setVisible(visible);
    this.layout();
    if (visible) this.overlay.webContents.focus();
    else this.refocusContent();
  }

  refocusContent() {
    if (this.activeView && this.activeView.webContents && !this.activeView.webContents.isDestroyed()) {
      this.activeView.webContents.focus();
    } else if (this.chrome && !this.chrome.webContents.isDestroyed()) {
      this.chrome.webContents.focus();
    }
  }

  focusChrome() {
    if (this.chrome && !this.chrome.webContents.isDestroyed()) this.chrome.webContents.focus();
  }

  /* ------------------------------------------------------------ التخطيط */
  layout() {
    if (!this.win || this.win.isDestroyed()) return;
    const [W, H] = this.win.getContentSize();
    const ui = this.state.state.ui;
    const rtl = (ui.dir || 'rtl') === 'rtl';
    const sw = ui.sidebarCollapsed ? SIDEBAR_W_COLLAPSED : SIDEBAR_W;
    const chromeH = this.htmlFullscreen || this.immersiveWithoutPeek() ? 0 : CHROME_H;
    const sidebarW = this.htmlFullscreen ? 0 : sw;

    const sideX = rtl ? W - sidebarW : 0;
    const chromeX = rtl ? 0 : sidebarW;
    const chromeW = W - sidebarW;

    this.sidebar.setBounds({ x: sideX, y: 0, width: sidebarW, height: H });
    this.sidebar.setVisible(!this.htmlFullscreen && sidebarW > 0);
    this.chrome.setBounds({ x: chromeX, y: 0, width: chromeW, height: chromeH });
    this.chrome.setVisible(chromeH > 0);

    const contentX = rtl ? 0 : sidebarW;
    const contentY = chromeH;
    const contentW = W - sidebarW;
    const contentH = H - chromeH;

    /* في العرض المقسوم: النشط في نصف، والثانوي في النصف الآخر */
    const splitOn = !!this.secondaryView && !this.htmlFullscreen && !this.immersiveWithoutPeek();
    const halfW = Math.floor(contentW / 2) - 1;
    const firstX = rtl ? contentX + halfW + 2 : contentX;
    const secondX = rtl ? contentX : contentX + halfW + 2;

    for (const v of this.tabViews) {
      if (v === this.activeView && this.htmlFullscreen) {
        v.setBounds({ x: 0, y: 0, width: W, height: H });
      } else if (splitOn) {
        if (v === this.activeView || v === this.secondaryView) {
          const x = v === this.secondaryView ? secondX : firstX;
          v.setBounds({ x, y: contentY, width: halfW, height: contentH });
        } else {
          v.setBounds({ x: contentX, y: contentY, width: contentW, height: contentH });
        }
      } else {
        v.setBounds({ x: contentX, y: contentY, width: contentW, height: contentH });
      }
    }
    this.overlay.setBounds({ x: 0, y: 0, width: W, height: H });
  }

  immersiveWithoutPeek() {
    return this.immersive && !this.immersivePeek;
  }

  setImmersive(on) {
    this.immersive = on;
    this.state.patch('ui.immersive', on);
    if (on) this.#startRevealWatcher();
    else this.#stopRevealWatcher();
    this.layout();
  }

  toggleImmersive() { this.setImmersive(!this.immersive); }

  /** في وضع الغمر: يظهر الشريط مؤقتاً عند لمس أعلى النافذة. */
  #startRevealWatcher() {
    if (this.#revealTimer) return;
    this.#revealTimer = setInterval(() => {
      if (!this.win || this.win.isDestroyed()) return this.#stopRevealWatcher();
      const p = screen.getCursorScreenPoint();
      const b = this.win.getBounds();
      const inside = p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
      const atTop = inside && p.y - b.y <= 6;
      if (atTop !== this.immersivePeek) {
        this.immersivePeek = atTop;
        this.layout();
      }
    }, 200);
  }

  #stopRevealWatcher() {
    if (this.#revealTimer) clearInterval(this.#revealTimer);
    this.#revealTimer = null;
    this.immersivePeek = false;
  }

  setHtmlFullscreen(on) {
    this.htmlFullscreen = on;
    this.layout();
  }

  /* ------------------------------------------------------------ نافذة */
  minimize() { this.win?.minimize(); }
  toggleMaximize() { this.win?.isMaximized() ? this.win.unmaximize() : this.win.maximize(); }
  close() { this.win?.close(); }
  toggleFullscreen() { this.win?.setFullScreen(!this.win.isFullScreen()); }
  isMaximized() { return !!this.win?.isMaximized(); }
}

module.exports = { WindowManager };
