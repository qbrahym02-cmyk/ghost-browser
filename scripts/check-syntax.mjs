/** فحص صيغة كل ملفات JS/MJS في المشروع بدون تشغيل Electron. */
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let fail = 0, ok = 0;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (['node_modules', 'release', 'dist', '.git'].includes(name)) continue;
      walk(p);
    } else if (name.endsWith('.js') || name.endsWith('.mjs')) {
      try {
        execFileSync(process.execPath, ['--check', p], { stdio: 'pipe' });
        ok++;
      } catch (e) {
        fail++;
        console.error(`✗ ${p}\n${e.stderr?.toString().slice(0, 800)}`);
      }
    }
  }
}
for (const d of ['src', 'scripts', 'tests']) {
  try { walk(join(root, d)); } catch { /* مجلد غير موجود */ }
}
console.log(`\nفحص الصيغة: ${ok} سليم، ${fail} معطوب`);
process.exit(fail ? 1 : 0);
