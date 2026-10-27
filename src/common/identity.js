/**
 * بناء هوية متصفح كاملة ومتسقة من بصمة دولة:
 * سلسلة UA، ترويسات client-hints، شاشة، WebGL، عتاد — كلها متناسقة
 * حتى لا تقع المواقع على تناقضات بين البصمات.
 */
const { PRESETS, PLATFORMS, SCREENS } = require('./countries');

/** مولّد أرقام عشوائية ببذرة ثابتة (نفس البذرة = نفس الهوية دائماً). */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function pick(rng, arr) { return arr[Math.floor(rng() * arr.length) % arr.length]; }

/** رقم chrome الحالي للعملية — نستخدمه كي تبقى الـ UA حقيقية وقابلة للتصديق. */
function chromeVersion() {
  const v = (typeof process !== 'undefined' && process.versions && process.versions.chrome) || '142.0.0.0';
  return v.split('.').slice(0, 2).join('.');
}
function chromeMajor() { return Number(chromeVersion().split('.')[0]); }

/** يبني سلسلة User-Agent متسقة مع المنصة والجوال. */
function buildUserAgent(platformKey, mobile, version = chromeVersion()) {
  const p = PLATFORMS[platformKey] || PLATFORMS.win;
  if (p.mobile || mobile) {
    return `Mozilla/5.0 (${p.uaPlatform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0 Mobile Safari/537.36`;
  }
  return `Mozilla/5.0 (${p.uaPlatform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0 Safari/537.36`;
}

/** قيم ترويسات sec-ch-ua المطابقة للـ UA (نُحقنها في onBeforeSendHeaders). */
function buildClientHints(platformKey, version = chromeVersion()) {
  const p = PLATFORMS[platformKey] || PLATFORMS.win;
  const major = Number(version.split('.')[0]);
  const brands = [
    { brand: 'Not(A:Brand', version: '99.0.0.0' },
    { brand: 'Chromium', version: `${major}.0.0.0` },
    { brand: 'Google Chrome', version: `${major}.0.0.0` },
  ];
  const fmt = (list) => list.map((b) => `"${b.brand}";v="${b.version.split('.')[0]}"`).join(', ');
  const fmtFull = (list) => list.map((b) => `"${b.brand}";v="${b.version}"`).join(', ');
  return {
    'sec-ch-ua': fmt(brands),
    'sec-ch-ua-full-version-list': fmtFull(brands),
    'sec-ch-ua-mobile': p.mobile ? '?1' : '?0',
    'sec-ch-ua-platform': `"${p.chPlatform}"`,
    'sec-ch-ua-platform-version': `"${p.chPlatformVersion}"`,
    'sec-ch-ua-arch': `"${p.architecture}"`,
    'sec-ch-ua-bitness': `"${p.bitness}"`,
    'sec-ch-ua-wow64': p.wow64 ? '?1' : '?0',
    'sec-ch-ua-model': p.model ? `"${p.model}"` : '""',
    userAgentMetadata: {
      brands: brands.map((b) => ({ brand: b.brand, version: b.version.split('.')[0] })),
      fullVersionList: brands,
      platform: p.chPlatform,
      platformVersion: p.chPlatformVersion,
      architecture: p.architecture,
      bitness: p.bitness,
      mobile: !!p.mobile,
      model: p.model || '',
      wow64: !!p.wow64,
    },
  };
}

/** أزواج WebGL vendor/renderer واقعية حسب المنصة. */
const WEBGL_SETS = {
  win: [
    ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
    ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
    ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) UHD Graphics 730 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
    ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ],
  mac: [
    ['Google Inc. (Apple)', 'ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)'],
    ['Google Inc. (Apple)', 'ANGLE (Apple, Apple M2, OpenGL 4.1)'],
  ],
  android: [
    ['Google Inc. (Qualcomm)', 'ANGLE (Qualcomm, Adreno (TM) 730, OpenGL ES 3.2)'],
    ['Google Inc. (ARM)', 'ANGLE (ARM, Mali-G710, OpenGL ES 3.2)'],
  ],
};

const HARDWARE = { cores: [4, 8, 8, 12, 16], memory: [8, 8, 16, 16, 32] };

/**
 * هوية كاملة لقروب/تاب.
 * @param {object} opts {presetId, seed, jitterGeo, mobile}
 */
function buildIdentity(opts = {}) {
  const preset = PRESETS[opts.presetId] || PRESETS['us-ny'];
  const rng = mulberry32(opts.seed != null ? opts.seed : seedFromString(preset.id + ':' + (opts.seedString || 'default')));
  const platformKey = opts.mobile ? 'android' : (opts.platform || preset.ua);
  const version = chromeVersion();
  const [vendor, renderer] = pick(rng, WEBGL_SETS[platformKey] || WEBGL_SETS.win);
  const [sw, sh, dpr] = platformKey === 'android' ? pick(rng, SCREENS.slice(6)) : pick(rng, SCREENS.slice(0, 6));
  const jitter = opts.jitterGeo === false ? 0 : (rng() - 0.5) * 0.08; // ±~4 كم
  const jitter2 = opts.jitterGeo === false ? 0 : (rng() - 0.5) * 0.08;
  return {
    presetId: preset.id,
    timezone: preset.tz,
    locale: preset.locale,
    languages: preset.languages.slice(),
    geo: preset.geo ? { lat: +(preset.geo[0] + jitter).toFixed(5), lon: +(preset.geo[1] + jitter2).toFixed(5), accuracy: 25 + Math.floor(rng() * 60) } : null,
    platform: platformKey,
    mobile: platformKey === 'android',
    chromeVersion: version,
    userAgent: buildUserAgent(platformKey, platformKey === 'android', version),
    clientHints: buildClientHints(platformKey, version),
    screen: { width: sw, height: sh, dpr },
    webgl: { vendor, renderer },
    hardware: { cores: pick(rng, HARDWARE.cores), memory: pick(rng, HARDWARE.memory) },
    webrtc: 'no-leak',
    fingerprintNoise: false,
    flag: preset.flag,
    country: preset.country,
    city: preset.city,
  };
}

/** يدمج تعديلات المستخدم فوق هوية مبنيّة مع الحفاظ على الاتساق. */
function applyOverrides(identity, overrides = {}) {
  const next = { ...identity, ...overrides };
  if (overrides.platform && overrides.platform !== identity.platform) {
    next.userAgent = buildUserAgent(next.platform, next.platform === 'android', next.chromeVersion);
    next.clientHints = buildClientHints(next.platform, next.chromeVersion);
    next.mobile = next.platform === 'android';
  }
  if (overrides.chromeVersion && overrides.chromeVersion !== identity.chromeVersion) {
    next.userAgent = buildUserAgent(next.platform, next.mobile, next.chromeVersion);
    next.clientHints = buildClientHints(next.platform, next.chromeVersion);
  }
  return next;
}

module.exports = {
  mulberry32, seedFromString, pick,
  chromeVersion, chromeMajor,
  buildUserAgent, buildClientHints, buildIdentity, applyOverrides,
  WEBGL_SETS, HARDWARE,
};
