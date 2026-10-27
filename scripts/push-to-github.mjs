/**
 * نشر المشروع إلى GitHub بأمر واحد — آمن بالتوكن.
 *
 * الاستخدام:
 *   GITHUB_TOKEN=ghp_xxx npm run new-repo
 *   node scripts/push-to-github.mjs --token ghp_xxx [--name repo] [--private] [--tag v1.0.0]
 *
 * الأمان:
 *   - التوكن يُقرأ من البيئة أو الوسيط أو سطر أوامر تفاعلي — لا يُكتب في أي ملف.
 *   - الدفع يتم عبر URL مؤقت بالتوكن ثم يُستبدل بـ remote نظيف بلا توكن.
 *   - .git/config يبقى نظيفاً دائماً.
 */
import { createInterface } from 'node:readline/promises';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { platform } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

/* ------------------------------------------------------------ الوسائط */
const args = process.argv.slice(2);
const argOf = (name) => {
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && args[i + 1]) return args[i + 1];
  const pre = args.find((a) => a.startsWith(`--${name}=`));
  return pre ? pre.split('=').slice(1).join('=') : null;
};
const has = (name) => args.includes(`--${name}`);

async function readToken() {
  if (argOf('token')) return argOf('token');
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (!process.stdin.isTTY) {
    console.error('✗ مرّر التوكن: GITHUB_TOKEN=xxx npm run new-repo  أو  --token xxx');
    process.exit(1);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const token = (await rl.question('GitHub token (لن يُحفظ في أي ملف): ')).trim();
  rl.close();
  return token;
}

const TOKEN = await readToken();
const REPO_NAME = argOf('name') || pkg.name || 'ghost-browser';
const PRIVATE = has('private');
const TAG = argOf('tag') || null;
const HEADERS = {
  'Authorization': `Bearer ${TOKEN}`,
  'Accept': 'application/vnd.github+json',
  'Content-Type': 'application/json',
  'User-Agent': 'ghost-browser-publisher',
};

/* ------------------------------------------------------------ استعلام المستخدم */
const sh = (cmd, params, opts = {}) => execFileSync(cmd, params, { cwd: ROOT, encoding: 'utf8', ...opts });

async function gh(endpoint, init = {}) {
  const res = await fetch(`https://api.github.com${endpoint}`, { headers: HEADERS, ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`✗ GitHub API ${res.status}: ${body.message || res.statusText}`);
    if (body.errors) console.error(JSON.stringify(body.errors, null, 2));
    process.exit(1);
  }
  return body;
}

console.log('→ التحقق من التوكن...');
const user = await gh('/user');
console.log(`✓ الحساب: ${user.login}`);

/* ------------------------------------------------------------ إنشاء المستودع */
console.log(`→ فحص المستودع ${user.login}/${REPO_NAME}...`);
const existsRes = await fetch(`https://api.github.com/repos/${user.login}/${REPO_NAME}`, { headers: HEADERS });
let repo = null;
if (existsRes.ok) {
  repo = await existsRes.json();
  console.log(`✓ المستودع موجود: ${repo.html_url}`);
  if (repo.private !== PRIVATE) {
    await gh(`/repos/${user.login}/${REPO_NAME}`, { method: 'PATCH', body: JSON.stringify({ private: PRIVATE }) });
    console.log(`→ غُيّر الظهور إلى: ${PRIVATE ? 'خاص' : 'عام'}`);
  }
} else {
  console.log('→ إنشاء مستودع جديد...');
  repo = await gh('/user/repos', {
    method: 'POST',
    body: JSON.stringify({
      name: REPO_NAME,
      description: pkg.descriptionEn || pkg.description,
      private: PRIVATE,
      has_issues: true,
      auto_init: false,
    }),
  });
  console.log(`✓ أُنشئ المستودع: ${repo.html_url}`);
}

/* ------------------------------------------------------------ حقن المالك في الإعدادات */
const injectOwner = (file, patterns) => {
  if (!existsSync(path.join(ROOT, file))) return;
  let content = readFileSync(path.join(ROOT, file), 'utf8');
  let changed = false;
  for (const p of patterns) {
    const next = content.replace(p, user.login);
    if (next !== content) changed = true;
    content = next;
  }
  if (changed) {
    writeFileSync(path.join(ROOT, file), content, 'utf8');
    console.log(`→ حُقن المالك (${user.login}) في ${file}`);
  }
};
injectOwner('electron-builder.yml', [/^(\s*owner:\s*)YOUR_GITHUB_USER\b/m]);
injectOwner('package.json', [/YOUR_GITHUB_USER/g]);

/* ------------------------------------------------------------ git init + commit */
if (!existsSync(path.join(ROOT, '.git'))) {
  console.log('→ تهيئة git...');
  sh('git', ['init', '-b', 'main']);
  sh('git', ['add', '-A']);
  sh('git', ['-c', 'user.name=Ghost Browser', '-c', 'user.email=ghost@users.noreply.github.com', 'commit', '-m', 'Ghost Browser v' + pkg.version + ' — متصفح متعدد الهويات: عزل تابات، قروبات بدول وبصمات، مانع إعلانات، سبليت فيو، ترجمة، QR، تحديث تلقائي']);
} else {
  sh('git', ['add', '-A']);
  try {
    sh('git', ['-c', 'user.name=Ghost Browser', '-c', 'user.email=ghost@users.noreply.github.com', 'commit', '-m', 'تحديث: ' + new Date().toISOString().slice(0, 16).replace('T', ' ')]);
  } catch { console.log('→ لا تغييرات جديدة للحفظ'); }
}

/* ------------------------------------------------------------ الدفع (توكن مؤقت في الذاكرة فقط) */
const CLEAN_REMOTE = `https://github.com/${user.login}/${REPO_NAME}.git`;
const TOKEN_REMOTE = `https://x-access-token:${TOKEN}@github.com/${user.login}/${REPO_NAME}.git`;

const remotes = sh('git', ['remote']).trim().split('\n').filter(Boolean);
if (!remotes.includes('origin')) sh('git', ['remote', 'add', 'origin', CLEAN_REMOTE]);
else sh('git', ['remote', 'set-url', 'origin', CLEAN_REMOTE]);

console.log('→ دفع الكود إلى GitHub...');
try {
  sh('git', ['push', TOKEN_REMOTE, 'HEAD:main', '--force-with-lease=main'], { stdio: 'pipe' });
} catch {
  /* أول دفعة لفرع غير موجود عندهم */
  sh('git', ['push', TOKEN_REMOTE, 'HEAD:main'], { stdio: 'pipe' });
}
console.log('✓ دُفع الكود');

/* ------------------------------------------------------------ وسم الإصدار (يُطلق بناء المثبّت تلقائياً) */
if (TAG) {
  console.log(`→ إنشاء الوسم ${TAG}...`);
  try { sh('git', ['tag', '-d', TAG], { stdio: 'pipe' }); } catch { /* لا وسم سابق */ }
  sh('git', ['tag', TAG]);
  sh('git', ['push', TOKEN_REMOTE, `refs/tags/${TAG}`, '--force'], { stdio: 'pipe' });
  console.log(`✓ دُفع الوسم ${TAG} — ستبدأ Actions ببناء المثبّت ونشر Release تلقائياً`);
}

/* ------------------------------------------------------------ تنظيف وملخص */
sh('git', ['remote', 'set-url', 'origin', CLEAN_REMOTE]);
console.log('\n══════════════════════════════════════════════');
console.log(`✓ المستودع: ${repo.html_url}`);
console.log(`✓ الفرع: main${TAG ? ` · الوسم: ${TAG}` : ''}`);
console.log('\nالخطوات التالية:');
if (!TAG) console.log('  1. git tag v' + (pkg.version || '1.0.0') + ' && git push origin v' + (pkg.version || '1.0.0') + '   ← يبني المثبّت وينشر تحديثاً تلقائياً');
console.log(`  ${platform() === 'win32' ? '' : ''}2. حمّل المثبّت من صفحة Releases بعد اكتمال البناء`);
console.log('  3. أي إصدار جديد (وسم v جديد) يصل تلقائياً لكل النسخ المثبّتة — بلا إعادة تحميل');
console.log('\n🔐 نصيحة أمان: استخدم توكن قصير الأمد واحذفه بعد النشر.');
