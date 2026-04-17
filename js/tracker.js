// Site analytics tracker — sends pageview + click beacons to /api/track/*
// Lightweight: no deps, ~1KB min, uses navigator.sendBeacon so it never
// blocks navigation. Skips admin pages and logged-in admins.
(function () {
  'use strict';

  // Skip admin
  if (location.pathname.startsWith('/admin')) return;
  try { if (sessionStorage.getItem('dmj_is_admin') === '1') return; } catch {}

  // Per-tab session id (lives until tab closes)
  let sid;
  try {
    sid = sessionStorage.getItem('dmj_sid');
    if (!sid) {
      sid = crypto.randomUUID ? crypto.randomUUID()
                              : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
                                  const r = Math.random() * 16 | 0;
                                  const v = c === 'x' ? r : (r & 0x3 | 0x8);
                                  return v.toString(16);
                                });
      sessionStorage.setItem('dmj_sid', sid);
    }
  } catch {
    sid = 'nostorage-' + Math.random().toString(36).slice(2, 14);
  }

  const send = (path, payload) => {
    const body = JSON.stringify(payload);
    try {
      if (navigator.sendBeacon) {
        const blob = new Blob([body], { type: 'application/json' });
        if (navigator.sendBeacon(path, blob)) return;
      }
    } catch {}
    // Fallback: fire-and-forget fetch
    fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  };

  // Fire pageview on load
  const firePageview = () => {
    send('/api/track/pageview', {
      path: location.pathname + location.search,
      referrer: document.referrer || '',
      session_id: sid,
    });
  };

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    firePageview();
  } else {
    document.addEventListener('DOMContentLoaded', firePageview, { once: true });
  }

  // Intercept product "Shop Now" clicks. Uses event delegation so it works
  // even though products are rendered by products-loader.js after load.
  document.addEventListener('click', (e) => {
    const anchor = e.target.closest('.product-card a.btn-yellow');
    if (!anchor) return;
    const card = anchor.closest('.product-card');
    const pid = card && card.dataset.productId;
    if (!pid) return;
    send('/api/track/click', {
      product_id: parseInt(pid, 10),
      referrer: document.referrer || '',
      session_id: sid,
    });
    // Don't preventDefault — link continues as normal
  }, { capture: true });
})();
