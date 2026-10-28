/** الشريط الجانبي: قروبات بهوية حيّة (ساعة محلية لكل قروب) + إجراءات سريعة. */
import { h, svg, ICONS, clear, el } from '../lib/dom.js';
import { t } from '../lib/i18n.js';
import { store, action, tzClock } from '../lib/api.js';

export function mountSidebar(root) {
  root.classList.add('sidebar-root');

  const head = el('div', 'sb-head');
  head.append(
    h('div', { class: 'logo' }, h('span', { class: 'logomark', text: '👻' }), h('span', { class: 'logotext', text: 'Ghost' })),
    h('button', { class: 'iconbtn', title: 'طي/فتح', onclick: () => action('ui:sidebar-toggle') }, svg(ICONS.chevron, 14)),
  );

  const list = el('div', 'sb-groups');
  const foot = el('div', 'sb-foot');
  root.append(head, list, foot);

  const footBtn = (icon, label, kind) => h('button', { class: 'sb-footbtn', title: label, onclick: () => action('ui:overlay-push', { kind }) }, svg(icon, 15), h('span', { class: 'lbl', text: label }));
  foot.append(
    footBtn(ICONS.download, t('overlay.downloads'), 'downloads'),
    footBtn(ICONS.globe, t('vpn.title'), 'vpn'),
    footBtn(ICONS.book, t('overlay.bookmarks'), 'bookmarks'),
    footBtn(ICONS.layers, t('overlay.bundles'), 'bundles'),
    footBtn(ICONS.settings, t('sidebar.settings'), 'settings'),
  );

  let clockTimer = null;

  function render(state) {
    const collapsed = state.ui.sidebarCollapsed;
    root.classList.toggle('collapsed', collapsed);
    clear(list);

    list.append(h('div', { class: 'sb-title', text: collapsed ? '' : t('sidebar.groups') }));

    for (const g of state.groups || []) {
      const tabCount = (state.tabs || []).filter((tb) => tb.groupId === g.id).length;
      const card = el('button', 'gcard' + (g.id === state.activeGroupId ? ' active' : ''));
      card.style.setProperty('--gc', g.color);
      card.title = `${g.emoji || ''} ${g.name} — ${g.identity.country}/${g.identity.city}`;
      card.addEventListener('click', () => openGroup(state, g));

      const dot = el('span', 'gdot');
      dot.textContent = g.emoji || '●';
      card.append(dot);

      if (!collapsed) {
        const info = el('div', 'ginfo');
        info.append(h('div', { class: 'gname', text: g.name }));
        const lc = g.proxy && g.proxy.lastCheck;
        const ipLine = lc && !lc.error
          ? h('span', { class: 'gip', title: lc.ip }, `${ipFlag(lc.country)} ${lc.ip}`)
          : (g.proxy && g.proxy.enabled ? h('span', { class: 'gip pending', title: t('group.proxyCheck') }, '…') : null);
        info.append(h('div', { class: 'gmeta' },
          h('span', { class: 'gflag', text: g.identity.flag }),
          h('span', { class: 'gcity', text: g.identity.city }),
          h('span', { class: 'gclock mono', 'data-tz': g.identity.timezone, text: tzClock(g.identity.timezone) }),
          ipLine,
        ));
        card.append(info);
        const badges = el('div', 'gbadges');
        badges.append(h('span', { class: 'gbadge', text: String(tabCount), title: t('sidebar.tabs') }));
        if (g.proxy && g.proxy.enabled) badges.append(h('span', { class: 'gbadge proxy', text: 'VPN', title: g.proxy.url }));
        if (g.notes) badges.append(h('span', { class: 'gbadge note', title: t('group.notes') }, svg(ICONS.note, 10)));
        if (g.shields.ads) badges.append(h('span', { class: 'gbadge shield', text: '🛡' }));
        card.append(badges);
        card.append(h('button', {
          class: 'gcfg', title: t('overlay.group'),
          onclick: (e) => { e.stopPropagation(); action('ui:overlay-push', { kind: 'group', params: { groupId: g.id } }); },
        }, svg(ICONS.settings, 13)));
      }
      list.append(card);
    }

    const add = el('button', 'gadd');
    add.addEventListener('click', () => action('ui:overlay-push', { kind: 'group-new' }));
    add.append(svg(ICONS.plus, 14));
    if (!collapsed) add.append(h('span', { text: t('sidebar.addGroup') }));
    list.append(add);

    if (!clockTimer) clockTimer = setInterval(() => tickClocks(), 20000);
  }

  function tickClocks() {
    for (const node of root.querySelectorAll('.gclock')) {
      node.textContent = tzClock(node.dataset.tz);
    }
  }

  const IP_FLAGS = { US: '🇺🇸', CA: '🇨🇦', GB: '🇬🇧', DE: '🇩🇪', FR: '🇫🇷', NL: '🇳🇱', ES: '🇪🇸', TR: '🇹🇷', AE: '🇦🇪', SA: '🇸🇦', EG: '🇪🇬', ID: '🇮🇩', IN: '🇮🇳', JP: '🇯🇵', KR: '🇰🇷', BR: '🇧🇷', MX: '🇲🇽', AU: '🇦🇺', SG: '🇸🇬', MY: '🇲🇾', PH: '🇵🇭', NG: '🇳🇬', ZA: '🇿🇦', PL: '🇵🇱', SE: '🇸🇪', RU: '🇷🇺', PK: '🇵🇰' };
  const ipFlag = (code) => IP_FLAGS[String(code || '').toUpperCase()] || '🌐';

  function openGroup(state, g) {
    if (g.id !== state.activeGroupId) action('group:activate', { id: g.id });
    const tab = (state.tabs || []).find((tb) => tb.groupId === g.id);
    if (tab) action('tab:activate', { id: tab.id });
    else action('tab:new', { groupId: g.id });
  }

  store.subscribe(render);
  return { render };
}
