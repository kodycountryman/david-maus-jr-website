// Product grid loader — only runs on product-picks.html.
// Fetches products from /api/products, groups by category, renders into
// #picks-grid using the same markup the static HTML used (so existing CSS +
// tab-filter logic work unchanged).

(function () {
  'use strict';

  const grid = document.getElementById('picks-grid');
  if (!grid) return;

  const CATEGORIES = [
    { slug: 'diy-kits', label: 'DIY Kits' },
    { slug: 'cold-plunge', label: 'Cold Plunge' },
    { slug: 'saunas', label: 'Saunas' },
    { slug: 'performance', label: 'Performance' },
    { slug: 'health', label: 'Health Optimization' },
    { slug: 'gear', label: 'Gear & Wearables' },
    { slug: 'supps', label: 'Supps & Snacks' },
    { slug: 'pets', label: 'Pets' }
  ];

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function renderCard(p) {
    const imgHtml = p.image_url
      ? `<div class="placeholder-img"><img src="${escapeHtml(p.image_url)}" alt="${escapeHtml(p.title)}"></div>`
      : `<div class="placeholder-img">Product Image</div>`;

    const codeHtml = p.code
      ? `<div class="product-code">Use Code: ${escapeHtml(p.code)}</div>`
      : '';

    const href = p.link || '#';
    const target = (p.link && /^https?:\/\//.test(p.link)) ? ' target="_blank" rel="noopener noreferrer"' : '';

    const animClass = p.animation ? ` anim-${escapeHtml(p.animation)}` : '';
    return `
      <div class="product-card${animClass}" data-category="${escapeHtml(p.category)}" data-product-id="${p.id}">
        ${imgHtml}
        <div class="product-card-body">
          <h3>${escapeHtml(p.title)}</h3>
          <p>${escapeHtml(p.description || '')}</p>
          ${codeHtml}
          <a href="${escapeHtml(href)}"${target} class="btn btn-yellow">Shop Now</a>
        </div>
      </div>
    `;
  }

  async function load() {
    try {
      const res = await fetch('/api/products', { credentials: 'same-origin' });
      if (!res.ok) throw new Error('fetch failed');
      const { products } = await res.json();

      // Pinned products first — sorted by pinned_order
      const pinned = products
        .filter(p => p.is_pinned)
        .sort((a, b) => (a.pinned_order || 0) - (b.pinned_order || 0));

      // Everything else grouped by category
      const byCat = {};
      for (const p of products) {
        if (p.is_pinned) continue; // don't double-render
        (byCat[p.category] = byCat[p.category] || []).push(p);
      }

      const parts = [];

      // Pinned section (only renders when there's something pinned)
      if (pinned.length) {
        parts.push(`<div class="category-header category-header-pinned" data-category-header="pinned">📌 Pinned</div>`);
        parts.push(pinned.map(renderCard).join(''));
      }

      // Canonical category order
      for (const cat of CATEGORIES) {
        const items = byCat[cat.slug];
        if (!items || !items.length) continue;
        parts.push(`<div class="category-header" data-category-header="${cat.slug}">${escapeHtml(cat.label)}</div>`);
        parts.push(items.map(renderCard).join(''));
      }

      grid.innerHTML = parts.join('') || '<p class="empty" style="grid-column:1/-1;text-align:center;padding:40px;color:#777;">No products yet.</p>';

      // Notify main.js that products are ready to be filtered
      document.dispatchEvent(new CustomEvent('products-loaded', {
        detail: { total: products.length }
      }));
    } catch {
      // Silent fallback — existing static HTML (if any) or empty state stays
    }
  }

  // Load immediately (grid is already in DOM since script is end-of-body)
  load();
})();
