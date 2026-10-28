/**
 * يبني سكربت يُحقن في العالم الرئيسي (main world) لكل صفحة داخل التاب،
 * عند بداية المستند (document-start) عبر CDP Page.addScriptToEvaluateOnNewDocument.
 * يعدّل بصمات: الشاشة، navigator، WebGL، WebRTC، وكانفاس (اختياري).
 * كل قسم معزول بـ try/catch حتى لا يكسر أي موقع إذا فشل جزء منه.
 */
function buildInjectScript(identity, opts = {}) {
  const cfg = {
    screen: identity.screen || null,
    platform: identity.platform || 'win',
    cores: identity.hardware ? identity.hardware.cores : null,
    memory: identity.hardware ? identity.hardware.memory : null,
    languages: identity.languages || [],
    webgl: identity.webgl || null,
    webrtc: identity.webrtc || 'no-leak',
    noise: !!identity.fingerprintNoise,
    seed: opts.seed || 1,
    tzFallback: !!opts.tzFallback,
    timezone: identity.timezone || null,
  };
  return `(() => {
  'use strict';
  if (window.__GHOST_INJECTED__) return;
  const C = ${JSON.stringify(cfg)};
  const def = (obj, prop, value) => {
    try { Object.defineProperty(obj, prop, { get: () => value, configurable: true }); } catch (e) {}
  };

  /* بصمة الشاشة */
  try {
    if (C.screen) {
      const s = window.screen;
      def(s, 'width', C.screen.width);
      def(s, 'height', C.screen.height);
      def(s, 'availWidth', C.screen.width);
      def(s, 'availHeight', C.screen.height - 48);
      def(s, 'colorDepth', 24);
      def(s, 'pixelDepth', 24);
      def(window, 'devicePixelRatio', C.screen.dpr);
      def(window, 'outerWidth', C.screen.width);
      def(window, 'outerHeight', C.screen.height);
    }
  } catch (e) {}

  /* navigator: منصة وعتاد ولغات */
  try {
    const plat = C.platform === 'mac' ? 'MacIntel' : C.platform === 'android' ? 'Linux armv8l' : 'Win32';
    def(window.navigator, 'platform', plat);
    if (C.cores) def(window.navigator, 'hardwareConcurrency', C.cores);
    if (C.memory) def(window.navigator, 'deviceMemory', C.memory);
    if (C.languages && C.languages.length) def(window.navigator, 'languages', Object.freeze(C.languages.slice()));
  } catch (e) {}

  /* WebGL: بائع/مُصيّر متسق مع المنصة */
  try {
    if (C.webgl) {
      const V = 0x1F00, R = 0x1F01, UV = 0x9245, UR = 0x9246;
      const wrap = (proto) => {
        if (!proto) return;
        const orig = proto.getParameter;
        proto.getParameter = function (p) {
          if (p === UV) return C.webgl.vendor;
          if (p === UR) return C.webgl.renderer;
          if (p === V) return 'WebKit';
          if (p === R) return 'WebKit WebGL';
          return orig.call(this, p);
        };
      };
      wrap(window.WebGLRenderingContext && WebGLRenderingContext.prototype);
      wrap(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype);
    }
  } catch (e) {}

  /* WebRTC: منع تسريب IP المحلي */
  try {
    if (C.webrtc === 'block') {
      for (const k of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'mozRTCPeerConnection']) {
        try { def(window, k, undefined); } catch (e) {}
      }
    } else if (C.webrtc === 'no-leak') {
      const Orig = window.RTCPeerConnection;
      if (Orig) {
        const Patched = function (config, constraints) {
          config = Object.assign({}, config, { iceTransportPolicy: 'relay' });
          return new Orig(config, constraints);
        };
        Patched.prototype = Orig.prototype;
        Object.setPrototypeOf(Patched, Orig);
        def(window, 'RTCPeerConnection', Patched);
        if (window.webkitRTCPeerConnection) def(window, 'webkitRTCPeerConnection', Patched);
      }
    }
  } catch (e) {}

  /* ضجيج كانفاس اختياري (بذرة ثابتة لكل هوية) */
  try {
    if (C.noise) {
      let st = C.seed >>> 0 || 1;
      const rnd = () => { st ^= st << 13; st ^= st >>> 17; st ^= st << 5; st >>>= 0; return st / 4294967296; };
      const origGet = CanvasRenderingContext2D.prototype.getImageData;
      CanvasRenderingContext2D.prototype.getImageData = function (...a) {
        const d = origGet.apply(this, a);
        for (let i = 0; i < d.data.length; i += 97) d.data[i] = (d.data[i] + (rnd() < 0.5 ? 0 : 1)) & 255;
        return d;
      };
    }
  } catch (e) {}

  /* احتياط: إذا فشل CDP في فرض التوقيت، نوحّد ما تستطيع JS رؤيته */
  try {
    if (C.tzFallback && C.timezone) {
      def(Intl.DateTimeFormat.prototype.resolvedOptions ? Intl.DateTimeFormat.prototype : {}, 'timeZone', C.timezone);
      const origRO = Intl.DateTimeFormat.prototype.resolvedOptions;
      Intl.DateTimeFormat.prototype.resolvedOptions = function (...a) {
        const r = origRO.apply(this, a);
        try { r.timeZone = C.timezone; } catch (e) {}
        return r;
      };
    }
  } catch (e) {}

  try { Object.defineProperty(window, '__GHOST_INJECTED__', { value: 1, configurable: false }); } catch (e) {}
})();`;
}

module.exports = { buildInjectScript };
