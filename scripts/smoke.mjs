/**
 * يشغّل سيناريو الفحص الآلي الكامل (electron . --smoke).
 * على لينكس بلا شاشة يلفّ التشغيل بـ xvfb-run تلقائياً؛ ولو غاب xauth
 * (xvfb-run يفشل بدونه) يشغّل Xvfb يدوياً بالوضع -ac.
 * النتيجة: exit code 0 = كل الفحوص ناجحة.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { platform } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electronBin = require('electron'); /* مسار ثنائي electron */
const args = ['.', '--smoke'];

function hasXauth() {
  return ['/usr/bin/xauth', '/usr/X11R6/bin/xauth', '/usr/X11/bin/xauth'].some((p) => existsSync(p));
}

let res;
let xvfbProc = null;
if (platform() === 'linux') {
  const useXvfbRun = existsSync('/usr/bin/xvfb-run') && hasXauth();
  if (useXvfbRun) {
    res = spawnSync('xvfb-run', ['-a', electronBin, ...args], { stdio: 'inherit' });
  } else if (existsSync('/usr/bin/Xvfb')) {
    /* Xvfb يدوي بلا xauth — انتظر جاهزيته ثم شغّل الفحص */
    xvfbProc = spawn('Xvfb', [':99', '-screen', '0', '1280x800x24', '-ac'], { stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 1200));
    try {
      res = spawnSync(electronBin, args, { stdio: 'inherit', env: { ...process.env, DISPLAY: ':99' } });
    } finally {
      xvfbProc.kill();
    }
  } else {
    res = spawnSync(electronBin, args, { stdio: 'inherit' });
  }
} else {
  res = spawnSync(electronBin, args, { stdio: 'inherit' });
}

if (xvfbProc && !xvfbProc.killed) { try { xvfbProc.kill('SIGKILL'); } catch { /* تجاهل */ } }

if (res.error) {
  console.error('[smoke] فشل التشغيل:', res.error.message);
  process.exit(1);
}
process.exit(res.status ?? 1);
