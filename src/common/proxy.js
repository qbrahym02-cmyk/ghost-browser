/**
 * تنظيف إعدادات البروكسي لكل قروب.
 * يقبل الصيغ: socks5://user:pass@host:port · host:port · http://host:port
 * ويفصل بيانات الدخول إلى حقول مستقلة (تُمرر عبر حدث login الخاص بالجلسة).
 */

const PROXY_RE = /^([a-z][a-z0-9+.-]*):\/\/(?:([^:@\/]+):([^@\/]*)@)?([^\/:]+)(?::(\d{2,5}))?(\/.*)?$/i;
const HOSTPORT_RE = /^([^\/:]+):(\d{2,5})$/;

/** الصيغ المقبولة كـ proxyRules في كروميوم. */
const SCHEMES = new Set(['http', 'https', 'socks4', 'socks5']);

/**
 * يحوّل أي إدخال بروكسي إلى { url, username, password, ok, error }.
 * url تكون بصيغة scheme://host:port فقط (بدون بيانات دخول).
 */
function normalizeProxy(input) {
  const raw = String(input == null ? '' : input).trim();
  if (!raw) return { url: '', username: '', password: '', ok: true, error: null };

  const m = raw.match(PROXY_RE);
  if (m) {
    const scheme = m[1].toLowerCase();
    if (!SCHEMES.has(scheme)) {
      return { url: '', username: '', password: '', ok: false, error: `بروتوكول غير مدعوم: ${scheme} (المسموح: http, https, socks4, socks5)` };
    }
    const host = m[4];
    const port = m[5] ? ':' + m[5] : '';
    if (!m[5] && scheme === 'http') {
      return { url: '', username: '', password: '', ok: false, error: 'أضف رقم المنفذ، مثال: http://1.2.3.4:8080' };
    }
    return {
      url: `${scheme}://${host}${port}`,
      username: decodeURIComponent(m[2] || ''),
      password: decodeURIComponent(m[3] || ''),
      ok: true,
      error: null,
    };
  }

  const hp = raw.match(HOSTPORT_RE);
  if (hp) {
    return { url: `socks5://${hp[1]}:${hp[2]}`, username: '', password: '', ok: true, error: null };
  }

  return { url: '', username: '', password: '', ok: false, error: 'صيغة غير مفهومة. أمثلة صحيحة: socks5://1.2.3.4:1080 · http://user:pass@1.2.3.4:8080 · 1.2.3.4:1080' };
}

module.exports = { normalizeProxy };
