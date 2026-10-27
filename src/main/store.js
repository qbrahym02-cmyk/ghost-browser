/**
 * مخزن JSON بسيط وذري (atomic) بدون اعتماديات.
 * يكتب في ملف مؤقت ثم يعيد التسمية — لا فقدان بيانات عند الانهيار.
 */
const fs = require('node:fs');
const path = require('node:path');

class Store {
  #timer = null;

  constructor(filePath, defaults = {}) {
    this.file = filePath;
    this.defaults = defaults;
    this.data = this.#load();
    this.#timer = null;
  }

  #load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      return { ...structuredClone(this.defaults), ...parsed };
    } catch {
      return structuredClone(this.defaults);
    }
  }

  get(key, fallback) {
    const v = key.split('.').reduce((o, k) => (o == null ? o : o[k]), this.data);
    return v === undefined ? fallback : v;
  }

  set(key, value) {
    const keys = key.split('.');
    let o = this.data;
    for (let i = 0; i < keys.length - 1; i++) {
      if (typeof o[keys[i]] !== 'object' || o[keys[i]] === null) o[keys[i]] = {};
      o = o[keys[i]];
    }
    o[keys[keys.length - 1]] = value;
    this.scheduleSave();
    return value;
  }

  update(obj) {
    Object.assign(this.data, obj);
    this.scheduleSave();
  }

  replace(obj) {
    this.data = obj;
    this.scheduleSave();
  }

  all() { return this.data; }

  scheduleSave() {
    if (this.#timer) return;
    this.#timer = setTimeout(() => { this.#timer = null; this.saveNow(); }, 120);
  }

  saveNow() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('[ghost][store] فشل الحفظ:', this.file, err.message);
    }
  }
}

module.exports = { Store };
