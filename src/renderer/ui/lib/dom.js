/** مساعدات DOM صغيرة بدون مكتبات. */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function svg(paths, size = 16, viewBox = '0 0 24 24') {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', viewBox);
  s.setAttribute('width', size);
  s.setAttribute('height', size);
  s.setAttribute('class', 'icon');
  s.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    s.append(p);
  }
  return s;
}

/** أيقونات الخط (stroke) بصيغة مسارات مبسّطة. */
export const ICONS = {
  back: ['M15 18l-6-6 6-6'],
  forward: ['M9 18l6-6-6-6'],
  reload: ['M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6'],
  shield: ['M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6l7-3z'],
  shieldOff: ['M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6l7-3z', 'M4 4l16 16'],
  plus: ['M12 5v14M5 12h14'],
  x: ['M6 6l12 12M18 6L6 18'],
  star: ['M12 3l2.7 5.8 6.3.8-4.6 4.3 1.2 6.1-5.6-3-5.6 3 1.2-6.1L3 9.6l6.3-.8L12 3z'],
  menu: ['M4 7h16M4 12h16M4 17h16'],
  ghost: ['M12 3a7 7 0 0 0-7 7v10l2.5-2 2.5 2 2-2 2 2 2.5-2 2.5 2V10a7 7 0 0 0-7-7z', 'M9.5 10h.01M14.5 10h.01'],
  lock: ['M6 11h12v9H6z', 'M9 11V8a3 3 0 0 1 6 0v3'],
  globe: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M3 12h18', 'M12 3c2.5 2.5 3.8 5.6 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.6-3.8-9s1.3-6.5 3.8-9z'],
  download: ['M12 4v11m0 0l-4-4m4 4l4-4', 'M5 20h14'],
  settings: ['M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', 'M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.7a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2l.4 2.7h4l.4-2.7a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z'],
  search: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'M20 20l-4-4'],
  trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13'],
  copy: ['M9 9h11v11H9z', 'M5 15H4V4h11v1'],
  freeze: ['M12 3v18M5 6l14 12M19 6L5 18'],
  bolt: ['M13 2L4 14h6l-1 8 9-12h-6l1-8z'],
  chevron: ['M9 6l6 6-6 6'],
  check: ['M5 13l4 4L19 7'],
  warn: ['M12 3l10 18H2L12 3z', 'M12 10v5', 'M12 18h.01'],
  eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
  clock: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 7v5l3 3'],
  min: ['M5 12h14'],
  max: ['M5 5h14v14H5z'],
  restore: ['M5 9h10v10H5z', 'M9 5h10v10'],
  palette: ['M12 3a9 9 0 1 0 0 18h1.5a2.5 2.5 0 0 0 0-5H12a2 2 0 0 1 0-4h6a3 3 0 0 0 3-3 9 9 0 0 0-9-6z'],
  camera: ['M4 8h3l2-3h6l2 3h3v11H4z', 'M12 11a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
  book: ['M4 5a2 2 0 0 1 2-2h14v18H6a2 2 0 0 0-2 2V5z', 'M8 3v18'],
  layers: ['M12 3l9 5-9 5-9-5 9-5z', 'M3 13l9 5 9-5'],
  refresh: ['M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6'],
  external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 13v7H4V6h7'],
  mute: ['M4 10v4h4l5 4V6l-5 4H4z', 'M17 9l4 6M21 9l-4 6'],
  speaker: ['M4 10v4h4l5 4V6l-5 4H4z', 'M16 9a4 4 0 0 1 0 6'],
  split: ['M4 5h7v14H4z', 'M13 5h7v14h-7z'],
  translate: ['M5 8l6 6', 'M4 14l6-6 2-3', 'M2 5h12', 'M7 2h1', 'M22 22l-5-10-5 10', 'M14 18h6'],
  qr: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h3v3h-3z', 'M19 14h1v1h-1z', 'M17 17h3v3h-3z', 'M14 19h1v1h-1z'],
  note: ['M5 4h14v13l-4 4H5z', 'M9 9h6M9 13h4'],
};

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function debounce(fn, ms = 120) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
