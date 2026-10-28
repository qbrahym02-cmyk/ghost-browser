/** إقلاع واجهة Ghost: يحدد الدور (شريط/جانبي/طبقة) من معامل العرض. */
import { store, bridge } from './lib/api.js';
import { setLang } from './lib/i18n.js';
import { mountChrome } from './views/chrome.js';
import { mountSidebar } from './views/sidebar.js';
import { mountOverlay } from './views/overlay.js';

const view = bridge.view || 'chrome';
const root = document.getElementById('app');

function applySettings(s) {
  const st = s.settings || {};
  document.documentElement.dir = st.dir || 'rtl';
  document.documentElement.lang = st.language || 'ar';
  setLang(st.language || 'ar');
  document.body.dataset.theme = st.theme || 'dark';
}

const mount = view === 'sidebar' ? mountSidebar : view === 'overlay' ? mountOverlay : mountChrome;
mount(root);

const initial = await bridge.getState();
applySettings(initial);
store.init(initial);
bridge.onState((s) => { applySettings(s); store.set(s); });
