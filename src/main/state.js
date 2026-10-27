/**
 * حالة التطبيق المركزية + بثّها لواجهات العرض (شريط/جانبي/طبقة).
 * العملية الرئيسية هي مصدر الحقيقة الوحيد؛ الواجهات ترسل أفعالاً وتستقبل لقطات.
 */
const { LIMITS } = require('../common/constants');

class AppState {
  #timer = null;

  constructor() {
    /** @type {Array<import('electron').WebContents>} */
    this.sinks = [];
    this.state = {
      groups: [],
      tabs: [],
      activeTabId: null,
      activeGroupId: null,
      settings: {},
      ui: {
        sidebarCollapsed: false,
        dir: 'rtl',
        overlayStack: [],
        immersive: false,
        splitTabId: null,
      },
      downloads: [],
      update: { status: 'idle', version: null, progress: null, error: null },
      adblock: { engine: null, lists: [], updating: false, lastUpdate: null, error: null },
      stats: { blockedTotal: 0, blockedSession: 0 },
      sessionBundles: [],
      ready: false,
    };
    this.#timer = null;
    this.seq = 0;
  }

  attach(wc) {
    if (!this.sinks.includes(wc)) this.sinks.push(wc);
    wc.on('destroyed', () => { this.sinks = this.sinks.filter((s) => s !== wc); });
  }

  /** تعديل الحالة ثم البث. */
  mutate(fn) {
    fn(this.state);
    this.emit();
  }

  patch(path, value) {
    const keys = path.split('.');
    let o = this.state;
    for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
    o[keys[keys.length - 1]] = value;
    this.emit();
  }

  emit() {
    if (this.#timer) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.seq++;
      const snapshot = this.state;
      for (const wc of this.sinks) {
        if (!wc.isDestroyed()) wc.send(require('../common/constants').IPC.STATE, snapshot);
      }
    }, LIMITS.STATE_BROADCAST_MS);
  }

  /** إرسال حدث عابر (توست/تركيز/فتح قائمة) لكل الواجهات. */
  sendEvent(type, payload) {
    for (const wc of this.sinks) {
      if (!wc.isDestroyed()) wc.send(require('../common/constants').IPC.EVENT, { type, payload });
    }
  }
}

module.exports = { AppState };
