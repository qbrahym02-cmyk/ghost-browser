/**
 * أداة لقطات التصميم: تشغّل واجهات Ghost الحقيقية بحالة وهمية
 * في نوافذ Offscreen (بدون شاشة) وتلتقط PNG لكل دور.
 * الاستخدام: npx electron tools/shot.js
 * الناتج: docs/screenshots/{chrome,sidebar,overlay,newtab}.png
 */
const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, protocol } = require('electron');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'screenshots');
const UI = path.join(ROOT, 'src', 'renderer', 'ui');
const MOCK = JSON.parse(fs.readFileSync(path.join(__dirname, 'mock-state.json'), 'utf8'));

app.commandLine.appendSwitch('disable-gpu');
const priv = { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true };
protocol.registerSchemesAsPrivileged([{ scheme: 'shot', privileges: priv }, { scheme: 'ghost', privileges: priv }]);

app.whenReady().then(async () => {
  const handler = (req) => {
    console.log('[shot][req]', req.url);
    const url = new URL(req.url);
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    let base = UI;
    if (rel.startsWith('common/')) base = path.join(ROOT, 'src');
    else if (rel.startsWith('pages/')) base = path.join(ROOT, 'src', 'renderer');
    if (rel === '' ) rel = 'index.html';
    const full = path.resolve(base, rel);
    try {
      const body = fs.readFileSync(full);
      const ext = path.extname(full);
      const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' }[ext] || 'application/octet-stream';
      return new Response(body, { headers: { 'Content-Type': mime, 'Access-Control-Allow-Origin': '*' } });
    } catch { return new Response('404', { status: 404 }); }
  };
  protocol.handle('shot', handler);
  protocol.handle('ghost', handler);

  fs.mkdirSync(OUT, { recursive: true });

  const win = new BrowserWindow({
    show: true,
    frame: false,
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'shot-preload.js'),
      contextIsolation: true,
      sandbox: false,
      additionalArguments: [`--ghost-mock=${JSON.stringify(MOCK)}`],
    },
  });
  win.webContents.on('console-message', (e, level, message) => {
    if (level >= 2) console.log('[console]', message);
  });

  async function shot(name, url, size, extraWait = 700) {
    win.setSize(size[0], size[1]);
    win.webContents.executeJavaScript(`window.__GHOST_SHOT_VIEW__=${JSON.stringify(name)}; window.dispatchEvent(new Event('ghost-shot-view'));`).catch(() => {});
    try { await win.loadURL(url); } catch (e) { console.log('[shot][loadfail]', name, e.message); throw e; }
    await new Promise((r) => setTimeout(r, extraWait));
    let img = await win.webContents.capturePage();
    if (img.isEmpty()) { await new Promise((r) => setTimeout(r, 800)); img = await win.webContents.capturePage(); }
    const file = path.join(OUT, `${name}.png`);
    fs.writeFileSync(file, img.toPNG());
    console.log('✓', file, img.getSize().width + 'x' + img.getSize().height);
  }

  await shot('chrome', 'shot://index.html?view=chrome', [1180, 92]);
  await shot('sidebar', 'shot://index.html?view=sidebar', [268, 760]);
  await shot('overlay', 'shot://index.html?view=overlay&mock-overlay=group', [900, 780]);
  await shot('vpn', 'shot://index.html?view=overlay&mock-overlay=vpn', [700, 700]);
  await shot('settings', 'shot://index.html?view=overlay&mock-overlay=settings', [760, 700]);
  await shot('qr', 'shot://index.html?view=overlay&mock-overlay=qr', [560, 620]);
  await shot('newtab', 'shot://ui/pages/newtab.html', [900, 760]);
  app.exit(0);
});
