/**
 * طبقة العلويات: خلفية معتمة + لوحات (palette, settings, group, shields,
 * downloads, bookmarks, cookies, bundles, identity, tabmenu, about, group-new, qr).
 * تُرسم فوق كل شيء لأنها View مستقلة بحجم النافذة كاملة.
 */
import { h, svg, ICONS, clear, el } from '../lib/dom.js';
import { t } from '../lib/i18n.js';
import { store, action, activeTab, groupOf, timeAgo } from '../lib/api.js';
import { qrSvg } from '../lib/qr.js';
import countriesData from '../../common/countries.json' with { type: 'json' };
const COUNTRIES = countriesData.COUNTRIES;

/* ------------------------------------------------------------ عناصر صغيرة */
const row = (label, control, hint) => h('label', { class: 'row' },
  h('span', { class: 'rowlabel' }, label, hint ? h('small', { class: 'hint', text: hint }) : null),
  control);

const toggle = (checked, onChange) => {
  const input = h('input', { type: 'checkbox', class: 'switch' });
  input.checked = !!checked;
  input.addEventListener('change', () => onChange(input.checked));
  return input;
};

const select = (options, value, onChange) => {
  const s = h('select', { class: 'field' });
  for (const [v, label] of options) s.append(h('option', { value: v, selected: v === value ? '' : null, text: label }));
  s.value = value;
  s.addEventListener('change', () => onChange(s.value));
  return s;
};

const text = (value, onChange, placeholder, type = 'text') => {
  const i = h('input', { class: 'field', type, placeholder: placeholder || '', value: value || '' });
  i.addEventListener('change', () => onChange(i.value));
  return i;
};

const btn = (label, onclick, cls = 'btn') => h('button', { class: cls, onclick }, label);

function panel(kind, title, ...children) {
  const box = el('div', 'panel ' + kind);
  box.append(h('div', { class: 'panel-head' }, h('h2', { text: title }), h('button', { class: 'iconbtn', onclick: () => action('ui:overlay-pop') }, svg(ICONS.x, 14))));
  const body = el('div', 'panel-body');
  body.append(...children);
  box.append(body);
  return box;
}

/* ------------------------------------------------------------ اللوحات */
function palettePanel(state) {
  const box = el('div', 'panel palette');
  const input = h('input', { class: 'palette-input', placeholder: t('palette.placeholder'), type: 'text' });
  const list = el('div', 'palette-list');
  box.append(input, list);

  const commands = () => {
    const cmds = [
      { label: t('palette.newTab'), run: () => action('tab:new', {}) },
      { label: t('palette.newGhost'), run: () => action('tab:new', { mode: 'ghost', rotate: true }) },
      { label: t('palette.closeTab'), run: () => action('tab:close', { id: state.activeTabId }) },
      { label: t('palette.translate'), run: () => action('tab:translate', { id: state.activeTabId }) },
      { label: t('palette.split'), run: () => action('tab:split', { id: state.activeTabId }) },
      { label: t('palette.qr'), run: () => action('ui:overlay-push', { kind: 'qr', params: { url: (state.tabs || []).find((x) => x.id === state.activeTabId)?.url } }) },
      { label: t('palette.newGroup'), run: () => action('ui:overlay-push', { kind: 'group-new' }) },
      { label: t('overlay.settings'), run: () => action('ui:overlay-push', { kind: 'settings' }) },
      { label: t('overlay.downloads'), run: () => action('ui:overlay-push', { kind: 'downloads' }) },
      { label: t('overlay.bookmarks'), run: () => action('ui:overlay-push', { kind: 'bookmarks' }) },
      { label: t('overlay.bundles'), run: () => action('ui:overlay-push', { kind: 'bundles' }) },
      { label: t('palette.leaktest'), run: () => action('open:leaktest', {}) },
      { label: t('palette.panic'), run: () => action('panic', {}) },
      { label: t('palette.immersive'), run: () => action('ui:immersive', {}) },
      { label: t('palette.checkUpdate'), run: () => action('ui:overlay-push', { kind: 'update' }) },
      { label: `🛡 ${t('vpn.title')}`, run: () => action('ui:overlay-push', { kind: 'vpn' }) },
      { label: t('palette.adblockUpdate'), run: () => action('adblock:update-lists', {}) },
    ];
    for (const g of state.groups || []) {
      cmds.push({ label: `↔ ${g.emoji || ''} ${g.name}`, run: () => { action('group:activate', { id: g.id }); const tb = (state.tabs || []).find((x) => x.groupId === g.id); if (tb) action('tab:activate', { id: tb.id }); else action('tab:new', { groupId: g.id }); } });
      cmds.push({ label: `⚙ ${g.name}: ${t('overlay.group')}`, run: () => action('ui:overlay-push', { kind: 'group', params: { groupId: g.id } }) });
      cmds.push({ label: `🌐 ${g.name}: ${t('group.proxyCheck')}`, run: () => action('group:proxy-check', { id: g.id }) });
      cmds.push({ label: `🧽 ${g.name}: ${t('group.wipe')}`, run: () => action('group:wipe', { id: g.id }) });
    }
    return cmds;
  };

  const renderList = () => {
    const q = input.value.trim().toLowerCase();
    clear(list);
    for (const c of commands().filter((c) => !q || c.label.toLowerCase().includes(q)).slice(0, 12)) {
      list.append(h('button', {
        class: 'palette-item',
        onclick: () => { action('ui:overlay-close'); c.run(); },
      }, c.label));
    }
  };
  input.addEventListener('input', renderList);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const first = list.querySelector('.palette-item'); if (first) first.click(); }
    if (e.key === 'Escape') action('ui:overlay-pop');
  });
  setTimeout(() => { input.focus(); renderList(); }, 30);
  return box;
}

