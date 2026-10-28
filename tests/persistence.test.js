/**
 * اختبارات استمرارية الجلسة: حفظ كل التابات (شبح/محفوظ/مشترك)
 * وبقاء البيانات بعد إعادة التشغيل — مطلب «الخروج من المتصفح لا يفقد البيانات».
 */
const test = require('node:test');
const assert = require('node:assert');
const { PARTITION, TAB_MODES } = require('../src/common/constants');

test('جلسات الشبح persistent الآن (تبقى بعد إعادة التشغيل)', () => {
  const p = PARTITION.ghost('abc123');
  assert.ok(p.startsWith('persist:'), `الشبح يجب أن يكون persistent: ${p}`);
  assert.strictEqual(p, PARTITION.ghostPersist('abc123'));
});

test('جلسة الشبح لا تتصادم مع جلسة keep لنفس التاب', () => {
  const g = PARTITION.ghost('t1');
  const k = PARTITION.keep('t1');
  assert.notStrictEqual(g, k, 'ghost وkeep يجب أن يكونا منفصلين');
  assert.ok(k.startsWith('persist:ghost-tab-'));
  assert.ok(g.startsWith('persist:ghost-gtab-'));
});

test('كل الأوضاع تنتج أقساماً فريدة لكل تاب', () => {
  const ids = ['a', 'b', 'a'];
  const parts = [
    PARTITION.ghost(ids[0]), PARTITION.ghost(ids[1]),
    PARTITION.keep(ids[0]), PARTITION.keep(ids[1]),
    PARTITION.shared('g1'), PARTITION.shared('g2'),
  ];
  assert.strictEqual(new Set(parts).size, 6, 'كل الأقسام فريدة');
  assert.strictEqual(PARTITION.ghost(ids[0]), PARTITION.ghost(ids[2]), 'نفس التاب = نفس القسم (استمرارية)');
});

test('أقسام shared فريدة لكل قروب', () => {
  assert.notStrictEqual(PARTITION.shared('g1'), PARTITION.shared('g2'));
  assert.ok(PARTITION.shared('g1').includes('g1'));
});

test('أوضاع التباب الثلاثة معرّفة', () => {
  assert.deepStrictEqual(TAB_MODES, { GHOST: 'ghost', KEEP: 'keep', SHARED: 'shared' });
});
