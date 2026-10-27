/**
 * يشغّل سيناريو الفحص الآلي الكامل (electron . --smoke).
 * على لينكس بلا شاشة يلفّ التشغيل بـ xvfb-run تلقائياً.
 * النتيجة: exit code 0 = كل الفحوص ناجحة.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { platform } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electronBin = require('electron'); /* مسار ثنائي electron */
const args = ['.', '--smoke'];

let res;
if (platform() === 'linux' && (existsSync('/usr/bin/xvfb-run') || existsSync('/usr/bin/Xvfb'))) {
  if (existsSync('/usr/bin/xvfb-run')) {
    res = spawnSync('xvfb-run', ['-a', electronBin, ...args], { stdio: 'inherit' });
  } else {
    res = spawnSync(electronBin, args, { stdio: 'inherit', env: { ...process.env, DISPLAY: ':99' } });
  }
} else {
  res = spawnSync(electronBin, args, { stdio: 'inherit' });
}

if (res.error) {
  console.error('[smoke] فشل التشغيل:', res.error.message);
  process.exit(1);
}
process.exit(res.status ?? 1);
