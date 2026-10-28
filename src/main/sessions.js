/**
 * إدارة الجلسات (sessions/partitions):
 *  - ghost  : جلسة معزولة لكل تاب — تُحفظ على القرص وتُستعاد بعد إعادة التشغيل
 *            (محبوب المستخدمين: «حتى لو خرجت التابات لا تفقد بياناتها»)،
 *            وتبقى قابلة للمسح الفوري عند إغلاق التاب الشبح.)
 *  - keep   : جلسة محفوظة لكل تاب على القرص (لا تُمسح أبداً عند الإغلاق).
 *  - shared : جلسة القروب المشتركة.
 * تطبّق على كل جلسة: UA + Accept-Language، ترويسات client-hints وDNT/GPC،
 * البروكسي، صلاحيات المواقع، ومانع الإعلانات.
 */
const fs = require('node:fs');
const path = require('node:path');
const { session } = require('electron');
const { PARTITION, TAB_MODES } = require('../common/constants');

class SessionManager {
  constructor({ state, adblock, partitionsDir }) {
    this.state = state;
    this.adblock = adblock;
    this.partitionsDir = partitionsDir;
    /** partition → {ses, groupId, mode} */
    this.registry = new Map();
  }

  partitionFor(tab, group) {
    if (tab.mode === TAB_MODES.SHARED) return PARTITION.shared(group.id);
    if (tab.mode === TAB_MODES.KEEP) return PARTITION.keep(tab.id);
    /* جلسة الشبح الآن تُحفظ أيضاً — استمرارية الجلسة عبر إعادة التشغيل */
    return PARTITION.ghostPersist(tab.id);
  }

  /** إنشاء/استرجاع جلسة تاب وتكوينها بالكامل. */
  acquire(tab, group) {
    const partition = this.partitionFor(tab, group);
    if (this.registry.has(partition)) return this.registry.get(partition).ses;
    const ses = session.fromPartition(partition, { cache: 'default' });
    this.registry.set(partition, { ses, groupId: group.id, mode: tab.mode });
    this.configure(ses, group);
    return ses;
  }

  get(partition) {
    const rec = this.registry.get(partition);
    return rec ? rec.ses : null;
  }

  forGroup(groupId) {
    return [...this.registry.entries()]
      .filter(([, r]) => r.groupId === groupId)
      .map(([p, r]) => ({ partition: p, ses: r.ses, mode: r.mode }));
  }

