/** preload وهمي لأداة اللقطات: يوفّر جسر ghost بحالة ثابتة. */
const { contextBridge, ipcRenderer } = require('electron');
void ipcRenderer;

const arg = (process.argv || []).find((a) => typeof a === 'string' && a.startsWith('--ghost-view='));
let view = arg ? arg.split('=')[1] : null;
if (!view && typeof location !== 'undefined') {
  view = new URL(location.href).searchParams.get('view') || 'chrome';
}
view = view || 'chrome';
const mockArg = (process.argv || []).find((a) => typeof a === 'string' && a.startsWith('--ghost-mock='));
let mock = { state: {} };
try { mock = JSON.parse(mockArg.slice('--ghost-mock='.length)); } catch { /* افتراضي */ }

const overlayKind = (typeof location !== 'undefined' && new URL(location.href).searchParams.get('mock-overlay')) || null;
if (overlayKind && mock.state && mock.state.ui) mock.state.ui.overlayStack = [{ kind: overlayKind, params: {} }];

const listeners = new Set();
contextBridge.exposeInMainWorld('ghost', {
  view,
  getState: async () => mock.state,
  action: async (type, args) => { console.log('[mock-action]', type, JSON.stringify(args || {})); return true; },
  onState: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
  onEvent: () => () => {},
});

contextBridge.exposeInMainWorld('ghostBridge', {
  getTabId: async () => (mock.state.tabs && mock.state.tabs[0] ? mock.state.tabs[0].id : null),
  getState: async () => mock.state,
  action: async (type, args) => { console.log('[mock-action]', type, JSON.stringify(args || {})); return true; },
  onState: () => () => {},
  onEvent: () => () => {},
});
