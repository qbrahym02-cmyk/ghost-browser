/**
 * حارس الإقلاع (Boot Guard) — يمنع «الانهيار الصامت» الذي يبدو للمستخدم
 * وكأن الضغط على الأيقونة لا يفعل شيئاً:
 *   1) سجلّ إقلاع حيّ (logs/main.log) داخل مجلد بيانات التطبيق.
 *   2) أي استثناء مبكر → رسالة خطأ واضحة + خروج نظيف (لا عملية خفية بلا نافذة).
 *   3) علامة boot.pending: إذا لم يكتمل الإقلاع السابق → التشغيل التالي
 *      يعرض خيار الوضع الآمن (تعطيل GPU + جلسة نظيفة) قبل المتابعة.
 *   4) --safe من سطر الأوامر أو من قائمة «مساعدة» يفعّل الوضع الآمن يدوياً.
 * الحارس لا يعتمد على أي وحدة داخلية أخرى كي يُستدعى بأول سطر ممكن.
 */
const fs = require('node:fs');
const path = require('node:path');
const { app, dialog } = require('electron');

const state = {
  ok: false,          /* الإقلاع اكتمل — أخطاء التشغيل من الآن تُسجَّل فقط */
  safe: false,        /* وضع آمن: تعطيل GPU + جلسة نظيفة */
  prevFailed: false,  /* لقطة: الإقلاع السابق لم يكتمل */
  dead: false,        /* فشلنا بالفعل — لا تكرر رسائل الخطأ */
  logFileMemo: null,
};

function userDataDir() {
  try {
    return app.getPath('userData');
  } catch {
    return process.env.APPDATA ? path.join(process.env.APPDATA, 'Ghost Browser') : '.';
  }
}

function logsDir() { return path.join(userDataDir(), 'logs'); }
function logFile() {
  if (!state.logFileMemo) state.logFileMemo = path.join(logsDir(), 'main.log');
  return state.logFileMemo;
}
function pendingFile() { return path.join(logsDir(), 'boot.pending'); }

/** تسجيل أفضل جهد — لا يرمي أبداً. */
function log(line) {
  try {
    fs.mkdirSync(logsDir(), { recursive: true });
    fs.appendFileSync(logFile(), `[${new Date().toISOString()}] ${line}\n`);
  } catch { /* تجاهل */ }
}

function step(name) { log(name); }

function serialize(err) {
  if (err == null) return 'unknown';
  if (typeof err === 'string') return err;
  return err.stack || `${err.name || 'Error'}: ${err.message || err}`;
}

function isSafe() { return state.safe; }

/* --------------------------------------------------------------- */

/** يُستدعى بأول سطر في العملية الرئيسية — قبل أي عمل آخر. */
function install() {
  state.safe = process.argv.includes('--safe');
  if (state.safe) {
    /* يجب قبل ready: تعطيل تسريع الرسوميات (الحل الأشهر لعدم ظهور النافذة) */
    app.commandLine.appendSwitch('disable-gpu');
  }

  /* لقطة قبل التسليح: هل بقيت علامة إقلاع سابق غير مكتمل؟ */
  try { state.prevFailed = fs.existsSync(pendingFile()); } catch { state.prevFailed = false; }

  log('----------------------------------------------------------------');
  try {
    log(`boot:begin v=${app.getVersion()} electron=${process.versions.electron} chrome=${process.versions.chrome} node=${process.versions.node} safe=${state.safe}`);
    log(`boot:os=${process.platform} ${process.arch} ${typeof process.getSystemVersion === 'function' ? process.getSystemVersion() : ''}`);
  } catch { /* تجاهل */ }

  process.on('uncaughtException', (err) => {
    log(`FATAL uncaughtException: ${serialize(err)}`);
    if (state.ok || state.dead) return; /* التطبيق يعمل — سجّل فقط */
    showErrorBox(serialize(err));
    app.exit(1);
  });

  process.on('unhandledRejection', (err) => {
    log(`unhandledRejection: ${serialize(err)}`);
    if (state.ok || state.dead) return;
    showErrorBox(serialize(err));
    app.exit(1);
  });

  app.on('quit', (e, code) => log(`app:quit code=${code}`));
}

