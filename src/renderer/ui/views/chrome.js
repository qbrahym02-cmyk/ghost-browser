/** عرض الشريط العلوي: شريط التابات + شريط العنوان + شريط البحث + أزرار النافذة. */
import { h, svg, ICONS, clear, el } from '../lib/dom.js';
import { t } from '../lib/i18n.js';
import { store, action, activeTab, groupOf, tzClock } from '../lib/api.js';

const MODE_ICON = { ghost: '👻', keep: '💾', shared: '👥' };

export function mountChrome(root) {
  root.classList.add('chrome-root');

  const tabsEl = el('div', 'tabs');
  const newTabBtn = h('button', { class: 'iconbtn ghostbtn', title: t('tab.newGhost'), onclick: () => action('tab:new', { mode: 'ghost', rotate: true }) }, svg(ICONS.ghost, 15));
  const winCtl = el('div', 'winctl');
  const btnMin = h('button', { class: 'winbtn', onclick: () => action('win:min') }, svg(ICONS.min, 14));
  const btnMax = h('button', { class: 'winbtn', onclick: () => action('win:max') }, svg(ICONS.max, 14));
  const btnClose = h('button', { class: 'winbtn close', onclick: () => action('win:close') }, svg(ICONS.x, 14));
  winCtl.append(btnMin, btnMax, btnClose);

  const strip = el('div', 'tabstrip');
  strip.append(tabsEl, newTabBtn, el('div', 'stripspacer'), winCtl);

  const btnBack = h('button', { class: 'iconbtn', title: t('nav.back'), onclick: () => action('tab:back', { id: store.state?.activeTabId }) }, svg(ICONS.back, 16));
  const btnFwd = h('button', { class: 'iconbtn', title: t('nav.forward'), onclick: () => action('tab:forward', { id: store.state?.activeTabId }) }, svg(ICONS.forward, 16));
  const btnReload = h('button', { class: 'iconbtn', title: t('nav.reload'), onclick: () => reloadClick() }, svg(ICONS.reload, 15));
  const btnTranslate = h('button', { class: 'iconbtn', title: t('nav.translate'), onclick: () => action('tab:translate', { id: store.state?.activeTabId }) }, svg(ICONS.translate, 16));
  const btnSplit = h('button', { class: 'iconbtn', title: t('nav.split'), onclick: () => action('tab:split', { id: store.state?.activeTabId }) }, svg(ICONS.split, 15));
  const btnShield = h('button', { class: 'iconbtn shield', title: t('nav.shieldOn'), onclick: () => action('ui:overlay-push', { kind: 'shields' }) }, svg(ICONS.shield, 16));
  const btnStar = h('button', { class: 'iconbtn', title: t('nav.bookmark'), onclick: () => action('bookmark:add', {}) }, svg(ICONS.star, 15));
  const btnQr = h('button', { class: 'iconbtn', title: t('nav.qr'), onclick: () => action('ui:overlay-push', { kind: 'qr', params: { url: activeTab(store.state)?.url } }) }, svg(ICONS.qr, 15));
  const btnMenu = h('button', { class: 'iconbtn', title: t('nav.menu'), onclick: () => action('ui:overlay-push', { kind: 'menu' }) }, svg(ICONS.menu, 16));

  const address = h('input', { class: 'address', type: 'text', spellcheck: 'false', placeholder: t('address.placeholder') });
  const chip = el('button', 'idchip');
  const addressWrap = el('div', 'addresswrap');
  addressWrap.append(btnShield, address, chip, btnStar, btnQr);

  const navbar = el('div', 'navbar');
  navbar.append(btnBack, btnFwd, btnReload, btnTranslate, addressWrap, btnSplit, btnMenu);

  const findInput = h('input', { class: 'findinput', type: 'text', placeholder: t('find.placeholder') });
  const findBar = el('div', 'findbar');
  findBar.hidden = true;
  findBar.append(findInput, h('button', { class: 'iconbtn', onclick: () => doFind(false) }, svg(ICONS.chevron, 14)), h('button', { class: 'iconbtn rot', onclick: () => doFind(true) }, svg(ICONS.chevron, 14)), h('button', { class: 'iconbtn', onclick: () => closeFind() }, svg(ICONS.x, 14)));

  root.append(strip, navbar, findBar);

  /* ------------------------------------------------------------ أحداث */
  address.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      action('tab:navigate', { id: store.state?.activeTabId, url: address.value });
      address.blur();
    } else if (e.key === 'Escape') {
      syncAddress(true);
      address.blur();
    }
  });
  address.addEventListener('focus', () => address.select());

  findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doFind(e.shiftKey);
    if (e.key === 'Escape') closeFind();
  });
  findInput.addEventListener('input', () => doFind(true, false));

  function doFind(backward, next = true) {
    action('tab:find', { id: store.state?.activeTabId, text: findInput.value, backward, next });
  }
  function closeFind() {
    findBar.hidden = true;
    action('tab:find-stop', {});
  }
  function reloadClick() {
    const tab = activeTab(store.state);
    if (tab && tab.loading) action('tab:stop', { id: tab.id });
    else action('tab:reload', { id: tab?.id });
  }

  /* أحداث قادمة من القائمة/الاختصارات */
  window.ghost.onEvent(({ type, payload }) => {
    if (type === 'focus-address') { address.focus(); address.select(); }
    if (type === 'open-find') { findBar.hidden = false; findInput.focus(); }
    if (type === 'open-settings') action('ui:overlay-push', { kind: 'settings' });
    if (type === 'open-palette') action('ui:overlay-push', { kind: 'palette' });
    if (type === 'open-about') action('ui:overlay-push', { kind: 'about' });
    if (type === 'open-bundle-save') action('ui:overlay-push', { kind: 'bundle-save' });
    if (type === 'open-qr') {
      const url = payload?.url || activeTab(store.state)?.url;
      action('ui:overlay-push', { kind: 'qr', params: { url } });
    }
  });

  /* ------------------------------------------------------------ تحديث */
  let clockTimer = null;
  function render(state) {
    renderTabs(state);
    renderNav(state);
    if (!clockTimer) clockTimer = setInterval(() => renderChip(store.state), 30000);
  }

  function renderTabs(state) {
    clear(tabsEl);
    for (const tab of state.tabs || []) {
      const g = groupOf(state, tab.groupId);
      const chipEl = el('div', 'tab' + (tab.id === state.activeTabId ? ' active' : '') + (tab.crashed ? ' crashed' : '') + (tab.frozen ? ' frozen' : ''));
      chipEl.style.setProperty('--gc', g ? g.color : '#7C5CFF');
      chipEl.draggable = true;
      chipEl.dataset.id = tab.id;
      chipEl.title = `${tab.title}\n${tab.url}`;

      const stripe = el('span', 'tabstripe');
      chipEl.append(stripe);

      if (tab.favicons && tab.favicons[0]) {
        chipEl.append(h('img', { class: 'tabfav', src: tab.favicons[0], alt: '', draggable: 'false' }));
      } else {
        chipEl.append(h('span', { class: 'tabfav fallback', text: MODE_ICON[tab.mode] || '🌐' }));
      }
      if (tab.loading) chipEl.append(h('span', { class: 'spinner' }));
      chipEl.append(h('span', { class: 'tabtitle', text: tab.title || tab.url }));
      if (tab.audible) {
        chipEl.append(h('button', {
          class: 'tabmute', title: tab.muted ? t('tab.unmute') : t('tab.mute'),
          onclick: (e) => { e.stopPropagation(); action('tab:mute', { id: tab.id }); },
        }, svg(tab.muted ? ICONS.mute : ICONS.speaker, 12)));
      }
      if (tab.blocked > 0) chipEl.append(h('span', { class: 'tabblocked', text: String(tab.blocked), title: t('adblock.blockedInTab', { n: tab.blocked, total: '' }) }));
      if (tab.split) chipEl.append(h('span', { class: 'tabsplit', title: t('tab.split') }, svg(ICONS.split, 10)));
      chipEl.append(h('button', {
        class: 'tabclose', title: t('tab.close'),
        onclick: (e) => { e.stopPropagation(); action('tab:close', { id: tab.id }); },
      }, svg(ICONS.x, 11)));

      chipEl.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        action('tab:activate', { id: tab.id });
      });
      chipEl.addEventListener('auxclick', (e) => { if (e.button === 1) action('tab:close', { id: tab.id }); });
      chipEl.addEventListener('contextmenu', () => tabMenu(tab));

      /* سحب لإعادة الترتيب */
      chipEl.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/ghost-tab', tab.id); e.dataTransfer.effectAllowed = 'move'; });
      chipEl.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/ghost-tab')) { e.preventDefault(); chipEl.classList.add('drop-target'); } });
      chipEl.addEventListener('dragleave', () => chipEl.classList.remove('drop-target'));
      chipEl.addEventListener('drop', (e) => {
        e.preventDefault();
        chipEl.classList.remove('drop-target');
        const id = e.dataTransfer.getData('text/ghost-tab');
        if (id) action('tab:move', { id, index: (state.tabs || []).indexOf(tab) });
      });
      tabsEl.append(chipEl);
    }
    if (!(state.tabs || []).length) tabsEl.append(h('span', { class: 'tabsempty', text: t('empty.tabs') }));
  }

  function tabMenu(tab) {
    action('ui:overlay-push', { kind: 'tabmenu', params: { tabId: tab.id } });
  }

  function renderNav(state) {
    const tab = activeTab(state);
    btnBack.disabled = !tab?.canGoBack;
    btnFwd.disabled = !tab?.canGoForward;
    btnReload.innerHTML = '';
    btnReload.append(svg(tab?.loading ? ICONS.x : ICONS.reload, 15));
    const g = tab ? groupOf(state, tab.groupId) : null;
    const shieldsOn = state.settings.shieldsGlobal !== false && g ? g.shields.ads || g.shields.trackers : false;
    btnShield.classList.toggle('off', !shieldsOn);
    btnShield.title = shieldsOn ? t('nav.shieldOn') : t('nav.shieldOff');
    btnShield.innerHTML = '';
    btnShield.append(svg(shieldsOn ? ICONS.shield : ICONS.shieldOff, 16));
    /* ترجمة: تعمل على صفحات http فقط */
    const translatable = !!tab && /^https?:/.test(tab.url || '');
    btnTranslate.disabled = !translatable;
    /* سبليت: زر التبديل للتاب النشط */
    const splitOn = !!tab && tab.id === state.ui.splitTabId;
    btnSplit.classList.toggle('on', splitOn);
    btnSplit.title = splitOn ? t('tab.splitOff') : t('tab.split');
    btnQr.disabled = !translatable;
    if (document.activeElement !== address) syncAddress(true);
    renderChip(state);
  }

  function syncAddress(force) {
    const tab = activeTab(store.state);
    const url = tab?.url || '';
    const pretty = url.startsWith('ghost://newtab') ? '' : url;
    if (force || document.activeElement !== address) address.value = pretty;
  }

  function renderChip(state) {
    const tab = activeTab(state);
    clear(chip);
    if (!tab) return;
    const g = groupOf(state, tab.groupId);
    chip.style.setProperty('--gc', g ? g.color : '#7C5CFF');
    chip.title = t('identity.title');
    chip.append(h('span', { class: 'chipflag', text: tab.identity?.flag || '🌐' }));
    chip.append(h('span', { class: 'chiptz mono', text: tzClock(tab.identity?.timezone) }));
    chip.append(h('span', { class: 'chipmode', text: MODE_ICON[tab.mode] || '' }));
    if (tab.degraded) chip.append(h('span', { class: 'chipwarn', title: t('identity.degraded'), text: '!' }));
  }

  store.subscribe(render);
  return { render };
}
