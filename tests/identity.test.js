const test = require('node:test');
const assert = require('node:assert');
const { buildIdentity, applyOverrides, buildUserAgent, buildClientHints, chromeVersion } = require('../src/common/identity');
const { PRESETS } = require('../src/common/countries');

test('هوية متكاملة لكل بصمة دولة', () => {
  for (const id of Object.keys(PRESETS)) {
    const i = buildIdentity({ presetId: id, seedString: 'x' });
    assert.ok(i.userAgent.includes('Chrome/'), id);
    assert.ok(i.timezone, id);
    assert.ok(i.languages.length, id);
    assert.ok(i.screen.width > 0, id);
    assert.ok(i.webgl.vendor, id);
    assert.strictEqual(i.clientHints['sec-ch-ua-mobile'], i.platform === 'android' ? '?1' : '?0', id);
  }
});

test('نفس البذرة = نفس الهوية (ثبات البصمة داخل القروب)', () => {
  const a = buildIdentity({ presetId: 'us-ny', seedString: 'g1' });
  const b = buildIdentity({ presetId: 'us-ny', seedString: 'g1' });
  const c = buildIdentity({ presetId: 'us-ny', seedString: 'g2' });
  assert.deepStrictEqual(a.screen, b.screen);
  assert.deepStrictEqual(a.webgl, b.webgl);
  assert.deepStrictEqual(a.geo, b.geo);
  void c;
});

test('تغيير المنصة يعيد بناء UA وclient-hints باتساق', () => {
  const i = buildIdentity({ presetId: 'gb-ldn', seedString: 's' });
  const next = applyOverrides(i, { platform: 'android' });
  assert.ok(next.userAgent.includes('Mobile'), next.userAgent);
  assert.strictEqual(next.clientHints['sec-ch-ua-platform'], '"Android"');
  assert.strictEqual(next.clientHints['sec-ch-ua-mobile'], '?1');
});

test('client-hints تحمل نفس رقم كروم في UA', () => {
  const v = chromeVersion();
  const major = Number(v.split('.')[0]);
  const ch = buildClientHints('win', v);
  assert.ok(ch['sec-ch-ua'].includes(`"Google Chrome";v="${major}"`));
  assert.ok(buildUserAgent('win', false, v).includes(`Chrome/${v}.0.0`));
});

test('الإحداثيات داخل حدود المدينة (±0.05)', () => {
  const i = buildIdentity({ presetId: 'id-jkt', seedString: 'j' });
  const base = PRESETS['id-jkt'].geo;
  assert.ok(Math.abs(i.geo.lat - base[0]) < 0.05);
  assert.ok(Math.abs(i.geo.lon - base[1]) < 0.05);
});