function settingsPanel(state) {
  const s = state.settings;
  const up = (patch) => action('settings:update', { patch });
  return panel('settings', t('overlay.settings'),
    h('h3', { text: t('settings.general') }),
    row(t('settings.language'), select([['ar', 'العربية'], ['en', 'English']], s.language, (v) => up({ language: v, dir: v === 'ar' ? 'rtl' : 'ltr' }))),
    row(t('settings.search'), select([['google', 'Google'], ['duckduckgo', 'DuckDuckGo'], ['bing', 'Bing'], ['brave', 'Brave']], s.searchEngine, (v) => up({ searchEngine: v }))),
    row(t('settings.defaultMode'), select([['ghost', t('group.mode.ghost')], ['keep', t('group.mode.keep')], ['shared', t('group.mode.shared')]], s.defaultTabMode, (v) => up({ defaultTabMode: v }))),
    row(t('settings.restore'), toggle(s.restoreSession, (v) => up({ restoreSession: v }))),
    row(t('settings.translateTarget'), select([['', t('settings.translateAuto')], ['ar', 'العربية'], ['en', 'English'], ['fr', 'Français'], ['es', 'Español'], ['de', 'Deutsch'], ['tr', 'Türkçe'], ['id', 'Indonesia'], ['ur', 'اردو']], s.translateTarget || '', (v) => up({ translateTarget: v }))),
    h('h3', { text: t('settings.privacy') }),
    row(t('settings.rotate'), toggle(s.rotateIdentityPerGhostTab, (v) => up({ rotateIdentityPerGhostTab: v })), t('settings.rotateHint')),
    row(t('settings.shieldsGlobal'), toggle(s.shieldsGlobal, (v) => up({ shieldsGlobal: v }))),
    row(t('settings.dnt'), toggle(s.dnt, (v) => up({ dnt: v }))),
    row(t('settings.gpc'), toggle(s.gpc, (v) => up({ gpc: v }))),
    row(t('settings.memory'), toggle(s.memorySaver?.enabled !== false, (v) => up({ memorySaver: { enabled: v, minutes: s.memorySaver?.minutes || 10 } }))),
    row(t('settings.minutes'), text(String(s.memorySaver?.minutes || 10), (v) => up({ memorySaver: { enabled: s.memorySaver?.enabled !== false, minutes: Math.max(1, Number(v) || 10) } }))),
    h('h3', { text: t('settings.update') }),
    row(t('settings.updateAuto'), toggle(s.update?.auto !== false, (v) => up({ update: { auto: v } }))),
    row(t('settings.channel'), select([['latest', 'latest'], ['beta', 'beta']], s.update?.channel || 'latest', (v) => up({ update: { channel: v } }))),
    h('div', { class: 'rowbtns' },
      btn(t('settings.checkNow'), () => action('update:check', {})),
      updateStatusLine(state)),
  );
}

function updateStatusLine(state) {
  const u = state.update || {};
  const map = {
    idle: t('update.status.idle'), checking: t('update.checking'), available: `${t('update.available')}: ${u.version || ''}`,
    downloading: `${t('update.downloading')} ${u.progress || 0}%`, downloaded: t('update.ready'),
    latest: t('update.latest'), unsupported: t('update.unsupported'), error: u.error || t('update.status.error'),
  };
  const span = h('span', { class: 'upstatus', text: map[u.status] || '—' });
  if (u.status === 'available') span.append(btn(t('update.download'), () => action('update:download', {}), 'btn primary tiny'));
  if (u.status === 'downloaded') span.append(btn(t('update.install'), () => action('update:install', {}), 'btn primary tiny'));
  return span;
}

