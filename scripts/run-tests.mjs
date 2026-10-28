/**
 * مشغّل اختبارات متوافق مع كل إصدارات Node (18→24) وكل الأنظمة.
 * node --test مع مجلد كوسيط تغيّر سلوكه في Node 23+ — لذا نمرر الملفات صراحة.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'tests');
const files = readdirSync(dir).filter((f) => f.endsWith('.test.js')).map((f) => join('tests', f));

if (!files.length) {
  console.error('لا توجد ملفات اختبار في tests/');
  process.exit(1);
}

console.log(`تشغيل ${files.length} ملف اختبار:`, files.map((f) => f.split(/[\\/]/).pop()).join(', '));
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', cwd: root });
process.exit(result.status ?? 1);
