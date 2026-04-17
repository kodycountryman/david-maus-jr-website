// Hydrate #featured-grid on the homepage with any products David
// has marked as is_featured=1 via the admin Links tab. Hides the whole
// section if there are zero featured products, so the homepage never
// shows placeholder junk.
(function () {
  'use strict';

  const grid = document.getElementById('featured-grid');
  const section = document.getElementById('featured-products-section');
  if (!grid || !section) return;

  const escapeHtml = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));

  fetch('/api/products', { credentials: 'same-origin' })
    .then(r => r.ok ? r.json() : Promise.reject(r.status))
    .then(({ products }) => {
      const featured = (products || [])
        .filter(p => p.is_featured)
        .sort((a, b) => (a.featured_order || 0) - (b.featured_order || 0))
        .slice(0, 6); // cap at 6 for the homepage preview

      if (!featured.length) return; // section stays hidden

      grid.innerHTML = featured.map(p => {
        const img = p.image_url
          ? `<div class="placeholder-img"><img src="${escapeHtml(p.image_url)}" alt="${escapeHtml(p.title)}"></div>`
          : `<div class="placeholder-img">Product Image</div>`;
        const code = p.code
          ? `<div class="product-code">Use Code: ${escapeHtml(p.code)}</div>`
          : '';
        const href = p.link || '#';
        const target = (p.link && /^https?:\/\//.test(p.link)) ? ' target="_blank" rel="noopener noreferrer"' : '';
        const anim = p.animation ? ` anim-${escapeHtml(p.animation)}` : '';
        return `
          <div class="product-card${anim}" data-product-id="${p.id}" data-category="${escapeHtml(p.category || '')}">
            ${img}
            <div class="product-card-body">
              <h3>${escapeHtml(p.title)}</h3>
              <p>${escapeHtml(p.description || '')}</p>
              ${code}
              <a href="${escapeHtml(href)}"${target} class="btn btn-yellow">Shop Now</a>
            </div>
          </div>
        `;
      }).join('');

      section.hidden = false;
    })
    .catch(() => { /* silent: keep section hidden */ });
})();
