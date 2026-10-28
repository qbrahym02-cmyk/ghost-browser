/** مدير تحميلات بسيط: شريط حالة + أوامر فتح/إلغاء/عرض. */
const path = require('node:path');
const fs = require('node:fs');
const { app, shell } = require('electron');
const crypto = require('node:crypto');

function handleItem(state, item) {
  const id = crypto.randomBytes(4).toString('base64url');
  const name = item.getFilename();
  const dest = path.join(app.getPath('downloads'), name);
  item.setSavePath(dest);
  const rec = {
    id,
    name,
    path: dest,
    total: item.getTotalBytes(),
    received: 0,
    state: 'progress',
    url: item.getURL(),
    startedAt: Date.now(),
  };
  state.mutate((s) => { s.downloads.unshift(rec); s.downloads = s.downloads.slice(0, 40); });

  item.on('updated', (e, st) => {
    rec.state = st === 'interrupted' ? 'interrupted' : 'progress';
    rec.received = item.getReceivedBytes();
    state.emit();
  });
  item.once('done', (e, st) => {
    rec.state = st === 'completed' ? 'done' : st === 'cancelled' ? 'cancelled' : 'failed';
    rec.received = item.getReceivedBytes();
    state.emit();
    if (st === 'completed') state.sendEvent('toast', { kind: 'ok', text: `اكتمل التحميل: ${name}` });
  });
  registry.set(id, { rec, cancelFn: () => { try { item.cancel(); } catch { /* تجاهل */ } } });
}

const registry = new Map();

function open(id) {
  const rec = registry.get(id)?.rec;
  if (rec && fs.existsSync(rec.path)) shell.openPath(rec.path);
}
function show(id) {
  const rec = registry.get(id)?.rec;
  if (rec && fs.existsSync(rec.path)) shell.showItemInFolder(rec.path);
}
function cancel(id) {
  const e = registry.get(id);
  if (e && e.cancelFn) e.cancelFn();
}

module.exports = { handleItem, open, show, cancel };
