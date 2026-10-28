const test = require('node:test');
const assert = require('node:assert');
const { normalizeProxy } = require('../src/common/proxy');

test('بروكسي socks5 كامل مع بيانات الدخول يُفصل تلقائياً', () => {
  const r = normalizeProxy('socks5://user:pass@1.2.3.4:1080');
  assert.deepStrictEqual(
    { url: r.url, username: r.username, password: r.password, ok: r.ok },
    { url: 'socks5://1.2.3.4:1080', username: 'user', password: 'pass', ok: true },
  );
});

test('بروكسي بدون بيانات دخول يمر نظيفاً', () => {
  const r = normalizeProxy('http://1.2.3.4:8080');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.url, 'http://1.2.3.4:8080');
  assert.strictEqual(r.username, '');
});

test('مضيف:منفذ مجرد يفترض socks5', () => {
  const r = normalizeProxy('1.2.3.4:1080');
  assert.strictEqual(r.url, 'socks5://1.2.3.4:1080');
});

test('بروتوكول غير مدعوم يرفض', () => {
  const r = normalizeProxy('ssh://1.2.3.4:22');
  assert.strictEqual(r.ok, false);
  assert.ok(r.error);
});

test('http بدون منفذ يرفض (كروميوم يحتاجه)', () => {
  const r = normalizeProxy('http://proxy.local');
  assert.strictEqual(r.ok, false);
});

test('فارغ يعيد نتيجة فارغة صالحة', () => {
  const r = normalizeProxy('');
  assert.deepStrictEqual(r, { url: '', username: '', password: '', ok: true, error: null });
});

test('https وsocks4 مقبولان', () => {
  assert.strictEqual(normalizeProxy('https://p.example.com:443').ok, true);
  assert.strictEqual(normalizeProxy('socks4://1.2.3.4:1080').ok, true);
});
