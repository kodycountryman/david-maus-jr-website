// Analytics tab logic — fetches /api/analytics/* endpoints and renders
// ApexCharts + lists. Lazy-initialized the first time the tab is opened.
(function () {
  'use strict';

  const SOURCE_LABELS = {
    youtube: 'YouTube',
    instagram: 'Instagram',
    tiktok: 'TikTok',
    twitter: 'Twitter / X',
    facebook: 'Facebook',
    google: 'Google',
    bing: 'Bing',
    duckduckgo: 'DuckDuckGo',
    beehiiv: 'Newsletter',
    reddit: 'Reddit',
    linkedin: 'LinkedIn',
    pinterest: 'Pinterest',
    direct: 'Direct',
    other: 'Other',
  };

  const SOURCE_COLORS = [
    '#FCDF4C', '#1A1616', '#D91A3A', '#801426', '#403939',
    '#A9A9A9', '#8A6F00', '#bfa80a', '#b22230', '#50505b',
    '#c2bcbc', '#f5cc00'
  ];

  const PAGE_LABELS = {
    '/': 'Home',
    '/index.html': 'Home',
    '/about.html': 'About',
    '/brand-deals.html': 'Brand Partnerships',
    '/product-picks.html': 'Product Picks',
    '/newsletter.html': 'Newsletter',
    '/contact.html': 'Contact',
  };

  // Country-code to flag emoji
  const flagOf = (cc) => {
    if (!cc || cc.length !== 2) return '🏳️';
    const A = 0x1F1E6, base = 'A'.charCodeAt(0);
    return String.fromCodePoint(A + cc.charCodeAt(0) - base) +
           String.fromCodePoint(A + cc.charCodeAt(1) - base);
  };

  const state = {
    range: 'month',
    metric: 'pageviews',
    initialized: false,
    refreshTimer: null,
    charts: { timeseries: null, sources: null },
  };

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  const api = (path) =>
    fetch(path, { credentials: 'same-origin' })
      .then(r => r.ok ? r.json() : Promise.reject(r.status));

  const fmt = (n) => Number(n || 0).toLocaleString('en-US');

  const fmtDelta = (pct) => {
    if (pct === 0) return '<span class="delta-flat">±0%</span>';
    if (pct > 0)  return `<span class="delta-up">↑ ${pct}%</span>`;
    return `<span class="delta-down">↓ ${Math.abs(pct)}%</span>`;
  };

  // Format timeseries bucket labels for display
  const fmtBucket = (label, range) => {
    if (range === 'day') {
      // "2026-04-17T14:00" → "2PM"
      const h = parseInt(label.slice(11, 13), 10);
      if (h === 0) return '12AM';
      if (h === 12) return '12PM';
      return (h > 12 ? h - 12 : h) + (h >= 12 ? 'PM' : 'AM');
    }
    if (range === 'week' || range === 'month') {
      // "2026-04-17" → "Apr 17"
      const d = new Date(label + 'T00:00');
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    if (range === 'year') {
      // "2026-04" → "Apr"
      const d = new Date(label + '-01T00:00');
      return d.toLocaleDateString('en-US', { month: 'short' });
    }
    return label;
  };

  // =========================================================================
  // Tab lifecycle: hook into the admin tab system
  // =========================================================================
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.admin-tab[data-tab="analytics"]');
    if (!btn) return;
    if (!state.initialized) {
      state.initialized = true;
      setupControls();
      refreshAll();
    }
    // Start auto-refresh poll for active users + data while tab is open
    startAutoRefresh();
  });

  // Stop auto-refresh when switching away
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.admin-tab');
    if (!btn) return;
    if (btn.dataset.tab !== 'analytics') stopAutoRefresh();
  });

  function startAutoRefresh() {
    stopAutoRefresh();
    // Faster loop for the live feed + active count (every 10s)
    state.refreshTimer = setInterval(() => {
      if (!document.hidden && !document.getElementById('tab-analytics')?.hidden) {
        refreshActiveUsers();
        refreshLive();
      }
    }, 10000);
  }
  function stopAutoRefresh() {
    if (state.refreshTimer) clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }

  // =========================================================================
  // Controls: range toggle, metric toggle, refresh, search
  // =========================================================================
  function setupControls() {
    $$('.range-btn').forEach(b => {
      b.addEventListener('click', () => {
        $$('.range-btn').forEach(x => x.classList.toggle('active', x === b));
        state.range = b.dataset.range;
        refreshAll();
      });
    });
    $$('.metric-btn').forEach(b => {
      b.addEventListener('click', () => {
        $$('.metric-btn').forEach(x => x.classList.toggle('active', x === b));
        state.metric = b.dataset.metric;
        refreshTimeseries();
      });
    });
    $('#refresh-analytics')?.addEventListener('click', () => refreshAll());
    $('#export-analytics')?.addEventListener('click', openExportModal);

    const search = $('#products-search');
    search?.addEventListener('input', () => filterProducts(search.value));

    $$('.sortable').forEach(th => {
      th.addEventListener('click', () => sortProductsBy(th.dataset.sort));
    });
  }

  // =========================================================================
  // Refresh orchestration
  // =========================================================================
  async function refreshAll() {
    const r = state.range;
    await Promise.all([
      refreshOverview(r),
      refreshTimeseries(),
      refreshSources(r),
      refreshPages(r),
      refreshDevices(r),
      refreshCountries(r),
      refreshProducts(r),
      refreshLive(),
      refreshReferrers(r),
      refreshHeatmap(r),
    ]);
  }

  async function refreshActiveUsers() {
    try {
      const d = await api('/api/analytics/overview?range=' + state.range);
      $('#active-count').textContent = d.activeNow;
    } catch {}
  }

  // =========================================================================
  // Individual sections
  // =========================================================================
  async function refreshOverview(range) {
    try {
      const d = await api('/api/analytics/overview?range=' + range);
      $('#stat-pv').textContent = fmt(d.pageviews);
      $('#stat-uv').textContent = fmt(d.uniqueVisitors);
      $('#stat-clicks').textContent = fmt(d.clicks);
      $('#stat-ctr').textContent = (d.ctr || 0).toFixed(1) + '%';
      $('#stat-pv-delta').innerHTML = fmtDelta(d.deltaPageviewsPct);
      $('#stat-clicks-delta').innerHTML = fmtDelta(d.deltaClicksPct);
      $('#active-count').textContent = d.activeNow;
      if ($('#stat-new')) $('#stat-new').textContent = fmt(d.newVisitors);
      if ($('#stat-returning')) $('#stat-returning').textContent = fmt(d.returningVisitors);
      if ($('#stat-conversion')) $('#stat-conversion').textContent = (d.conversionRate || 0).toFixed(1) + '%';
      if ($('#stat-conversion-sub')) {
        $('#stat-conversion-sub').textContent = d.picksVisitors
          ? `${fmt(d.picksConverted)} of ${fmt(d.picksVisitors)} picks visitors`
          : 'Of visitors to /product-picks';
      }
    } catch {
      ['stat-pv','stat-uv','stat-clicks','stat-ctr','stat-new','stat-returning','stat-conversion'].forEach(id => { const e = $('#' + id); if (e) e.textContent = '0'; });
    }
  }

  async function refreshTimeseries() {
    const el = document.getElementById('timeseries-chart');
    if (!el) return;
    try {
      const d = await api(`/api/analytics/timeseries?range=${state.range}&metric=${state.metric}`);
      const categories = d.series.map(p => fmtBucket(p.bucket, state.range));
      const data = d.series.map(p => p.count);
      const options = {
        chart: { type: 'area', height: 300, toolbar: { show: false }, fontFamily: 'Montserrat, sans-serif' },
        series: [{ name: state.metric === 'clicks' ? 'Clicks' : 'Pageviews', data }],
        xaxis: { categories, labels: { style: { fontSize: '11px' } } },
        yaxis: { labels: { style: { fontSize: '11px' }, formatter: (v) => fmt(Math.round(v)) } },
        colors: ['#FCDF4C'],
        fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.7, opacityTo: 0.1, stops: [0, 90, 100] } },
        stroke: { curve: 'smooth', width: 3 },
        dataLabels: { enabled: false },
        grid: { borderColor: '#eee', strokeDashArray: 4, padding: { top: 0, right: 10 } },
        tooltip: { theme: 'dark' },
        noData: { text: 'No data yet for this range', style: { color: '#6b6b6b', fontSize: '14px' } },
      };
      if (state.charts.timeseries) {
        state.charts.timeseries.updateOptions(options);
      } else if (window.ApexCharts) {
        state.charts.timeseries = new ApexCharts(el, options);
        state.charts.timeseries.render();
      } else {
        // CDN not yet loaded — try again after a tick
        setTimeout(refreshTimeseries, 400);
      }
    } catch {
      el.innerHTML = '<div class="empty-state">Couldn\'t load chart</div>';
    }
  }

  async function refreshSources(range) {
    const el = document.getElementById('sources-chart');
    const list = document.getElementById('sources-list');
    if (!el || !list) return;
    try {
      const d = await api('/api/analytics/sources?range=' + range);
      const sources = d.sources || [];
      if (!sources.length) {
        list.innerHTML = '<li class="empty-state">No visits yet</li>';
        el.innerHTML = '';
        return;
      }
      const labels = sources.map(s => SOURCE_LABELS[s.source] || s.source);
      const data = sources.map(s => s.views);
      const total = data.reduce((a, b) => a + b, 0);

      const options = {
        chart: { type: 'donut', height: 240, fontFamily: 'Montserrat, sans-serif' },
        series: data,
        labels,
        colors: SOURCE_COLORS,
        legend: { show: false },
        stroke: { width: 2, colors: ['#fff'] },
        plotOptions: {
          pie: {
            donut: {
              size: '62%',
              labels: {
                show: true,
                total: { show: true, label: 'Total', formatter: () => fmt(total) },
                value: { fontSize: '20px', fontWeight: 800 }
              }
            }
          }
        },
        dataLabels: { enabled: false },
        tooltip: { theme: 'dark', y: { formatter: (v) => fmt(v) + ' views' } },
      };
      if (state.charts.sources) {
        state.charts.sources.updateOptions(options);
      } else if (window.ApexCharts) {
        state.charts.sources = new ApexCharts(el, options);
        state.charts.sources.render();
      } else {
        setTimeout(() => refreshSources(range), 400);
      }

      list.innerHTML = sources.map((s, i) => {
        const pct = total ? Math.round((s.views / total) * 100) : 0;
        return `<li>
          <span class="legend-swatch" style="background:${SOURCE_COLORS[i % SOURCE_COLORS.length]}"></span>
          <span class="legend-label">${SOURCE_LABELS[s.source] || s.source}</span>
          <span class="legend-val">${fmt(s.views)}</span>
          <span class="legend-pct">${pct}%</span>
        </li>`;
      }).join('');
    } catch {
      list.innerHTML = '<li class="empty-state">Couldn\'t load</li>';
    }
  }

  async function refreshPages(range) {
    const list = document.getElementById('pages-list');
    if (!list) return;
    try {
      const d = await api('/api/analytics/pages?range=' + range);
      const pages = d.pages || [];
      if (!pages.length) {
        list.innerHTML = '<li class="empty-state">No data yet</li>';
        return;
      }
      const max = Math.max(...pages.map(p => p.views));
      list.innerHTML = pages.map(p => {
        const label = PAGE_LABELS[p.path] || p.path;
        const pct = max ? (p.views / max) * 100 : 0;
        return `<li>
          <span class="rank-label">${escapeHtml(label)}</span>
          <span class="rank-bar"><span class="rank-bar-fill" style="width:${pct}%"></span></span>
          <span class="rank-val">${fmt(p.views)}</span>
        </li>`;
      }).join('');
    } catch {
      list.innerHTML = '<li class="empty-state">Couldn\'t load</li>';
    }
  }

  async function refreshDevices(range) {
    const list = document.getElementById('devices-list');
    if (!list) return;
    try {
      const d = await api('/api/analytics/devices?range=' + range);
      const total = (d.mobile || 0) + (d.desktop || 0) + (d.tablet || 0);
      if (!total) {
        list.innerHTML = '<li class="empty-state">No data yet</li>';
        return;
      }
      const row = (icon, label, count) => {
        const pct = total ? Math.round((count / total) * 100) : 0;
        return `<li>
          <span class="device-icon">${icon}</span>
          <span class="device-label">${label}</span>
          <span class="device-bar"><span class="device-bar-fill" style="width:${pct}%"></span></span>
          <span class="device-pct">${pct}%</span>
        </li>`;
      };
      list.innerHTML =
        row('📱', 'Mobile', d.mobile) +
        row('💻', 'Desktop', d.desktop) +
        row('📟', 'Tablet', d.tablet);
    } catch {
      list.innerHTML = '<li class="empty-state">Couldn\'t load</li>';
    }
  }

  async function refreshCountries(range) {
    const list = document.getElementById('countries-list');
    if (!list) return;
    try {
      const d = await api('/api/analytics/countries?range=' + range);
      const countries = d.countries || [];
      if (!countries.length) {
        list.innerHTML = '<li class="empty-state">No data yet</li>';
        return;
      }
      const max = Math.max(...countries.map(c => c.views));
      list.innerHTML = countries.map(c => {
        const pct = max ? (c.views / max) * 100 : 0;
        return `<li>
          <span class="rank-label">${flagOf(c.country)} ${escapeHtml(c.country)}</span>
          <span class="rank-bar"><span class="rank-bar-fill" style="width:${pct}%"></span></span>
          <span class="rank-val">${fmt(c.views)}</span>
        </li>`;
      }).join('');
    } catch {
      list.innerHTML = '<li class="empty-state">Couldn\'t load</li>';
    }
  }

  // Product clicks table
  const productsState = { rows: [], filter: '', sortKey: 'clicks', sortDesc: true };

  async function refreshProducts(range) {
    const body = document.getElementById('products-tbody');
    if (!body) return;
    try {
      const d = await api('/api/analytics/products?range=' + range);
      productsState.rows = d.products || [];
      renderProductsTable();
    } catch {
      body.innerHTML = '<tr><td colspan="4" class="empty-state">Couldn\'t load</td></tr>';
    }
  }

  function filterProducts(q) {
    productsState.filter = (q || '').toLowerCase().trim();
    renderProductsTable();
  }

  function sortProductsBy(key) {
    if (productsState.sortKey === key) {
      productsState.sortDesc = !productsState.sortDesc;
    } else {
      productsState.sortKey = key;
      productsState.sortDesc = true;
    }
    $$('.sortable').forEach(th => {
      const arrow = th.querySelector('.sort-arrow');
      if (!arrow) return;
      if (th.dataset.sort === productsState.sortKey) {
        arrow.textContent = productsState.sortDesc ? '↓' : '↑';
        th.classList.add('sort-active');
      } else {
        arrow.textContent = '';
        th.classList.remove('sort-active');
      }
    });
    renderProductsTable();
  }

  const CAT_LABELS = {
    'diy-kits': 'DIY Kits',
    'cold-plunge': 'Cold Plunge',
    'saunas': 'Saunas',
    'performance': 'Performance',
    'health': 'Health Optimization',
    'gear': 'Gear & Wearables',
    'supps': 'Supps & Snacks',
    'pets': 'Pets'
  };

  function renderProductsTable() {
    const body = document.getElementById('products-tbody');
    if (!body) return;
    const q = productsState.filter;
    let rows = q
      ? productsState.rows.filter(r => (r.title + ' ' + r.category).toLowerCase().includes(q))
      : productsState.rows.slice();
    const key = productsState.sortKey;
    const dir = productsState.sortDesc ? -1 : 1;
    rows.sort((a, b) => ((a[key] || 0) - (b[key] || 0)) * dir);

    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="5" class="empty-state">No products</td></tr>';
      return;
    }
    body.innerHTML = rows.map(r => {
      const src = r.top_source
        ? `<span class="source-badge" data-source="${escapeHtml(r.top_source)}">${escapeHtml(SOURCE_LABELS[r.top_source] || r.top_source)}</span>`
        : '<span class="source-badge-empty">—</span>';
      return `
        <tr>
          <td class="title-cell">${escapeHtml(r.title)}${r.code ? ` <span class="code-pill-sm">${escapeHtml(r.code)}</span>` : ''}</td>
          <td><span class="cat-pill">${escapeHtml(CAT_LABELS[r.category] || r.category)}</span></td>
          <td>${src}</td>
          <td class="num-cell">${fmt(r.clicks)}</td>
          <td class="num-cell">${fmt(r.allTimeClicks)}</td>
        </tr>
      `;
    }).join('');
  }

  // =========================================================================
  // Live activity feed
  // =========================================================================
  const timeAgo = (isoUTC) => {
    // D1 datetime() returns UTC with no timezone — treat as Z
    const d = new Date((isoUTC || '').replace(' ', 'T') + 'Z');
    const s = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
    if (s < 5) return 'just now';
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  };

  const DEVICE_ICON = { mobile: '📱', desktop: '💻', tablet: '📟' };

  async function refreshLive() {
    const feed = document.getElementById('live-feed');
    if (!feed) return;
    try {
      const d = await api('/api/analytics/live?limit=40');
      const events = d.events || [];
      if (!events.length) {
        feed.innerHTML = '<li class="empty-state">No activity yet</li>';
        return;
      }
      feed.innerHTML = events.map(e => {
        const isClick = e.type === 'click';
        const icon = isClick ? '🛒' : '👁';
        const tag = isClick
          ? `<span class="live-tag live-click">Click</span>`
          : `<span class="live-tag live-view">View</span>`;
        const detail = isClick
          ? escapeHtml(e.product_title || e.detail || 'product')
          : escapeHtml(PAGE_LABELS[e.detail] || e.detail);
        const src = SOURCE_LABELS[e.referrer_source] || e.referrer_source || '—';
        const country = e.country ? `${flagOf(e.country)} ${escapeHtml(e.country)}` : '';
        return `
          <li class="live-row">
            <span class="live-icon">${icon}</span>
            <span class="live-body">
              <div class="live-detail">${tag} ${detail}</div>
              <div class="live-meta">
                <span class="live-source" data-source="${escapeHtml(e.referrer_source || 'other')}">${escapeHtml(src)}</span>
                <span class="live-dev">${DEVICE_ICON[e.device] || '•'} ${escapeHtml(e.device || '')}</span>
                <span class="live-country">${country}</span>
              </div>
            </span>
            <span class="live-time">${timeAgo(e.created_at)}</span>
          </li>
        `;
      }).join('');
    } catch {
      feed.innerHTML = '<li class="empty-state">Couldn\'t load</li>';
    }
  }

  // =========================================================================
  // Top referring URLs
  // =========================================================================
  function prettyHost(url) {
    try {
      const u = new URL(url);
      return u.hostname.replace(/^www\./, '') + (u.pathname !== '/' ? u.pathname : '');
    } catch {
      return url;
    }
  }

  async function refreshReferrers(range) {
    const list = document.getElementById('referrers-list');
    if (!list) return;
    try {
      const d = await api('/api/analytics/referrers?range=' + range);
      const refs = d.referrers || [];
      if (!refs.length) {
        list.innerHTML = '<li class="empty-state">No external referrers yet</li>';
        return;
      }
      const max = Math.max(...refs.map(r => r.views));
      list.innerHTML = refs.map(r => {
        const pct = max ? (r.views / max) * 100 : 0;
        const pretty = prettyHost(r.url);
        const label = SOURCE_LABELS[r.source] || r.source;
        return `
          <li class="referrer-row">
            <span class="source-badge" data-source="${escapeHtml(r.source)}">${escapeHtml(label)}</span>
            <a class="referrer-url" href="${escapeHtml(r.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(r.url)}">${escapeHtml(pretty)}</a>
            <span class="referrer-bar"><span class="referrer-bar-fill" style="width:${pct}%"></span></span>
            <span class="referrer-val">${fmt(r.views)}</span>
          </li>
        `;
      }).join('');
    } catch {
      list.innerHTML = '<li class="empty-state">Couldn\'t load</li>';
    }
  }

  // =========================================================================
  // Peak-activity heatmap (7 days × 24 hours)
  // =========================================================================
  const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  async function refreshHeatmap(range) {
    const el = document.getElementById('heatmap');
    if (!el) return;
    try {
      const d = await api('/api/analytics/heatmap?range=' + range);
      const grid = d.grid || [];
      const max = d.max || 0;
      if (!max) {
        el.innerHTML = '<div class="empty-state" style="padding:20px;">No data yet</div>';
        return;
      }
      // Build header row (hours)
      const hourHeader = ['<div class="hm-corner"></div>'];
      for (let h = 0; h < 24; h++) {
        const label = (h % 3 === 0) ? (h === 0 ? '12a' : h === 12 ? '12p' : h > 12 ? (h - 12) + 'p' : h + 'a') : '';
        hourHeader.push(`<div class="hm-hour">${label}</div>`);
      }
      const rows = [hourHeader.join('')];
      for (let dow = 0; dow < 7; dow++) {
        const cells = [`<div class="hm-day">${DAY_LABELS[dow]}</div>`];
        for (let h = 0; h < 24; h++) {
          const v = grid[dow] ? grid[dow][h] || 0 : 0;
          const intensity = max ? v / max : 0;
          // Use color-mix-style bg opacity
          const bg = v === 0 ? '#f0f0f0' : `rgba(252, 223, 76, ${0.15 + intensity * 0.85})`;
          const border = v > 0 ? '#f0d740' : 'transparent';
          cells.push(`<div class="hm-cell" style="background:${bg};border-color:${border}" title="${DAY_LABELS[dow]} ${h}:00 — ${fmt(v)} views"></div>`);
        }
        rows.push(cells.join(''));
      }
      el.innerHTML = rows.join('');
    } catch {
      el.innerHTML = '<div class="empty-state">Couldn\'t load</div>';
    }
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // =========================================================================
  // CSV Export Modal
  // =========================================================================
  const EXPORT_SECTIONS = [
    { key: 'overview',   label: 'Overview',              desc: 'Pageviews, unique visitors, clicks, CTR, conversion, new/returning' },
    { key: 'timeseries', label: 'Pageviews over time',   desc: 'Time-bucketed pageviews + product clicks for the selected range' },
    { key: 'sources',    label: 'Traffic sources',       desc: 'Which networks are sending traffic (YouTube, Instagram, etc.)' },
    { key: 'pages',      label: 'Top pages',             desc: 'Most-viewed pages with unique visitor counts' },
    { key: 'countries',  label: 'Top countries',         desc: 'Where visitors are located' },
    { key: 'devices',    label: 'Device breakdown',      desc: 'Mobile / desktop / tablet' },
    { key: 'products',   label: 'Product clicks',        desc: 'Every product with period + all-time clicks + top referring source' },
    { key: 'referrers',  label: 'Top referring URLs',    desc: 'Specific videos / posts / newsletter issues driving traffic' },
    { key: 'heatmap',    label: 'Peak activity heatmap', desc: '7×24 grid of pageviews by day-of-week + hour' },
  ];

  // Remember last selection across opens
  let lastSelected = null;

  function openExportModal() {
    const backdrop = document.getElementById('modal-backdrop');
    const modal = document.getElementById('modal');
    if (!backdrop || !modal) return;

    const selected = lastSelected || new Set(EXPORT_SECTIONS.map(s => s.key));

    modal.innerHTML = `
      <div class="modal-header">
        <h3>Export Analytics (CSV)</h3>
        <button class="modal-close" data-close>&times;</button>
      </div>
      <div class="modal-body">
        <p style="color:var(--muted); font-size:13px; margin-bottom:16px;">
          Pick which sections to include. You can open the CSV in Excel, Google Sheets, or send it straight to a brand.
        </p>
        <div class="export-range-pill">
          <span class="export-range-label">Range:</span>
          <strong>${state.range.charAt(0).toUpperCase() + state.range.slice(1)}</strong>
          <span style="color:var(--muted); font-size:12px;">(change above to modify)</span>
        </div>
        <div class="export-presets">
          <button type="button" class="preset-btn" data-preset="all">Select all</button>
          <button type="button" class="preset-btn" data-preset="none">Clear</button>
          <button type="button" class="preset-btn" data-preset="brand">For brand pitch</button>
        </div>
        <ul class="export-checklist">
          ${EXPORT_SECTIONS.map(s => `
            <li>
              <label class="export-check">
                <input type="checkbox" value="${s.key}" ${selected.has(s.key) ? 'checked' : ''}>
                <span class="export-check-body">
                  <span class="export-check-label">${escapeHtml(s.label)}</span>
                  <span class="export-check-desc">${escapeHtml(s.desc)}</span>
                </span>
              </label>
            </li>
          `).join('')}
        </ul>
      </div>
      <div class="modal-footer">
        <span class="export-count" id="export-count"></span>
        <div style="flex:1;"></div>
        <button class="btn btn-ghost" data-close>Cancel</button>
        <button class="btn btn-yellow" id="do-export">Download CSV</button>
      </div>
    `;
    backdrop.hidden = false;

    const checks = modal.querySelectorAll('input[type="checkbox"]');
    const countEl = modal.querySelector('#export-count');
    const updateCount = () => {
      const n = [...checks].filter(c => c.checked).length;
      countEl.textContent = n ? `${n} section${n === 1 ? '' : 's'} selected` : 'Pick at least one section';
      modal.querySelector('#do-export').disabled = n === 0;
    };
    checks.forEach(c => c.addEventListener('change', updateCount));
    updateCount();

    // Presets
    modal.querySelectorAll('[data-preset]').forEach(b => {
      b.addEventListener('click', () => {
        const p = b.dataset.preset;
        if (p === 'all') {
          checks.forEach(c => c.checked = true);
        } else if (p === 'none') {
          checks.forEach(c => c.checked = false);
        } else if (p === 'brand') {
          // Brand pitch: high-signal summary (no raw timeseries / heatmap)
          const brandSet = new Set(['overview', 'sources', 'pages', 'countries', 'devices', 'products', 'referrers']);
          checks.forEach(c => c.checked = brandSet.has(c.value));
        }
        updateCount();
      });
    });

    // Close buttons
    modal.querySelectorAll('[data-close]').forEach(b => {
      b.addEventListener('click', () => { backdrop.hidden = true; modal.innerHTML = ''; });
    });
    backdrop.addEventListener('click', function onBg(e) {
      if (e.target === backdrop) {
        backdrop.hidden = true;
        modal.innerHTML = '';
        backdrop.removeEventListener('click', onBg);
      }
    });

    // Export action
    modal.querySelector('#do-export').addEventListener('click', () => {
      const include = [...checks].filter(c => c.checked).map(c => c.value);
      if (!include.length) return;
      lastSelected = new Set(include);
      const url = `/api/analytics/export?range=${encodeURIComponent(state.range)}&include=${encodeURIComponent(include.join(','))}`;
      const a = document.createElement('a');
      a.href = url;
      a.download = '';
      document.body.appendChild(a);
      a.click();
      a.remove();
      backdrop.hidden = true;
      modal.innerHTML = '';
    });
  }
})();