/* ------------------------------------------------------------ لوحة التحديث المدمج */
function updatePanel(state) {
  const u = state.update || {};
  const cur = u.currentVersion || '1.0.0';
  const s = state.settings;
  const up = (patch) => action('settings:update', { patch });

  const statusMap = {
    idle: t('update.status.idle'),
    checking: t('update.checking'),
    available: t('update.available'),
    downloading: t('update.downloading'),
    downloaded: t('update.ready'),
    latest: t('update.latest'),
    unsupported: t('update.unsupported'),
    error: u.error || t('update.status.error'),
  };
  const kind = u.status === 'downloaded' || u.status === 'available' || u.status === 'downloading' ? 'ok'
    : u.status === 'error' ? 'bad' : '';

  /* بطاقة الحالة الحية */
  const card = el('div', 'upcard' + (kind ? ' ' + kind : ''));
  card.append(h('div', { class: 'uprow' },
    h('span', { class: 'upmark', text: u.status === 'downloaded' ? '✅' : u.status === 'downloading' ? '⬇️' : u.status === 'available' ? '🎁' : u.status === 'latest' ? '✨' : u.status === 'error' ? '⚠️' : '👻' }),
    h('div', { class: 'upstate' },
      h('b', { text: statusMap[u.status] || '—' }),
      h('span', { class: 'mono', text: u.version && u.status !== 'latest' ? `${cur} → ${u.version}` : `v${cur}` }))));

  /* شريط تقدم التنزيل */
  if (u.status === 'downloading') {
    const bar = el('div', 'upprogress');
    const fill = el('div', 'upprogress-fill');
    fill.style.width = `${Math.max(2, u.progress || 0)}%`;
    bar.append(fill);
    card.append(bar);
  }

  /* ملاحظات الإصدار */
  if (u.notes && u.notes.body && (u.status === 'available' || u.status === 'downloaded')) {
    card.append(h('div', { class: 'upnotes', text: u.notes.body.slice(0, 400) }));
  }

  /* أزرار حسب الحالة */
  const actions = el('div', 'rowbtns');
  if (u.status === 'available') {
    actions.append(btn(`${t('update.download')} (v${u.version})`, () => action('update:download', {}), 'btn primary'));
  } else if (u.status === 'downloading') {
    const b = btn(`${t('update.downloading')} ${u.progress || 0}%`, () => {}, 'btn');
    b.disabled = true;
    actions.append(b);
  } else if (u.status === 'downloaded') {
    actions.append(btn(`${t('update.install')} (v${u.version})`, () => action('update:install', {}), 'btn primary glow'));
  } else if (u.status !== 'checking') {
    actions.append(btn(t('settings.checkNow'), () => action('update:check', {}), 'btn primary'));
  }

  return panel('update', `🔄 ${t('update.panel')}`,
    card,
    actions,
    h('h3', { text: t('settings.update') }),
    row(t('settings.updateAuto'), toggle(s.update?.auto !== false, (v) => up({ update: { auto: v } }))),
    row(t('settings.updateAutoDownload'), toggle(!!s.update?.autoDownload, (v) => up({ update: { autoDownload: v } }))),
    row(t('settings.channel'), select([['latest', 'latest'], ['beta', 'beta']], s.update?.channel || 'latest', (v) => up({ update: { channel: v } }))),
    h('p', { class: 'fineprint', text: t('update.panelHint') }),
  );
}

/* ------------------------------------------------------ حالة الـ IP للقروب */
function ipStatusCard(g) {
  const box = el('div', 'ipcard');
  const lc = g.proxy?.lastCheck;
  if (!lc) {
    box.append(h('div', { class: 'ipnone', text: t('group.ipNone') }));
  } else if (lc.error) {
    box.classList.add('bad');
    box.append(h('div', { class: 'ipline', text: `✕ ${lc.error}` }));
    box.append(h('div', { class: 'ipline mono', text: new Date(lc.at).toLocaleTimeString() }));
  } else {
    box.classList.add('ok');
    box.append(
      h('div', { class: 'ipline' },
        h('b', { text: lc.ip }),
        h('span', { class: 'ipcountry', text: `${countryFlag(lc.country)} ${lc.country}${lc.city ? ' · ' + lc.city : ''}` })),
      h('div', { class: 'ipline mono', text: `${lc.timezone || ''} · ${new Date(lc.at).toLocaleTimeString()}` }),
    );
  }
  const checkBtn = btn(t('group.proxyCheck'), () => action('group:proxy-check', { id: g.id }), 'btn primary tiny');
  box.append(checkBtn);
  return box;
}

const FLAGS = { US: '🇺🇸', CA: '🇨🇦', GB: '🇬🇧', DE: '🇩🇪', FR: '🇫🇷', NL: '🇳🇱', ES: '🇪🇸', TR: '🇹🇷', AE: '🇦🇪', SA: '🇸🇦', EG: '🇪🇬', ID: '🇮🇩', IN: '🇮🇳', JP: '🇯🇵', KR: '🇰🇷', BR: '🇧🇷', MX: '🇲🇽', AU: '🇦🇺', SG: '🇸🇬', MY: '🇲🇾', PH: '🇵🇭', NG: '🇳🇬', ZA: '🇿🇦', PL: '🇵🇱', SE: '🇸🇪', RU: '🇷🇺', PK: '🇵🇰' };
const countryFlag = (code) => FLAGS[String(code || '').toUpperCase()] || '🌐';

