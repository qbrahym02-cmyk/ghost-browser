/**
 * القروبات = ملفات شخصية معزولة تماماً (كوكيز + تخزين + بصمة + بروكسي).
 * كل قروب له جلسة persist مستقلة لا ترى أي قروب آخر.
 */
const crypto = require('node:crypto');
const { buildIdentity, applyOverrides } = require('../common/identity');
const { PRESETS } = require('../common/countries');
const { TAB_MODES } = require('../common/constants');
const { normalizeProxy } = require('../common/proxy');

const uid = () => crypto.randomBytes(6).toString('base64url');

const DEFAULT_SHIELDS = { ads: true, trackers: true, annoyances: false };
const DEFAULT_PERMISSIONS = {
  geolocation: 'spoof', notifications: 'deny', camera: 'deny', microphone: 'deny', clipboard: 'allow',
};

class GroupManager {
  constructor({ state, store }) {
    this.state = state;
    this.store = store;
    /** @type {Map<string, object>} */
    this.groups = new Map();
    this.onChange = null; // (group, kind) => void — يربطه index بالجلسات/التابات
  }

  load() {
    const saved = this.store.get('groups', []);
    for (const g of saved) {
      /* ترقية قروبات قديمة بحقول جديدة */
      g.notes = g.notes || '';
      g.proxy = { enabled: false, url: '', bypass: '<-loopback>', username: '', password: '', lastCheck: null, ...(g.proxy || {}) };
      this.groups.set(g.id, g);
    }
    if (this.groups.size === 0) {
      const def = this.create({ name: 'الرئيسي', emoji: '👻', color: '#7C5CFF', presetId: 'us-ny', silent: true });
      const second = this.create({ name: 'عمل', emoji: '💼', color: '#37E2D5', presetId: 'gb-ldn', silent: true });
      void second;
    }
    this.state.mutate((s) => {
      s.groups = this.list();
      s.activeGroupId = this.store.get('activeGroupId', null) || this.list()[0].id;
    });
  }

  list() { return [...this.groups.values()]; }
  get(id) { return this.groups.get(id) || null; }
  active() { return this.get(this.state.state.activeGroupId) || this.list()[0]; }

  create({ name, emoji, color, presetId, tabMode, silent } = {}) {
    const id = uid();
    const identity = buildIdentity({ presetId: presetId || 'us-ny', seedString: id });
    const group = {
      id,
      name: name || `قروب ${this.groups.size + 1}`,
      emoji: emoji || '',
      color: color || this.#nextColor(),
      createdAt: Date.now(),
      tabMode: tabMode || TAB_MODES.GHOST,
      notes: '',
      shields: { ...DEFAULT_SHIELDS },
      permissions: { ...DEFAULT_PERMISSIONS },
      proxy: { enabled: false, url: '', bypass: '<-loopback>', username: '', password: '', lastCheck: null },
      identity,
      stats: { blocked: 0, tabsOpened: 0 },
    };
    this.groups.set(id, group);
    this.#persist();
    this.state.mutate((s) => { s.groups = this.list(); });
    if (!silent && this.onChange) this.onChange(group, 'created');
    return group;
  }

  update(id, patch) {
    const g = this.get(id);
    if (!g) return null;
    if (patch.identity) {
      g.identity = applyOverrides(g.identity, patch.identity);
      delete patch.identity;
    }
    if (patch.shields) g.shields = { ...g.shields, ...patch.shields };
    if (patch.permissions) g.permissions = { ...g.permissions, ...patch.permissions };
    if (patch.proxy) {
      /* لصق ذكي: socks5://user:pass@host:port يُفصل تلقائياً إلى بيانات دخول + عنوان نظيف */
      const p = { ...g.proxy, ...patch.proxy };
      if (patch.proxy.url != null) {
        const n = normalizeProxy(patch.proxy.url);
        if (n.ok && n.url) {
          p.url = n.url;
          if (n.username) p.username = n.username;
          if (n.password) p.password = n.password;
        } else {
          p.url = String(patch.proxy.url || '').trim();
        }
        p.lastCheck = null;
      }
      g.proxy = p;
      delete patch.proxy;
    }
    Object.assign(g, patch);
    this.#persist();
    this.state.mutate((s) => { s.groups = this.list(); });
    if (this.onChange) this.onChange(g, 'updated');
    return g;
  }

  /** هوية جديدة عشوائية لنفس القروب (تدوير البصمة). */
  reroll(id, presetId) {
    const g = this.get(id);
    if (!g) return null;
    g.identity = buildIdentity({ presetId: presetId || g.identity.presetId, seedString: id + ':' + Date.now() });
    this.#persist();
    this.state.mutate((s) => { s.groups = this.list(); });
    if (this.onChange) this.onChange(g, 'rerolled');
    return g;
  }

  remove(id) {
    const g = this.get(id);
    if (!g) return false;
    this.groups.delete(id);
    if (this.state.state.activeGroupId === id) {
      const next = this.list()[0];
      this.state.patch('activeGroupId', next ? next.id : null);
    }
    this.#persist();
    this.state.mutate((s) => { s.groups = this.list(); });
    if (this.onChange) this.onChange(g, 'deleted');
    return true;
  }

  activate(id) {
    if (!this.get(id)) return;
    this.state.patch('activeGroupId', id);
    this.store.set('activeGroupId', id);
  }

  presetOf(id) { return PRESETS[id] || null; }

  #nextColor() {
    const colors = ['#7C5CFF', '#37E2D5', '#FF5C7A', '#FFB454', '#5CE49B', '#5AA7FF', '#FF7AD9', '#B085FF'];
    return colors[this.groups.size % colors.length];
  }

  #persist() {
    this.store.set('groups', this.list());
  }

  /** تصدير قروب (بدون الكوكيز — تُصدَّر عبر إجراء منفصل يتطلب تأكيداً). */
  exportJSON(id) {
    const g = this.get(id);
    if (!g) return null;
    return JSON.stringify({ format: 'ghost-group/1', exportedAt: new Date().toISOString(), group: g }, null, 2);
  }

  importJSON(text) {
    try {
      const data = JSON.parse(text);
      if (data.format !== 'ghost-group/1' || !data.group) throw new Error('صيغة غير معروفة');
      const g = data.group;
      g.id = uid();
      g.name = (g.name || 'مستورد') + ' (نسخة)';
      this.groups.set(g.id, g);
      this.#persist();
      this.state.mutate((s) => { s.groups = this.list(); });
      return g;
    } catch (err) {
      return { error: err.message };
    }
  }
}

module.exports = { GroupManager, uid, DEFAULT_SHIELDS, DEFAULT_PERMISSIONS };