/** بعد اكتساب قفل النسخة الواحدة: علّم أن إقلاعاً بدأ (تُحذف عند النجاح). */
function arm() {
  try {
    fs.mkdirSync(logsDir(), { recursive: true });
    fs.writeFileSync(pendingFile(), new Date().toISOString());
    log('boot:armed');
  } catch { /* تجاهل */ }
}

/** الإقلاع نجح والنافذة قابلة للظهور — احذف العلامة وحوّل السياسة إلى لوج فقط. */
function bootOk() {
  state.ok = true;
  try { fs.rmSync(pendingFile(), { force: true }); } catch { /* تجاهل */ }
  log('boot:ok');
}

function rearm() {
  try { fs.writeFileSync(pendingFile(), new Date().toISOString()); } catch { /* تجاهل */ }
}

function showErrorBox(text) {
  state.dead = true;
  try {
    dialog.showErrorBox(
      'Ghost Browser — خطأ في التشغيل / Startup error',
      [
        'تعذّر تشغيل Ghost Browser وخرج التطبيق.',
        'Ghost Browser failed to start and exited.\n',
        `${text}\n`,
        `السجل الكامل / Full log:\n${logFile()}\n`,
        'محاولات الإصلاح السريعة / Quick fixes:',
        '• زر يمين على الأيقونة ← «تشغيل كمسؤول» — Right-click → Run as administrator',
        '• قائمة «مساعدة» ← «إعادة تشغيل بالوضع الآمن» — Help → Restart in Safe Mode',
      ].join('\n'),
    );
  } catch { /* تجاهل */ }
}

/** نقطة فشل منظمة: سجّل، سلّم للوضع الآمن في التشغيل القادم، اعرض، اخروج. */
function fail(err) {
  log(`FATAL boot-failure: ${serialize(err)}`);
  rearm();
  showErrorBox(serialize(err));
  app.exit(1);
}

/**
 * بعد whenReady: إذا لم يكتمل الإقلاع السابق (بقيت boot.pending) → اسأل
 * المستخدم عن الوضع الآمن قبل المتابعة. يتخطى في --smoke و CI.
 * يعيد: false إذا طُلب الخروج/إعادة التشغيل (يجب أن يتوقف الإقلاع فوراً).
 */
function checkPreviousFailure() {
  if (!state.prevFailed || state.safe) return true;
  if (process.argv.includes('--smoke') || process.env.CI) { log('boot:skip-safety-dialog (smoke/CI)'); return true; }

  const buttons = ['تشغيل بالوضع الآمن — Safe Mode', 'تشغيل عادي — Normal', 'إلغاء — Cancel'];
  let choice = 1;
  try {
    choice = dialog.showMessageBoxSync({
      type: 'warning',
      buttons,
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      title: 'Ghost Browser',
      message: 'يبدو أن التشغيل السابق لم يكتمل — لم تظهر نافذة المتصفح.',
      detail: [
        'The previous launch did not complete (the window never appeared).',
        '',
        'الوضع الآمن يعطّل تسريع الرسوميات (GPU) ويبدأ بجلسة نظيفة — يحل معظم حالات عدم ظهور النافذة والشاشة السوداء.',
        'Safe Mode disables GPU acceleration and starts with a clean session.',
      ].join('\n'),
    });
  } catch (e) {
    log(`boot:safety-dialog-error ${serialize(e)}`);
    return true; /* لو فشل الحوار نكمل عادي بدل التعطيل */
  }

  log(`boot:prev-failed-choice=${buttons[choice]}`);
  if (choice === 0) {
    app.relaunch({ args: [...process.argv.slice(1), '--safe'] });
    app.exit(0);
    return false;
  }
  if (choice === 2) {
    app.exit(0);
    return false;
  }
  return true;
}

module.exports = { install, arm, bootOk, fail, step, log, isSafe, checkPreviousFailure, logFile, logsDir };