function groupPanel(state, params) {
  const g = groupOf(state, params.groupId) || groupOf(state, state.activeGroupId);
  if (!g) return panel('group', t('overlay.group'), '—');
  const up = (patch) => action('group:update', { id: g.id, patch });
  const perms = g.permissions || {};
  const notesArea = h('textarea', { class: 'field notesarea', placeholder: t('group.notesPlaceholder') });
  notesArea.value = g.notes || '';
  notesArea.addEventListener('change', () => up({ notes: notesArea.value }));
  return panel('group', `${g.emoji || '👥'} ${t('overlay.group')} — ${g.name}`,
    row(t('group.name'), text(g.name, (v) => up({ name: v }))),
    row(t('group.color'), colorRow(g.color, (v) => up({ color: v }))),
    row(t('group.preset'), select(COUNTRIES.map((c) => [c.id, `${c.flag} ${c.country} — ${c.city}`]), g.identity.presetId, (v) => action('group:set-preset', { id: g.id, presetId: v })), t('group.presetHint')),
    row(t('group.tabMode'), select([['ghost', t('group.mode.ghost')], ['keep', t('group.mode.keep')], ['shared', t('group.mode.shared')]], g.tabMode, (v) => up({ tabMode: v }))),
    h('h3', { text: t('group.proxy') }),
    row(t('group.proxyEnable'), toggle(!!g.proxy?.enabled, (v) => up({ proxy: { enabled: v } })), t('group.proxyEnableHint')),
    row(t('group.proxyUrl'), text(g.proxy?.url || '', (v) => up({ proxy: { url: v } }), 'socks5://user:pass@1.2.3.4:1080')),
    row(t('group.proxyAuth'), text(g.proxy?.username || '', (v) => up({ proxy: { username: v } }), t('group.proxyAuthHint'))),
    ipStatusCard(g),
    h('h3', { text: t('group.notes') }),
    h('div', { class: 'noteswrap' }, notesArea, h('p', { class: 'fineprint', text: t('group.notesHint') })),
    h('h3', { text: t('group.shields') }),
    row(t('group.ads'), toggle(g.shields.ads, (v) => action('shields:toggle-group', { id: g.id, kind: 'ads', enabled: v }))),
    row(t('group.trackers'), toggle(g.shields.trackers, (v) => action('shields:toggle-group', { id: g.id, kind: 'trackers', enabled: v }))),
    row(t('group.annoyances'), toggle(g.shields.annoyances, (v) => action('shields:toggle-group', { id: g.id, kind: 'annoyances', enabled: v }))),
    h('h3', { text: t('group.permissions') }),
    row(t('group.geo'), select([['spoof', t('group.geoSpoof')], ['allow', t('group.geoAllow')], ['deny', t('group.geoDeny')]], perms.geolocation || 'spoof', (v) => up({ permissions: { geolocation: v } }))),
    row(t('group.notifications'), select([['deny', t('group.geoDeny')], ['allow', t('group.geoAllow')]], perms.notifications || 'deny', (v) => up({ permissions: { notifications: v } }))),
    row(t('group.media'), select([['deny', t('group.geoDeny')], ['allow', t('group.geoAllow')]], perms.camera === 'allow' ? 'allow' : 'deny', (v) => up({ permissions: { camera: v, microphone: v } }))),
    row(t('group.webrtc'), select([['no-leak', t('group.webrtcNoleak')], ['block', t('group.webrtcBlock')], ['default', t('group.webrtcDefault')]], g.identity.webrtc || 'no-leak', (v) => up({ identity: { webrtc: v } }))),
    row(t('group.noise'), toggle(!!g.identity.fingerprintNoise, (v) => up({ identity: { fingerprintNoise: v } })), t('group.noiseHint')),
    h('div', { class: 'rowbtns' },
      btn(t('group.reroll'), () => action('group:reroll', { id: g.id }), 'btn'),
      btn(t('group.wipe'), () => action('group:wipe', { id: g.id }), 'btn danger'),
      btn(t('group.export'), () => action('group:export', { id: g.id }), 'btn'),
      btn(t('group.delete'), () => action('group:delete', { id: g.id, wipe: true }), 'btn danger')),
    h('p', { class: 'fineprint', text: `TZ: ${g.identity.timezone} · ${g.identity.locale} · ${g.identity.screen.width}×${g.identity.screen.height} · Chrome/${g.identity.chromeVersion}` }),
  );
}

