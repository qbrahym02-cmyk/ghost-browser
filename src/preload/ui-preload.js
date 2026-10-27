/**
 * جسر واجهات Ghost (الشريط/الجانبي/الطبقة العلوية).
 * معزول: لا node في الواجهة، فقط API مصغّر عبر contextBridge.
 */
const { contextBridge, ipcRenderer } = require('electron');

const arg = (process.argv || []).find((a) => typeof a === 'string' && a.startsWith('--ghost-view='));
const view = arg ? arg.split('=')[1] : 'chrome';

contextBridge.exposeInMainWorld('ghost', {
  view,
  getState: () => ipcRenderer.invoke('ghost:get-state'),
  action: (type, args) => ipcRenderer.invoke('ghost:action', Object.assign({ type }, args || {})),
  onState: (cb) => {
    const listener = (_e, state) => cb(state);
    ipcRenderer.on('ghost:state', listener);
    return () => ipcRenderer.removeListener('ghost:state', listener);
  },
  onEvent: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('ghost:event', listener);
    return () => ipcRenderer.removeListener('ghost:event', listener);
  },
});
