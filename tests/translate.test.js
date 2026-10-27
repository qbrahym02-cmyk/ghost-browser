const test = require('node:test');
const assert = require('node:assert');
const { translateUrl, isTranslated, originalFromTranslated } = require('../src/common/translate');

test('يبني رابط ترجمة صحيح عبر translate.goog', () => {
  const out = translateUrl('https://example.com/page?a=1', 'ar');
  assert.strictEqual(out, 'https://example-com.translate.goog/page?a=1&_x_tr_sl=auto&_x_tr_tl=ar&_x_tr_hl=ar&_x_tr_pto=wapp');
  assert.ok(isTranslated(out));
});

test('النطاقات ذات الشرطات الأصلية تُرمّز بمضاعفة الشرطة', () => {
  const out = translateUrl('https://my-site.example.com/', 'en');
  assert.ok(out.startsWith('https://my--site-example-com.translate.goog/'), out);
});

test('رابط بلا مسار بحث يبقى صالحاً', () => {
  const out = translateUrl('https://example.com', 'ar');
  assert.ok(out.includes('_x_tr_tl=ar'), out);
  assert.ok(out.startsWith('https://example-com.translate.goog'), out);
});

test('إعادة الترجمة على رابط مترجم تعيد الأصل', () => {
  const translated = translateUrl('https://example.com/page?a=1', 'ar');
  const back = translateUrl(translated, 'ar');
  assert.strictEqual(back, 'https://example.com/page?a=1');
});

test('النطاق ذو الشرطة الأصلية يُستخرج سليماً عند العودة للأصل', () => {
  const translated = translateUrl('https://my-site.example.com/x', 'en');
  const back = translateUrl(translated, 'en');
  assert.strictEqual(back, 'https://my-site.example.com/x');
});

test('رابط غير http يعيد null', () => {
  assert.strictEqual(translateUrl('ghost://newtab/', 'ar'), null);
  assert.strictEqual(translateUrl('', 'ar'), null);
  assert.strictEqual(translateUrl(null, 'ar'), null);
});