function colorRow(color, onChange) {
  const wrap = el('div', 'colorrow');
  for (const c of ['#7C5CFF', '#37E2D5', '#FF5C7A', '#FFB454', '#5CE49B', '#5AA7FF', '#FF7AD9', '#B085FF']) {
    const b = h('button', { class: 'swatch' + (c === color ? ' on' : ''), onclick: () => onChange(c) });
    b.style.background = c;
    wrap.append(b);
  }
  return wrap;
}

function groupNewPanel() {
  const box = panel('group-new', t('sidebar.addGroup'));
  let name = '', emoji = '🎭', color = '#7C5CFF', presetId = 'us-ny';
  box.querySelector('.panel-body').append(
    row(t('group.name'), text('', (v) => { name = v; }, 'TikTok 2')),
    row(t('group.emoji'), text(emoji, (v) => { emoji = v; })),
    row(t('group.color'), colorRow(color, (v) => { color = v; })),
    row(t('group.preset'), select(COUNTRIES.map((c) => [c.id, `${c.flag} ${c.country} — ${c.city}`]), presetId, (v) => { presetId = v; })),
    h('div', { class: 'rowbtns' }, btn(t('group.create'), async () => {
      const id = await action('group:new', { name: name || 'Group', emoji, color, presetId });
      action('ui:overlay-pop');
      if (id) action('tab:new', { groupId: id });
    }, 'btn primary')),
  );
  return box;
}

/* ------------------------------------------------------------ لوحة QR */
function qrPanel(state, params) {
  const tab = activeTab(state);
  const url = params?.url || tab?.url || '';
  const box = panel('qr', t('overlay.qr'));
  const body = box.querySelector('.panel-body');
  if (!/^https?:/i.test(url)) {
    body.append(h('p', { class: 'empty', text: t('qr.empty') }));
    return box;
  }
  const svgStr = qrSvg(url, { cellSize: 4, margin: 2 });
  const holder = el('div', 'qrbox');
  if (svgStr) holder.innerHTML = svgStr;
  else holder.append(h('p', { class: 'empty', text: t('qr.empty') }));
  body.append(holder);
  body.append(h('p', { class: 'fineprint mono qrurl', text: url }));
  body.append(h('div', { class: 'rowbtns' },
    btn(t('action.copy'), async () => {
      try { await navigator.clipboard.writeText(url); } catch { /* قد يُرفض بدون تركيز */ }
      action('ui:overlay-pop');
    }, 'btn primary')));
  body.append(h('p', { class: 'fineprint', text: t('qr.hint') }));
  return box;
}

function shieldsPanel(state) {
  const tab = activeTab(state);
  const g = tab ? groupOf(state, tab.groupId) : null;
  const nodes = [];
  if (g) {
    nodes.push(row(t('group.ads'), toggle(g.shields.ads, (v) => action('shields:toggle-group', { id: g.id, kind: 'ads', enabled: v }))));
    nodes.push(row(t('group.trackers'), toggle(g.shields.trackers, (v) => action('shields:toggle-group', { id: g.id, kind: 'trackers', enabled: v }))));
    nodes.push(row(t('group.annoyances'), toggle(g.shields.annoyances, (v) => action('shields:toggle-group', { id: g.id, kind: 'annoyances', enabled: v }))));
    nodes.push(h('p', { class: 'fineprint', text: t('adblock.blockedInTab', { n: tab?.blocked || 0, total: state.stats?.blockedSession || 0 }) }));
  }
  nodes.push(h('div', { class: 'rowbtns' },
    btn(t('adblock.updateLists'), () => action('adblock:update-lists', {})),
    h('span', { class: 'fineprint', text: `${t('adblock.engine')}: ${state.adblock?.engine || '—'} · ${t('adblock.lastUpdate')}: ${state.adblock?.lastUpdate ? new Date(state.adblock.lastUpdate).toLocaleString() : t('adblock.builtin')}` })));
  return panel('shields', '🛡 ' + t('nav.shieldOn'), ...nodes);
}

function identityPanel(state) {
  const tab = activeTab(state);
  if (!tab) return panel('identity', t('identity.title'), '—');
  const i = tab.identity || {};
  return panel('identity', `${i.flag || '🌐'} ${t('identity.title')}`,
    h('div', { class: 'idcard' },
      h('div', { class: 'idline' }, h('b', { text: `${i.country || ''} — ${i.city || ''}` })),
      h('div', { class: 'idline mono', text: `${i.timezone} · ${i.locale}` }),
      h('div', { class: 'idline', text: t('identity.mode.' + tab.mode) }),
      h('div', { class: 'idline', text: `WebRTC: ${i.webrtc === 'block' ? t('group.webrtcBlock') : i.webrtc === 'no-leak' ? t('group.webrtcNoleak') : t('group.webrtcDefault')}` }),
      tab.degraded ? h('div', { class: 'idline warn', text: t('identity.degraded') }) : null),
    h('div', { class: 'rowbtns' },
      btn(t('tab.duplicate'), () => { action('tab:duplicate', { id: tab.id, fresh: true }); action('ui:overlay-close'); }, 'btn primary'),
      btn(tab.split ? t('tab.splitOff') : t('tab.split'), () => { action('tab:split', { id: tab.id }); action('ui:overlay-close'); }, 'btn'),
      btn(t('tab.promote'), () => action('tab:promote', { id: tab.id }), 'btn'),
      btn(t('tab.freeze'), () => action('tab:freeze', { id: tab.id }), 'btn'),
      btn(t('tab.shot'), () => action('tab:screenshot', { id: tab.id }), 'btn'),
      btn(t('leak.title'), () => { action('open:leaktest', {}); action('ui:overlay-close'); }, 'btn')),
  );
}

