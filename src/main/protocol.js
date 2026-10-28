/**
 * بروتوكول ghost:// الداخلي — يقدّم الصفحات المضمّنة وواجهة JSON آمنة:
 *   ghost://newtab/        صفحة البداية
 *   ghost://leaktest/      مختبر تسريبات البصمة
 *   ghost://api/state      لقطة حالة عامة (للصفحات الداخلية)
 *   ghost://api/identity?tab=<id>  الهوية المتوقعة لتاب معيّن (للمختبر)
 *   ghost://assets/<path>  ملفات css/js المشتركة
 */
const fs = require('node:fs');
const path = require('node:path');
const { protocol } = require('electron');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

function registerSchemes() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'ghost',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

const BASE_HEADERS = {
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
};

function cspFor(host) {
  if (host === 'leaktest') {
    return "default-src 'self' ghost:; script-src 'self' ghost:; style-src 'self' 'unsafe-inline' ghost:; img-src ghost: data: https:; connect-src ghost: https:; font-src ghost: data:";
  }
  if (host === 'newtab' || host === 'home') {
    return "default-src 'self' ghost:; script-src 'self' ghost:; style-src 'self' 'unsafe-inline' ghost:; img-src ghost: data: https:; connect-src ghost:; font-src ghost: data:";
  }
  return "default-src 'self' ghost:; script-src 'self' ghost:; style-src 'self' 'unsafe-inline' ghost:; img-src ghost: data:; connect-src ghost:; font-src ghost: data:";
}

function serveFile(filePath, host) {
  try {
    const body = fs.readFileSync(filePath);
    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    return new Response(body, { headers: { ...BASE_HEADERS, 'Content-Type': type, 'Content-Security-Policy': cspFor(host) } });
  } catch {
    return new Response('404', { status: 404, headers: BASE_HEADERS });
  }
}

function install({ state, tabs, rootDir }) {
  // rootDir = جذر المشروع
  const pagesDir = path.join(rootDir, 'src', 'renderer', 'pages');
  const rendererDir = path.join(rootDir, 'src', 'renderer');

  protocol.handle('ghost', (request) => {
    let url;
    try { url = new URL(request.url); } catch { return new Response('bad url', { status: 400 }); }
    const host = url.hostname;
    const pathname = decodeURIComponent(url.pathname);

    if (host === 'newtab' || host === 'home') return serveFile(path.join(pagesDir, 'newtab.html'), host);
    if (host === 'leaktest') return serveFile(path.join(pagesDir, 'leaktest.html'), host);

    if (host === 'ui') {
      const rel = pathname === '/' || pathname === '' ? 'index.html' : pathname.replace(/^\/+/, '');
      // استثناء وحيد آمن: وحدات src/common المشتركة (قراءة فقط)
      const base = rel.startsWith('common/') ? path.join(rootDir, 'src')
        : rel.startsWith('pages/') ? rendererDir
        : path.join(rendererDir, 'ui');
      const full = path.resolve(base, rel);
      if (!full.startsWith(base)) return new Response('forbidden', { status: 403, headers: BASE_HEADERS });
      return serveFile(full, 'ui');
    }

    const tm = typeof tabs === 'function' ? tabs() : tabs;
    if (host === 'api') {
      const json = (obj) => new Response(JSON.stringify(obj), {
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      });
      if (pathname === '/state') {
        const s = state.state;
        return json({
          groups: s.groups.map((g) => ({
            id: g.id, name: g.name, emoji: g.emoji, color: g.color, tabMode: g.tabMode,
            shields: g.shields, identity: {
              flag: g.identity.flag, country: g.identity.country, city: g.identity.city,
              timezone: g.identity.timezone, locale: g.identity.locale,
            },
          })),
          activeGroupId: s.activeGroupId,
          settings: { dir: s.settings.dir, language: s.settings.language, theme: s.settings.theme, searchEngine: s.settings.searchEngine },
          stats: s.stats,
        });
      }
      if (pathname === '/identity') {
        const tabId = url.searchParams.get('tab');
        const tab = tm && tm.get(tabId);
        if (!tab) return json({ error: 'tab not found' });
        const i = tab.identity;
        return json({
          timezone: i.timezone, locale: i.locale, languages: i.languages,
          userAgent: i.userAgent, screen: i.screen, webgl: i.webgl,
          hardware: i.hardware, webrtc: i.webrtc, geo: i.geo,
          country: i.country, city: i.city, flag: i.flag, mode: tab.mode, groupId: tab.groupId,
        });
      }
      return new Response('not found', { status: 404 });
    }

    if (host === 'assets') {
      const rel = pathname.replace(/^\/+/, '');
      const full = path.resolve(rendererDir, rel);
      if (!full.startsWith(rendererDir)) return new Response('forbidden', { status: 403, headers: BASE_HEADERS });
      return serveFile(full, 'ui');
    }
    return new Response('not found', { status: 404, headers: BASE_HEADERS });
  });
}

module.exports = { registerSchemes, install };
