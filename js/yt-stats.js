// Auto-populate YouTube stats on any page with [data-yt-stat] elements.
// Runs on brand-deals.html to replace placeholder subscriber + total-views
// numbers with live data from the YouTube Data API (cached 1hr server-side).
// Silently falls back to whatever the page already has (manual values from
// the content table) if the API is down or unconfigured.
(function () {
  'use strict';

  const targets = document.querySelectorAll('[data-yt-stat]');
  if (!targets.length) return;

  fetch('/api/youtube/stats', { credentials: 'same-origin' })
    .then(r => r.ok ? r.json() : Promise.reject(r.status))
    .then(data => {
      if (!data || data.ok === false) return;

      targets.forEach(el => {
        const stat = el.dataset.ytStat;
        if (stat === 'subscribers' && data.subscribersDisplay) {
          el.textContent = data.subscribersDisplay;
        } else if (stat === 'views' && data.viewsDisplay) {
          el.textContent = data.viewsDisplay;
        } else if (stat === 'videos' && typeof data.videoCount === 'number') {
          el.textContent = data.videoCount.toLocaleString('en-US');
        }
      });
    })
    .catch(() => { /* silent fallback — keep whatever the page had */ });
})();