function tabMenuPanel(state, params) {
  const tab = (state.tabs || []).find((x) => x.id === params.tabId);
  if (!tab) return panel('tabmenu', '—');
  const item = (label, fn, cls = 'palette-item') => h('button', { class: cls, onclick: () => { action('ui:overlay-close'); fn(); } }, label);
  const http = /^https?:/.test(tab.url || '');
  return panel('tabmenu', tab.title.slice(0, 40),
    item(t('tab.duplicate'), () => action('tab:duplicate', { id: tab.id, fresh: true })),
    item(tab.split ? t('tab.splitOff') : t('tab.split'), () => action('tab:split', { id: tab.id })),
    http ? item(t('nav.translate'), () => action('tab:translate', { id: tab.id })) : null,
    http ? item(t('nav.qr'), () => action('ui:overlay-push', { kind: 'qr', params: { url: tab.url } })) : null,
    item(t('tab.copyUrl'), () => navigator.clipboard?.writeText(tab.url)),
    tab.mode === 'ghost' ? item(t('tab.promote'), () => action('tab:promote', { id: tab.id })) : null,
    item(t('tab.freeze'), () => action('tab:freeze', { id: tab.id })),
    item(t('tab.shot'), () => action('tab:screenshot', { id: tab.id })),
    item(t('tab.devtools'), () => action('tab:devtools', { id: tab.id })),
    item(t('tab.close'), () => action('tab:close', { id: tab.id }), 'palette-item danger'),
  );
}

function downloadsPanel(state) {
  const list = el('div', 'dlist');
  if (!(state.downloads || []).length) list.append(h('p', { class: 'empty', text: t('empty.downloads') }));
  for (const d of state.downloads || []) {
    const pct = d.total ? Math.round((d.received / d.total) * 100) : 0;
    list.append(h('div', { class: 'ditem' },
      h('div', { class: 'dname', text: d.name }),
      h('div', { class: 'dmeta' },
        h('span', { class: 'mono', text: d.state === 'progress' ? `${pct}%` : d.state === 'done' ? '✓' : d.state }),
        h('span', { class: 'dtime', text: timeAgo(d.startedAt) })),
      h('div', { class: 'dbtns' },
        d.state === 'progress' ? btn(t('action.cancel'), () => action('download:cancel', { id: d.id }), 'btn tiny') : null,
        d.state === 'done' ? btn(t('action.open'), () => action('download:open', { id: d.id }), 'btn tiny') : null,
        btn(t('action.view'), () => action('download:show', { id: d.id }), 'btn tiny'))));
  }
  return panel('downloads', t('overlay.downloads'), list);
}

function bookmarksPanel(state) {
  const list = el('div', 'dlist');
  if (!(state.bookmarks || []).length) list.append(h('p', { class: 'empty', text: t('empty.bookmarks') }));
  for (const b of state.bookmarks || []) {
    list.append(h('div', { class: 'ditem' },
      h('button', { class: 'dname link', onclick: () => { action('ui:overlay-close'); action('tab:navigate', { url: b.url }); } }, b.title || b.url),
      h('div', { class: 'dbtns' }, btn(t('action.delete'), () => action('bookmark:remove', { id: b.id }), 'btn tiny danger'))));
  }
  return panel('bookmarks', t('overlay.bookmarks'), list);
}

function cookiesPanel(state) {
  const g = groupOf(state, state.activeGroupId);
  const list = el('div', 'dlist');
  list.append(h('p', { class: 'fineprint', text: t('cookies.loading') }));
  action('group:cookies', { id: state.activeGroupId }).then((cookies) => {
    clear(list);
    if (!cookies || !cookies.length) list.append(h('p', { class: 'empty', text: t('empty.cookies') }));
    for (const c of (cookies || []).slice(0, 200)) {
      list.append(h('div', { class: 'ditem small' },
        h('div', { class: 'dname mono', text: c.domain }),
        h('div', { class: 'dmeta', text: c.name })));
    }
  });
  return panel('cookies', `🍪 ${t('overlay.cookies')} — ${g?.name || ''}`,
    list,
    h('div', { class: 'rowbtns' }, btn(t('group.wipe'), () => action('group:wipe', { id: state.activeGroupId }), 'btn danger')));
}

