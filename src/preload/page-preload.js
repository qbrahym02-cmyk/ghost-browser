/**
 * preload صفحات الويب. لا يلمس الصفحات العادية إطلاقاً (البصمة تُحقن عبر CDP).
 * يفعّل جسراً مصغّراً للصفحات الداخلية ghost:// فقط (التحقق من البروتوكول آمن
 * لأن صفحة بعيدة لا تستطيع انتحال protocol الخاص بها).
 */
const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'ghost:') {
  contextBridge.exposeInMainWorld('ghostBridge', {
    getTabId: () => ipcRenderer.invoke('ghost:whoami'),
    getState: () => ipcRenderer.invoke('ghost:get-state'),
    action: (type, args) => ipcRenderer.invoke('ghost:action', Object.assign({ type }, args || {})),
    onState: (cb) => {
      const l = (_e, s) => cb(s);
      ipcRenderer.on('ghost:state', l);
      return () => ipcRenderer.removeListener('ghost:state', l);
    },
    onEvent: (cb) => {
      const l = (_e, p) => cb(p);
      ipcRenderer.on('ghost:event', l);
      return () => ipcRenderer.removeListener('ghost:event', l);
    },
  });
}
