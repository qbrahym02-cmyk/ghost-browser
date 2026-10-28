const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { Store } = require('../src/main/store');

test('حفظ واسترجاع وذرية الكتابة', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-')), 's.json');
  const s = new Store(f, { a: 1, nested: { b: 2 } });
  s.set('nested.b', 5);
  s.set('list', [1, 2]);
  s.saveNow();
  const s2 = new Store(f, { a: 1, nested: { b: 2 } });
  assert.strictEqual(s2.get('nested.b'), 5);
  assert.deepStrictEqual(s2.get('list'), [1, 2]);
  assert.strictEqual(s2.get('missing', 'd'), 'd');
});
