const test = require('node:test');
const assert = require('node:assert');
const { normalizeInput } = require('../src/main/tabs');

test('عنوان كامل يمر كما هو', () => {
  assert.strictEqual(normalizeInput('https://x.com/a'), 'https://x.com/a');
  assert.strictEqual(normalizeInput('ghost://newtab/'), 'ghost://newtab/');
});
test('نطاق مجرد يُكمل بـ https', () => {
  assert.strictEqual(normalizeInput('tiktok.com/@me'), 'https://tiktok.com/@me');
  assert.strictEqual(normalizeInput('localhost:5173'), 'https://localhost:5173');
});
test('نص عادي يصبح بحثاً', () => {
  assert.ok(normalizeInput('كيف أصنع متصفح', 'duckduckgo').startsWith('https://duckduckgo.com/?q='));
  assert.ok(normalizeInput('best browser 2026', 'google').includes('google.com/search?q='));
});
test('فارغ = صفحة جديدة', () => {
  assert.strictEqual(normalizeInput('  '), 'ghost://newtab/');
});
