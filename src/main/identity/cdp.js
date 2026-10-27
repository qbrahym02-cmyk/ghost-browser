/**
 * تطبيق الهوية على مستوى المتصفح عبر Chrome DevTools Protocol:
 * التوقيت، اللغة، الموقع الجغرافي، UA + client-hints metadata،
 * وسكربت البصمة عند بداية كل مستند.
 * إذا تعذّر الإرفاق (مثلاً أثناء فتح DevTools) نستخدم مسارات بديلة أقل عمقاً.
 */
const { buildInjectScript } = require('./inject');

const PLATFORM_LABEL = { win: 'Win32', mac: 'MacIntel', android: 'Linux armv8l' };

class IdentityApplier {
  constructor() {
    /** wc.id → {identity, ok, degraded} */
    this.applied = new Map();
  }

  attach(wc) {
    try {
      if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
      return true;
    } catch {
      return false;
    }
  }

  detach(wc) {
    try { if (wc.debugger.isAttached()) wc.debugger.detach(); } catch { /* تجاهل */ }
  }

  /** يربط أحداث devtools حتى لا يتعارض الإرفاق مع أدوات المطور. */
  watch(wc, identityProvider) {
    wc.on('devtools-opened', () => {
      this.detach(wc);
      const rec = this.applied.get(wc.id);
      if (rec) rec.degraded = true;
    });
    wc.on('devtools-closed', () => {
      const provider = identityProvider();
      if (provider) this.apply(wc, provider);
    });
    wc.on('render-process-gone', () => {
      const provider = identityProvider();
      if (provider) setTimeout(() => { if (!wc.isDestroyed()) this.apply(wc, provider); }, 150);
    });
    wc.on('destroyed', () => this.applied.delete(wc.id));
  }

  /**
   * @param {import('electron').WebContents} wc
   * @param {object} identity هوية كاملة من common/identity
   */
  async apply(wc, identity) {
    const rec = { identity, ok: false, degraded: false };
    this.applied.set(wc.id, rec);
    if (!this.attach(wc)) {
      rec.degraded = true;
      return rec;
    }
    const send = (method, params) => wc.debugger.sendCommand(method, params).catch((err) => {
      rec.degraded = true;
      return { error: err.message };
    });

    if (identity.timezone) await send('Emulation.setTimezoneOverride', { timezoneId: identity.timezone });
    if (identity.locale) await send('Emulation.setLocaleOverride', { locale: identity.locale });
    if (identity.geo) {
      await send('Emulation.setGeolocationOverride', {
        latitude: identity.geo.lat, longitude: identity.geo.lon, accuracy: identity.geo.accuracy,
      });
    } else {
      await send('Emulation.clearGeolocationOverride');
    }
    const meta = identity.clientHints ? identity.clientHints.userAgentMetadata : undefined;
    await send('Emulation.setUserAgentOverride', {
      userAgent: identity.userAgent,
      acceptLanguage: (identity.languages || []).join(','),
      platform: PLATFORM_LABEL[identity.platform] || 'Win32',
      userAgentMetadata: meta,
    });
    const res = await send('Page.addScriptToEvaluateOnNewDocument', {
      source: buildInjectScript(identity),
      runImmediately: true,
    });
    if (res && res.identifier) rec.scriptId = res.identifier;
    rec.ok = !rec.degraded;
    return rec;
  }

  /** فحص سريع بعد التحميل: هل السكربت يعمل فعلاً داخل الصفحة؟ */
  async verify(wc) {
    try {
      const v = await wc.executeJavaScript('window.__GHOST_INJECTED__ === 1 ? 1 : 0', true);
      return v === 1;
    } catch {
      return false;
    }
  }

  /** إعادة حقن عبر executeJavaScript (مسار بديل عندما يكون DevTools مفتوحاً). */
  async applyDegraded(wc, identity) {
    try {
      await wc.executeJavaScript(buildInjectScript(identity, { tzFallback: true }), true);
      return true;
    } catch {
      return false;
    }
  }

  status(wcId) {
    return this.applied.get(wcId) || null;
  }
}

module.exports = { IdentityApplier, PLATFORM_LABEL };