function bundlesPanel(state) {
  const list = el('div', 'dlist');
  for (const b of state.sessionBundles || []) {
    list.append(h('div', { class: 'ditem' },
      h('div', { class: 'dname', text: `${b.name} (${b.tabs.length})` }),
      h('div', { class: 'dmeta', text: timeAgo(b.at) }),
      h('div', { class: 'dbtns' },
        btn(t('action.restore'), () => action('bundle:restore', { id: b.id }), 'btn tiny'),
        btn(t('action.delete'), () => action('bundle:delete', { id: b.id }), 'btn tiny danger'))));
  }
  if (!list.children.length) list.append(h('p', { class: 'empty', text: t('empty.bundles') }));
  return panel('bundles', t('overlay.bundles'),
    h('div', { class: 'rowbtns' }, btn(t('bundles.saveCurrent'), () => action('bundle:save', {}), 'btn primary')),
    list);
}

function menuPanel(state) {
  const item = (label, fn, icon) => h('button', { class: 'palette-item', onclick: () => { action('ui:overlay-close'); fn(); } }, icon ? h('span', { class: 'mi', text: icon }) : null, label);
  const tab = activeTab(state);
  const http = !!tab && /^https?:/.test(tab.url || '');
  return panel('menu', t('nav.menu'),
    item(t('tab.new'), () => action('tab:new', {}), '➕'),
    item(t('tab.newGhost'), () => action('tab:new', { mode: 'ghost', rotate: true }), '👻'),
    item(tab?.split ? t('tab.splitOff') : t('tab.split'), () => action('tab:split', { id: state.activeTabId }), '🔀'),
    http ? item(t('nav.translate'), () => action('tab:translate', { id: state.activeTabId }), '🌐') : null,
    http ? item(t('nav.qr'), () => action('ui:overlay-push', { kind: 'qr', params: { url: tab.url } }), '📱') : null,
    item(t('overlay.downloads'), () => action('ui:overlay-push', { kind: 'downloads' }), '⬇️'),
    item(t('vpn.title'), () => action('ui:overlay-push', { kind: 'vpn' }), '🛡'),
    item(t('update.panel'), () => action('ui:overlay-push', { kind: 'update' }), '🔄'),
    item(t('overlay.bookmarks'), () => action('ui:overlay-push', { kind: 'bookmarks' }), '⭐'),
    item(t('overlay.cookies'), () => action('ui:overlay-push', { kind: 'cookies' }), '🍪'),
    item(t('overlay.bundles'), () => action('ui:overlay-push', { kind: 'bundles' }), '🗂'),
    item(t('leak.title'), () => action('open:leaktest', {}), '🧪'),
    item(t('palette.immersive'), () => action('ui:immersive', {}), '🌫'),
    item(t('palette.panic'), () => action('panic', {}), '🚨'),
    item(t('overlay.settings'), () => action('ui:overlay-push', { kind: 'settings' }), '⚙️'),
    item(t('overlay.about'), () => action('ui:overlay-push', { kind: 'about' }), 'ℹ️'),
    updateStatusLine(state),
  );
}

