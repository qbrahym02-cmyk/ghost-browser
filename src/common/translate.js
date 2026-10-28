/**
 * ترجمة الصفحات عبر وسيط Google Translate (translate.goog).
 * منطق نقي قابل للاختبار بدون Electron.
 *   translateUrl(url, 'ar')  → رابط مترجم
 *   translateUrl(translated, 'ar') → يعيدك للأصل (تبديل ذكي)
 */

/** هل الرابط مجرد مترجم عبر translate.goog؟ */
function isTranslated(url) {
  try {
    return new URL(url).hostname.endsWith('.translate.goog');
  } catch {
    return false;
  }
}

/** يستخرج نطاق الموقع الأصلي من رابط translate.goog إن أمكن. */
function originalFromTranslated(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/\.translate\.goog$/, '');
    // الشرطة المزدوجة كانت نقطة أصلية، والفردية كانت شرطة أصلية
    const originalHost = host.replace(/--/g, '\u0000').replace(/-/g, '.').replace(/\u0000/g, '-');
    let search = u.search || '';
    search = search.replace(/([?&])_x_tr_[a-z]+=[^&]*/g, '');
    search = search.replace(/^[?&]+/, '');
    return `https://${originalHost}${u.pathname || '/'}${search ? '?' + search : ''}`;
  } catch {
    return null;
  }
}

/**
 * يبني رابط النسخة المترجمة، أو يعيد الأصل إذا كان الرابط مترجماً أصلاً.
 * @param {string} url الرابط الحالي
 * @param {string} target لغة الهدف مثل ar/en
 * @returns {string|null} الرابط الجديد أو null عند الفشل
 */
function translateUrl(url, target = 'ar') {
  if (!/^https?:\/\//i.test(url || '')) return null;
  if (isTranslated(url)) return originalFromTranslated(url);

  try {
    const u = new URL(url);
    // encode: الشرطة الأصلية → شرطتان، النقطة → شرطة
    const host = u.hostname.replace(/-/g, '--').replace(/\./g, '-');
    const sep = u.search ? '&' : '?';
    return `https://${host}.translate.goog${u.pathname || '/'}${u.search || ''}${sep}_x_tr_sl=auto&_x_tr_tl=${encodeURIComponent(target)}&_x_tr_hl=${encodeURIComponent(target)}&_x_tr_pto=wapp`;
  } catch {
    return null;
  }
}

module.exports = { translateUrl, isTranslated, originalFromTranslated };
