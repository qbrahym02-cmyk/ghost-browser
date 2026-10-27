/**
 * مختبر التسريبات: يقيس ما تكشفه الصفحة فعلاً ويقارنه بالهوية المتوقعة.
 * كل فحص يُعرض بحالة: مطابق / مختلف / معلومة.
 */
const bridge = window.ghostBridge;
const $ = (id) => document.getElementById(id);

function row(title, detected, expected, status, note) {
  const el = document.createElement('div');
  el.className = 'check ' + status;
  el.innerHTML = `
    <div class="mark">${status === 'ok' ? '✓' : status === 'warn' ? '⚠' : '•'}</div>
    <div class="body">
      <div class="title">${title}</div>
      <div class="vals mono"><span>المُكتشف: ${escapeHtml(detected)}</span>${expected != null ? `<span>المتوقع: ${escapeHtml(expected)}</span>` : ''}</div>
      ${note ? `<div class="note">${note}</div>` : ''}
    </div>`;
  return el;
}
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

async function detect() {
  const out = {};
  out.tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  out.locale = navigator.language;
  out.languages = (navigator.languages || []).join(', ');
  out.ua = navigator.userAgent;
  out.platform = navigator.platform;
  out.cores = navigator.hardwareConcurrency;
  out.memory = navigator.deviceMemory;
  out.screen = `${screen.width}×${screen.height}@${devicePixelRatio}x`;
  out.webgl = (() => {
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl');
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    } catch { return 'غير متاح'; }
  })();
  out.canvas = await (async () => {
    try {
      const c = document.createElement('canvas');
      c.width = 120; c.height = 30;
      const g = c.getContext('2d');
      g.textBaseline = 'top';
      g.font = '14px Arial';
      g.fillStyle = '#7c5cff';
      g.fillRect(0, 0, 120, 30);
      g.fillStyle = '#fff';
      g.fillText('Ghost 👻', 4, 6);
      let hash = 0;
      const s = c.toDataURL();
      for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0;
      return hash.toString(16);
    } catch { return '—'; }
  })();
  out.webrtc = await (async () => {
    try {
      if (!window.RTCPeerConnection) return 'معطّل تماماً';
      const ips = new Set();
      const pc = new RTCPeerConnection({ iceServers: [] });
      pc.createDataChannel('');
      const sdp = await new Promise((res) => { pc.onicecandidate = (e) => { if (!e.candidate) res(pc.localDescription?.sdp || ''); }; pc.createOffer().then((o) => pc.setLocalDescription(o)); setTimeout(() => res(pc.localDescription?.sdp || ''), 1200); });
      for (const m of sdp.matchAll(/candidate:.+? ([\d.]+) \d+ typ (host|srflx)/g)) ips.add(`${m[2]}:${m[1]}`);
      pc.close();
      return ips.size ? [...ips].join(', ') : 'لا تسريب محلي ✓';
    } catch { return 'غير متاح'; }
  })();
  out.ip = await (async () => {
    try {
      const r = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(6000) });
      return (await r.json()).ip;
    } catch { return 'تعذّر جلب الـ IP'; }
  })();
  return out;
}

async function boot() {
  const tabId = await bridge.getTabId();
  const expected = await (await fetch(`ghost://api/identity?tab=${encodeURIComponent(tabId)}`)).json();
  const d = await detect();
  const box = $('results');

  const same = (a, b) => String(a) === String(b);
  box.append(row('المنطقة الزمنية', d.tz, expected.timezone, same(d.tz, expected.timezone) ? 'ok' : 'warn'));
  box.append(row('لغة المتصفح', d.locale, expected.locale, same(d.locale, expected.locale) ? 'ok' : 'warn'));
  box.append(row('قائمة اللغات', d.languages, (expected.languages || []).join(', '), same(d.languages, (expected.languages || []).join(', ')) ? 'ok' : 'warn'));
  box.append(row('User-Agent', d.ua.slice(0, 90) + '…', expected.userAgent ? expected.userAgent.slice(0, 90) + '…' : '—', same(d.ua, expected.userAgent) ? 'ok' : 'warn'));
  box.append(row('المنصة (navigator.platform)', d.platform, expected.platform === 'win' ? 'Win32' : expected.platform === 'mac' ? 'MacIntel' : 'Linux armv8l', same(d.platform, expected.platform === 'win' ? 'Win32' : expected.platform === 'mac' ? 'MacIntel' : 'Linux armv8l') ? 'ok' : 'warn'));
  box.append(row('الشاشة', d.screen, `${expected.screen?.width}×${expected.screen?.height}@${expected.screen?.dpr}x`, same(d.screen, `${expected.screen?.width}×${expected.screen?.height}@${expected.screen?.dpr}x`) ? 'ok' : 'warn'));
  box.append(row('الأنوية/الذاكرة', `${d.cores} cores / ${d.memory}GB`, `${expected.hardware?.cores} cores / ${expected.hardware?.memory}GB`, d.cores === expected.hardware?.cores ? 'ok' : 'warn'));
  box.append(row('WebGL renderer', d.webgl, expected.webgl?.renderer, same(d.webgl, expected.webgl?.renderer) ? 'ok' : 'warn'));
  box.append(row('WebRTC (عناوين محلية)', d.webrtc, expected.webrtc === 'block' ? 'معطّل تماماً' : 'لا تسريب محلي ✓', d.webrtc.includes('host:') || d.webrtc.includes('srflx:') ? 'warn' : 'ok', 'أي عنوان host/srflx يعني تسريب IP المحلي'));
  box.append(row('بصمة Canvas', d.canvas, null, 'info', 'ثابتة لكل هوية إذا فعّلت ضجيج البصمة، وإلا فهي بصمة جهازك'));
  box.append(row('عنوان IP العام', d.ip, expected.geo ? `${expected.flag} ${expected.country} (يتطلب بروكسي)` : '—', 'info', 'التوقيت واللغة لا يغيّران الـ IP — فعّل بروكسي القروب لتغيير دولته'));

  $('foot').textContent = `الهوية: ${expected.flag} ${expected.country} — ${expected.city} · وضع التاب: ${expected.mode}`;
}

boot();
