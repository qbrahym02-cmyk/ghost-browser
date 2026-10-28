/** غلاف رقيق حول جسر Ghost + حالة مشتركة للعرض. */
export const bridge = window.ghost;

export const store = {
  state: null,
  listeners: new Set(),
  init(state) {
    this.state = state;
    this.notify();
  },
  set(state) {
    this.state = state;
    this.notify();
  },
  notify() {
    for (const fn of this.listeners) fn(this.state);
  },
  subscribe(fn) {
    this.listeners.add(fn);
    if (this.state) fn(this.state);
    return () => this.listeners.delete(fn);
  },
};

export const action = (type, args) => bridge.action(type, args);

export function activeTab(state) {
  return (state.tabs || []).find((t) => t.id === state.activeTabId) || null;
}
export function groupOf(state, id) {
  return (state.groups || []).find((g) => g.id === id) || null;
}

/** ساعة حية بتوقيت هوية القروب. */
export function tzClock(timezone) {
  try {
    return new Intl.DateTimeFormat('ar-EG', {
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone,
    }).format(new Date());
  } catch {
    return '--:--';
  }
}

export function timeAgo(ts, langCode = 'ar') {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return langCode === 'ar' ? 'الآن' : 'now';
  if (m < 60) return langCode === 'ar' ? `قبل ${m} د` : `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return langCode === 'ar' ? `قبل ${h} س` : `${h}h ago`;
  return new Date(ts).toLocaleDateString(langCode === 'ar' ? 'ar-EG' : 'en-US');
}