/* ------------------------------------------------------------ لوحة VPN المجاني */
function vpnPanel(state) {
  const g = groupOf(state, state.activeGroupId);
  const nodes = state.vpn?.nodes || [];
  const connectedUrl = g?.proxy?.enabled ? g.proxy.url : null;
  const testing = !!state.vpn?.testing;

  /* فلتر الدول المُستخلص من العقد المتاحة */
  const countries = [...new Set(nodes.map((n) => n.country).filter(Boolean))].sort();
  let filter = 'ALL';

  const listWrap = el('div', 'vpnlist');

  const speedTag = (ms) => ms < 900 ? t('vpn.speedFast') : ms < 2500 ? t('vpn.speedOk') : t('vpn.speedSlow');

  function renderNodes() {
    clear(listWrap);
    const shown = filter === 'ALL' ? nodes : nodes.filter((n) => n.country === filter);
    if (!shown.length) {
      listWrap.append(h('div', { class: 'empty', text: testing ? t('vpn.testing') : t('vpn.empty') }));
      return;
    }
    for (const n of shown.slice(0, 30)) {
      const on = connectedUrl === n.url;
      const item = el('button', 'vpnnode' + (on ? ' on' : ''));
      item.append(
        h('span', { class: 'vflag', text: countryFlag(n.country) }),
        h('div', { class: 'vinfo' },
          h('div', { class: 'vname', text: `${n.country}${n.city ? ' · ' + n.city : ''}${on ? ' · ✓ ' + t('vpn.active') : ''}` }),
          h('div', { class: 'vmeta mono', text: `${n.scheme} · ${n.host}:${n.port}` })),
        h('div', { class: 'vstats' },
          h('span', { class: 'vlat ' + (n.latency < 900 ? 'fast' : n.latency < 2500 ? 'ok' : 'slow'), text: `${n.latency}ms · ${speedTag(n.latency)}` }),
          on
            ? btn(t('vpn.disconnect'), () => action('vpn:disconnect', { groupId: g.id }), 'btn tiny danger')
            : btn(t('vpn.connect'), () => action('vpn:connect', { groupId: g.id, url: n.url }), 'btn tiny primary')),
      );
      listWrap.append(item);
    }
  }

  const filterSel = select([['ALL', t('vpn.all')], ...countries.map((c) => [c, `${countryFlag(c)} ${c}`])], 'ALL', (v) => { filter = v; renderNodes(); });

  const box = panel('vpn', `🛡 ${t('vpn.title')}${g ? ' — ' + t('vpn.forGroup') + ': ' + (g.emoji || '') + ' ' + g.name : ''}`,
    h('p', { class: 'fineprint', text: t('vpn.subtitle') }),
    h('div', { class: 'vpntoolbar' },
      filterSel,
      btn(testing ? t('group.proxyChecking') : t('vpn.refresh'), () => action('vpn:refresh', {}), 'btn primary tiny'),
      h('span', { class: 'vpnstatus', text: nodes.length ? `${nodes.length} ✓` : '—' })),
    listWrap,
    connectedUrl
      ? h('div', { class: 'vpncard on' },
          h('div', { class: 'vpnwave', text: '📶' }),
          h('div', { class: 'vpnstate' },
            h('b', { text: t('vpn.active') }),
            h('span', { class: 'mono', text: connectedUrl })),
          btn(t('vpn.disconnect'), () => action('vpn:disconnect', { groupId: g.id }), 'btn tiny danger'))
      : null,
    h('p', { class: 'fineprint warn', text: '⚠ ' + t('vpn.freedom') }),
  );
  renderNodes();
  return box;
}

function aboutPanel(state) {
  const box = panel('about', t('overlay.about'));
  box.querySelector('.panel-body').append(
    h('div', { class: 'aboutmark', text: '👻' }),
    h('h1', { text: 'Ghost Browser' }),
    h('p', { class: 'fineprint', text: t('about.desc') }),
    h('p', { class: 'fineprint mono', text: `v${state.update?.version || '1.0.0'} · Electron · Chromium` }),
    h('div', { class: 'rowbtns' }, btn(t('settings.checkNow'), () => action('update:check', {})), updateStatusLine(state)),
  );
  return box;
}

/* ------------------------------------------------------------ الجذر */
export function mountOverlay(root) {
  root.classList.add('overlay-root');
  const toasts = el('div', 'toasts');
  root.append(toasts);

  window.ghost.onEvent(({ type, payload }) => {
    if (type !== 'toast') return;
    const el2 = h('div', { class: 'toast ' + (payload.kind || 'ok') }, payload.text);
    toasts.append(el2);
    setTimeout(() => el2.classList.add('out'), 3600);
    setTimeout(() => el2.remove(), 4200);
  });

  function render(state) {
    const stack = state.ui.overlayStack || [];
    const top = stack[stack.length - 1];
    clear(root);
    root.append(toasts);
    if (!top) return;
    const backdrop = el('div', 'backdrop');
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) action('ui:overlay-pop'); });
    let panelEl = null;
    switch (top.kind) {
      case 'palette': panelEl = palettePanel(state); break;
      case 'settings': panelEl = settingsPanel(state); break;
      case 'group': panelEl = groupPanel(state, top.params); break;
      case 'group-new': panelEl = groupNewPanel(); break;
      case 'shields': panelEl = shieldsPanel(state); break;
      case 'identity': panelEl = identityPanel(state); break;
      case 'tabmenu': panelEl = tabMenuPanel(state, top.params); break;
      case 'downloads': panelEl = downloadsPanel(state); break;
      case 'bookmarks': panelEl = bookmarksPanel(state); break;
      case 'cookies': panelEl = cookiesPanel(state); break;
      case 'bundles': panelEl = bundlesPanel(state); break;
      case 'qr': panelEl = qrPanel(state, top.params); break;
      case 'menu': panelEl = menuPanel(state); break;
      case 'about': panelEl = aboutPanel(state); break;
      case 'vpn': panelEl = vpnPanel(state); break;
      case 'update': panelEl = updatePanel(state); break;
      default: panelEl = panel('unknown', top.kind);
    }
    backdrop.append(panelEl);
    root.append(backdrop);
    document.addEventListener('keydown', escHandler);
  }

  const escHandler = (e) => {
    if (e.key === 'Escape') { action('ui:overlay-pop'); document.removeEventListener('keydown', escHandler); }
  };

  store.subscribe(render);
  return { render };
}