  /** تكوين جلسة وفق هوية القروب ودروعه وبروكسيه. */
  configure(ses, group) {
    const id = group.identity;
    try { ses.setUserAgent(id.userAgent, (id.languages || []).join(',')); } catch { /* تجاهل */ }

    /* ترويسات: client-hints متسقة + DNT/GPC + لغة */
    try {
      ses.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, cb) => {
        const h = { ...details.requestHeaders };
        const st = this.state.state.settings;
        const ch = id.clientHints || {};
        const isDoc = details.resourceType === 'mainFrame' || details.resourceType === 'subFrame';
        for (const [k, v] of Object.entries(ch)) {
          if (typeof v === 'string' && v && (k !== 'sec-ch-ua-full-version-list' || isDoc)) {
            // نحذف أي نسخة مختلفة من الترويسة ثم نضع قيمتنا
            for (const key of Object.keys(h)) if (key.toLowerCase() === k) delete h[key];
            h[k] = v;
          }
        }
        const langs = (id.languages || []).map((l, i) => (i === 0 ? l : `${l};q=${(0.9 - i * 0.1).toFixed(1)}`)).join(',');
        for (const key of Object.keys(h)) if (key.toLowerCase() === 'accept-language') delete h[key];
        h['Accept-Language'] = langs;
        if (st.dnt) h['DNT'] = '1';
        if (st.gpc) h['Sec-GPC'] = '1';
        cb({ requestHeaders: h });
      });
    } catch (err) {
      console.warn('[ghost][sessions] فشل حقن الترويسات:', err.message);
    }

    /* الصلاحيات: افتراضياً رفض كل شيء عدا ما يسمح به القروب */
    try {
      ses.setPermissionRequestHandler((wc, permission, cb, details) => {
        const perms = group.permissions || {};
        const origin = (() => { try { return new URL(details?.origin || details?.requestingUrl || '').hostname; } catch { return ''; } })();
        void origin;
        switch (permission) {
          case 'geolocation':
            return cb(perms.geolocation === 'spoof' || perms.geolocation === 'allow');
          case 'notifications':
            return cb(perms.notifications === 'allow');
          case 'media':
            return cb(perms.camera === 'allow' || perms.microphone === 'allow');
          case 'clipboard-sanitized-write':
            return cb(perms.clipboard !== 'deny');
          case 'fullscreen':
            return cb(true);
          case 'pointerLock':
            return cb(true);
          case 'midiSysex':
          case 'hid':
          case 'serial':
          case 'usb':
          case 'bluetooth':
            return cb(false);
          default:
            return cb(false);
        }
      });
      ses.setPermissionCheckHandler((wc, permission) => {
        const perms = group.permissions || {};
        if (permission === 'geolocation') return perms.geolocation !== 'deny';
        if (permission === 'notifications') return perms.notifications === 'allow';
        if (permission === 'media') return perms.camera === 'allow' || perms.microphone === 'allow';
        return false;
      });
    } catch (err) {
      console.warn('[ghost][sessions] فشل إعداد الصلاحيات:', err.message);
    }

    /* البروكسي — الطريقة الحقيقية لتغيير دولة عنوان IP */
    try {
      if (group.proxy && group.proxy.enabled && group.proxy.url) {
        ses.setProxy({ proxyRules: group.proxy.url, proxyBypassRules: group.proxy.bypass || '<-loopback>' });
      } else {
        ses.setProxy({ mode: 'system' });
      }
    } catch (err) {
      console.warn('[ghost][sessions] فشل إعداد البروكسي:', err.message);
    }

    /* مانع الإعلانات */
    const globalOn = this.state.state.settings.shieldsGlobal !== false;
    this.adblock.syncSession(ses, globalOn ? group.shields : { ads: false, trackers: false, annoyances: false });
  }

  /** إعادة تكوين كل جلسات قروب بعد تعديل هويته/درعه/بروكسيه. */
  reconfigureGroup(group) {
    for (const { ses } of this.forGroup(group.id)) this.configure(ses, group);
  }

  /** تحرير جلسة تاب شبح: مسح كامل لكل أثر فور إغلاق التاب. */
  async releaseGhost(partition) {
    const rec = this.registry.get(partition);
    if (!rec || rec.mode !== TAB_MODES.GHOST) return;
    this.registry.delete(partition);
    try {
      await rec.ses.clearStorageData();
      await rec.ses.clearCache();
    } catch { /* تجاهل */ }
  }

  /** حذف ملفات الجلسات المحفوظة لتابات لم تعد موجودة (تنظيف القرص). */
  pruneOrphanPartitions(livePartitions) {
    try {
      const dir = this.partitionsDir;
      if (!fs.existsSync(dir)) return [];
      const keep = new Set(livePartitions.map((p) => p.replace(/^persist:/, '')));
      const removed = [];
      for (const name of fs.readdirSync(dir)) {
        if (!name.startsWith('ghost-tab-') && !name.startsWith('ghost-gtab-')) continue;
        if (keep.has(name)) continue;
        // نتخلص من جلسات التابات المحفوظة القديمة فقط بعد 30 يوماً
        const st = fs.statSync(path.join(dir, name));
        if (Date.now() - st.mtimeMs < 30 * 24 * 3600 * 1000) continue;
        fs.rmSync(path.join(dir, name), { recursive: true, force: true });
        removed.push(name);
      }
      return removed;
    } catch (err) {
      console.warn('[ghost][sessions] فشل التنظيف:', err.message);
      return [];
    }
  }

  /** مسح كامل بيانات قروب (كوكيز، تخزين، كاش). */
  async wipeGroup(groupId) {
    const parts = this.forGroup(groupId).map((r) => r.partition);
    const shared = PARTITION.shared(groupId);
    const all = [...new Set([...parts, shared])];
    for (const p of all) {
      try {
        const ses = session.fromPartition(p);
        await ses.clearStorageData();
        await ses.clearCache();
      } catch { /* تجاهل */ }
    }
    return all.length;
  }
}

module.exports = { SessionManager };
