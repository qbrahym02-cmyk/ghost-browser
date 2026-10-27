const test = require('node:test');
const assert = require('node:assert');
/** المكتبة مضمّنة كما هي (UMD/CJS) — نفس النسخة التي تحمّلها الواجهة عبر فرع window. */
const qrcode = require('../src/renderer/ui/lib/vendor/qrcode');

test('المكتبة تولّد رمز QR صالحاً لرابط', () => {
  const qr = qrcode(0, 'M');
  qr.addData('https://tiktok.com/@ghost', 'Byte');
  qr.make();
  const count = qr.getModuleCount();
  assert.ok(count >= 21 && count <= 45, `modules=${count}`);
});

test('createSvgTag يعيد SVG متدرجاً (scalable)', () => {
  const qr = qrcode(0, 'M');
  qr.addData('https://example.com/very/long/path?q=1&x=2', 'Byte');
  qr.make();
  const svg = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('viewBox'));
  assert.ok(!svg.includes('width="120px"'), 'scalable يعني بلا أبعاد ثابتة بالبكسل');
  assert.ok(svg.includes('rect width="100%"'), 'خلفية بيضاء للرمز');
});

test('نفس النص = نفس الشبكة (حتمية)', () => {
  const mk = () => {
    const qr = qrcode(0, 'M');
    qr.addData('https://example.com/', 'Byte');
    qr.make();
    return qr;
  };
  const a = mk();
  const b = mk();
  assert.strictEqual(a.getModuleCount(), b.getModuleCount());
  assert.strictEqual(a.isDark(10, 10), b.isDark(10, 10));
});

test('نصوص عربية تُرمّز بلا انفجار (UTF-8)', () => {
  const qr = qrcode(0, 'M');
  qr.addData('مرحبا بالعالم 👻', 'Byte');
  qr.make();
  assert.ok(qr.getModuleCount() > 0);
});
