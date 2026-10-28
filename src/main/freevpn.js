/**
 * مضخّة VPN المجانية — بروكسيات عامة جاهزة تُحدَّث من مصادر مفتوحة.
 * لا حساب ولا اشتراك: عند أول فتح للوحة VPN نسحب قائمة من المصادر
 * العامة (TheSpeedX/Proxies، monosans،_clarketm) ونختبرها مباشرة عبر
 * session.fetch الكامن في كروميوم — فينجح منها ما ينجح على جهاز المستخدم
 * وشبكته (بخلاف قوائم مجمّدة تموت بسرعة). تُخزَّن في userData/freevpn.json
 * مع تاريخ السحب، وتُحدَّث تلقائياً كل 6 ساعات أو يدوياً.
 */
const fs = require('node:fs');
const path = require('node:path');
const { session } = require('electron');

/** مهلة كلية لعملية السحب والاختبار. */
const FETCH_TIMEOUT_MS = 25000;
/** كم بروكسي نختبر كحد أقصى لكل سحبة. */
const MAX_TEST = 14;
/** مدة صلاحية القائمة قبل السحب التلقائي. */
const REFRESH_AFTER_MS = 6 * 3600 * 1000;

/** المصادر: نصّية خام — ip:port لكل سطر، مع مخطط كل مصدر. */
const SOURCES = [
  { url: 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt', scheme: 'socks5' },
  { url: 'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt', scheme: 'socks5' },
  { url: 'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt', scheme: 'http' },
  { url: 'https://raw.githubusercontent.com/mmpx12/proxy-list/master/socks5.txt', scheme: 'socks5' },
  { url: 'https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt', scheme: 'http' },
  { url: 'https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/socks5.txt', scheme: 'socks5' },
];

/** تحويل سطر إلى { url, scheme, host, port, country }. */
function parseLine(line, scheme) {
  const raw = String(line || '').trim();
  if (!raw || raw.startsWith('#')) return null;
  let m = raw.match(/^(?:socks5|socks4|https|http):\/\/([0-9.]+):(\d{2,5})$/i);
  let host, port;
  if (m) { host = m[1]; port = m[2]; }
  else {
    m = raw.match(/^([0-9.]+):(\d{2,5})(?::([A-Z]{2}))?$/);
    if (!m) return null;
    host = m[1]; port = m[2];
  }
  const cm = raw.match(/:([A-Z]{2})(?:$|[^A-Za-z])/);
  return { url: `${scheme}://${host}:${port}`, scheme, host, port, country: cm ? cm[1] : null };
}

class FreeVpn {
  constructor({ userDataDir, netLog }) {
    this.file = path.join(userDataDir, 'freevpn.json');
    this.netLog = netLog || (() => {});
    this.list = { at: 0, nodes: [], testing: false };
    this.load();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (raw && Array.isArray(raw.nodes)) this.list = { at: raw.at || 0, nodes: raw.nodes, testing: false };
    } catch { /* تجاهل — أول تشغيل */ }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.list, null, 1), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (err) {
      this.netLog('freevpn:save-fail ' + err.message);
    }
  }

  /** هل القائمة قديمة وتحتاج سحباً؟ */
  isStale() {
    return Date.now() - (this.list.at || 0) > REFRESH_AFTER_MS;
  }

  count() { return this.list.nodes.length; }

  /** عقد حسب مقياس البطء (latency أصغر = أسرع). */
  nodes() { return [...this.list.nodes].sort((a, b) => a.latency - b.latency); }

  /**
   * السحب من كل المصادر بالتوازي — عبر جلسة نظام «عارية»
   * (لا بروكسي ولا مانع إعلانات كي لا تتلوث النتائج).
   */
  async fetchList() {
    const ses = session.fromPartition('ghost-freevpn', { cache: 'memory' });
    const found = new Map();
    const grab = async (src) => {
      try {
        const r = await ses.fetch(src.url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const body = await r.text();
        let n = 0;
        for (const line of body.split('\n')) {
          const p = parseLine(line, src.scheme);
          if (!p) continue;
          const key = p.host + ':' + p.port + ':' + p.scheme;
          if (!found.has(key)) { found.set(key, p); n++; }
          if (found.size >= 1200) break;
        }
        this.netLog(`freevpn:source-ok ${src.url} +${n}`);
      } catch (err) {
        this.netLog(`freevpn:source-fail ${src.url} — ${err.message}`);
      }
    };
    await Promise.allSettled(SOURCES.map(grab));
    return [...found.values()].slice(0, 900);
  }

  /**
   * اختبار عينة من العقد: نفتح ipinfo عبر البروكسي نفسه —
   * من يرد خلال المهلة هو عقدة حية نحفظ لها IP/البلد/الزمن.
   */
  async testNodes(candidates) {
    const nodes = [];
    let tested = 0;
    for (const p of candidates) {
      if (tested >= MAX_TEST) break;
      tested++;
      const t0 = Date.now();
      try {
        const ses = session.fromPartition('ghost-freevpn-test', { cache: 'memory' });
        await ses.setProxy({ proxyRules: p.url, proxyBypassRules: '<-loopback>' });
        const r = await ses.fetch('https://ipinfo.io/json', { signal: AbortSignal.timeout(9000) });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const info = await r.json();
        const latency = Date.now() - t0;
        nodes.push({
          url: p.url, scheme: p.scheme, host: p.host, port: p.port,
          country: (info.country || p.country || '??').toUpperCase(),
          city: info.city || '', timezone: info.timezone || '',
          exitIp: info.ip || '',
          latency,
          checkedAt: Date.now(),
          score: 1,
        });
        this.netLog(`freevpn:alive ${p.url} ${info.country} ${latency}ms`);
      } catch {
        this.netLog(`freevpn:dead ${p.url}`);
      }
    }
    return nodes;
  }

  /**
   * التحديث الكامل: سحب (إن لزم) + اختبار عشوائي جديد +
   * دمج الناجح الجديد مع العقد الحية القديمة (إزالة التكرار).
   */
  async refresh({ force = false, nodeLog = () => {} } = {}) {
    if (this.list.testing) return { busy: true, nodes: this.list.nodes };
    this.list.testing = true;
    try {
      let pool = this.list.nodes.filter((n) => !this.isStaleNode(n));
      const fresh = (this.isStale() || force || pool.length < 6) ? await this.fetchList() : null;
      if (fresh && fresh.length) this.list.at = Date.now();
      /* مرشحو الاختبار: الجدد أولاً (غير المختبرين) ثم البحيرة الحالية كترتيب احتياطي */
      const seen = new Set(pool.map((n) => n.host + n.port));
      const newOnes = (fresh || []).filter((p) => !seen.has(p.host + p.port));
      const shuffled = newOnes.length ? newOnes.sort(() => Math.random() - 0.5) : [];
      const retest = pool.slice(0, 4).map((n) => ({ url: n.url, scheme: n.scheme, host: n.host, port: n.port, country: n.country }));
      nodeLog(`سحب ${shuffled.length} مرشح جديد`);
      const alive = await this.testNodes([...shuffled.slice(0, MAX_TEST - 4), ...retest]);
      const merged = new Map();
      for (const n of alive) merged.set(n.host + n.port, n);
      for (const n of pool) if (!merged.has(n.host + n.port)) merged.set(n.host + n.port, { ...n, score: (n.score || 1) + 1 });
      this.list.nodes = [...merged.values()].sort((a, b) => a.latency - b.latency).slice(0, 40);
      this.save();
      return { ok: true, added: alive.length, total: this.list.nodes.length, nodes: this.list.nodes };
    } catch (err) {
      this.netLog('freevpn:refresh-fail ' + err.message);
      return { error: err.message, nodes: this.list.nodes };
    } finally {
      this.list.testing = false;
    }
  }

  isStaleNode(n) {
    return Date.now() - (n.checkedAt || 0) > 48 * 3600 * 1000;
  }
}

module.exports = { FreeVpn };
