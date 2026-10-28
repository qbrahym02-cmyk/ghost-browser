/** صفحة البداية: بطاقة الهوية الحيّة + بحث + روابط سريعة. */
const bridge = window.ghostBridge;
const $ = (id) => document.getElementById(id);

const L = {
  ar: {
    hint: 'كل تاب شبح يبدأ بلا كوكيز ولا تاريخ — كأنك فتحت جهازاً لم يُلمس.',
    search: 'ابحث أو اكتب عنواناً…',
    mode: { ghost: 'وضع شبح', keep: 'جلسة محفوظة', shared: 'جلسة القروب' },
    quick: [
      ['تيك توك', 'https://www.tiktok.com/', '🎵'],
      ['يوتيوب', 'https://www.youtube.com/', '▶️'],
      ['إنستغرام', 'https://www.instagram.com/', '📸'],
      ['إكس', 'https://x.com/', '✖️'],
      ['جيميل', 'https://mail.google.com/', '✉️'],
      ['مختبر البصمة', 'ghost://leaktest/', '🧪'],
    ],
    engine: (s) => `محرك الحجب: ${s.adblock?.engine || '—'} · قروبات: ${(s.groups || []).length}`,
    ipTitle: 'IP القروب',
  },
  en: {
    hint: 'Every ghost tab starts with zero cookies and zero history — like a device never touched.',
    search: 'Search or enter address…',
    mode: { ghost: 'Ghost mode', keep: 'Kept session', shared: 'Group session' },
    quick: [
      ['TikTok', 'https://www.tiktok.com/', '🎵'],
      ['YouTube', 'https://www.youtube.com/', '▶️'],
      ['Instagram', 'https://www.instagram.com/', '📸'],
      ['X', 'https://x.com/', '✖️'],
      ['Gmail', 'https://mail.google.com/', '✉️'],
      ['Leak lab', 'ghost://leaktest/', '🧪'],
    ],
    engine: (s) => `Block engine: ${s.adblock?.engine || '—'} · groups: ${(s.groups || []).length}`,
    ipTitle: 'Group IP',
  },
};

let tabId = null;
let i18n = L.ar;

async function boot() {
  tabId = await bridge.getTabId();
  const state = await bridge.getState();
  i18n = L[state.settings?.language] || L.ar;
  document.documentElement.lang = state.settings?.language || 'ar';
  document.documentElement.dir = state.settings?.dir || (state.settings?.language === 'en' ? 'ltr' : 'rtl');
  const tab = (state.tabs || []).find((t) => t.id === tabId);
  const group = (state.groups || []).find((g) => g.id === tab?.groupId);

  $('hint').textContent = i18n.hint;
  $('search').placeholder = i18n.search;
  const i = tab?.identity || group?.identity || {};
  $('idflag').textContent = i.flag || '🌐';
  $('idplace').textContent = `${i.country || '—'} — ${i.city || ''}`;
  $('idtz').textContent = i.timezone || '';
  $('idlocale').textContent = i.locale || '';
  $('idmode').textContent = i18n.mode[tab?.mode] || '';
  $('blocked').textContent = String(state.stats?.blockedSession || 0);
  $('engineinfo').textContent = i18n.engine(state);
  renderIp(group);
  tick();
  setInterval(tick, 15000);

  const quick = $('quick');
  for (const [label, url, icon] of i18n.quick) {
    const b = document.createElement('button');
    b.className = 'qbtn';
    b.innerHTML = `<span class="qicon">${icon}</span><span>${label}</span>`;
    b.addEventListener('click', () => {
      if (url.startsWith('ghost:')) location.href = url;
      else bridge.action('tab:navigate', { id: tabId, url });
    });
    quick.append(b);
  }

  $('searchform').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('search').value.trim();
    if (v) bridge.action('tab:navigate', { id: tabId, url: v });
  });

  bridge.onState((s) => {
    $('blocked').textContent = String(s.stats?.blockedSession || 0);
    const g = (s.groups || []).find((x) => x.id === tab?.groupId);
    if (g) renderIp(g);
  });
}

function renderIp(group) {
  const el = $('idip');
  if (!el) return;
  const lc = group?.proxy?.lastCheck;
  if (lc && !lc.error) {
    el.title = `${i18n.ipTitle}: ${lc.ip} (${lc.country})`;
    el.textContent = `${lc.ip} · ${lc.country}`;
    el.style.display = '';
  } else if (group?.proxy?.enabled) {
    el.title = i18n.ipTitle;
    el.textContent = 'VPN …';
    el.style.display = '';
  } else {
    el.style.display = 'none';
  }
}

function tick() {
  const tz = $('idtz').textContent;
  try {
    $('idclock').textContent = new Intl.DateTimeFormat(document.documentElement.lang === 'en' ? 'en-US' : 'ar-EG', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(new Date());
  } catch { $('idclock').textContent = '--:--'; }
}

boot();
