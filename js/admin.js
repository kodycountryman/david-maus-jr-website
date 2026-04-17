// David Maus Jr. Admin Dashboard
// Single-file vanilla JS — handles login, 3 tabs (Links / Edit Info / Media), and modals

(function () {
  'use strict';

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

  const INFO_SECTIONS = [
    {
      id: 'homepage',
      label: 'Homepage',
      fields: [
        { key: 'hero_index_headline', label: 'Hero Headline' },
        { key: 'hero_index_subtitle', label: 'Hero Subtitle' },
        { key: 'hero_index_image', label: 'Hero Image', kind: 'image' },
        { key: 'hero_index_image_pos', label: 'Hero Image — Vertical Position', kind: 'position' },
        { key: 'meet_david_title', label: 'Meet David — Title' },
        { key: 'meet_david_intro', label: 'Meet David — Intro' },
        { key: 'meet_david_body', label: 'Meet David — Body', kind: 'longtext' },
        { key: 'meet_david_image', label: 'Meet David — Photo', kind: 'image' },
        { key: 'meet_david_image_pos', label: 'Meet David — Photo Vertical Position', kind: 'position' }
      ]
    },
    {
      id: 'about',
      label: 'About Page',
      fields: [
        { key: 'hero_about_headline', label: 'Hero Headline' },
        { key: 'hero_about_image', label: 'Hero Image', kind: 'image' },
        { key: 'hero_about_image_pos', label: 'Hero Image — Vertical Position', kind: 'position' },
        { key: 'about_story', label: 'My Story (full)', kind: 'longtext' },
        { key: 'value_1_title', label: 'Value 1 Title' },
        { key: 'value_1_body', label: 'Value 1 Body', kind: 'longtext' },
        { key: 'value_2_title', label: 'Value 2 Title' },
        { key: 'value_2_body', label: 'Value 2 Body', kind: 'longtext' },
        { key: 'value_3_title', label: 'Value 3 Title' },
        { key: 'value_3_body', label: 'Value 3 Body', kind: 'longtext' },
        { key: 'value_4_title', label: 'Value 4 Title' },
        { key: 'value_4_body', label: 'Value 4 Body', kind: 'longtext' }
      ]
    },
    {
      id: 'brand',
      label: 'Brand Partnerships',
      fields: [
        { key: 'hero_brand_headline', label: 'Hero Headline' },
        { key: 'hero_brand_image', label: 'Hero Image', kind: 'image' },
        { key: 'hero_brand_image_pos', label: 'Hero Image — Vertical Position', kind: 'position' },
        { key: 'brand_intro_primary', label: 'Intro (primary)' },
        { key: 'brand_intro_secondary', label: 'Intro (secondary)', kind: 'longtext' },
        { key: 'stat_1_num', label: 'Stat 1 — Number (auto from YouTube)' },
        { key: 'stat_1_label', label: 'Stat 1 — Label' },
        { key: 'stat_2_num', label: 'Stat 2 — Number' },
        { key: 'stat_2_label', label: 'Stat 2 — Label' },
        { key: 'stat_3_num', label: 'Stat 3 — Number' },
        { key: 'stat_3_label', label: 'Stat 3 — Label' },
        { key: 'stat_4_num', label: 'Stat 4 — Number (auto from YouTube)' },
        { key: 'stat_4_label', label: 'Stat 4 — Label' }
      ]
    },
    {
      id: 'picks',
      label: 'Product Picks',
      fields: [
        { key: 'hero_picks_headline', label: 'Hero Headline' },
        { key: 'hero_picks_subtitle', label: 'Hero Subtitle' },
        { key: 'hero_picks_image', label: 'Hero Image', kind: 'image' },
        { key: 'hero_picks_image_pos', label: 'Hero Image — Vertical Position', kind: 'position' },
        { key: 'picks_intro_primary', label: 'Intro (primary)' },
        { key: 'picks_intro_secondary', label: 'Intro (secondary)', kind: 'longtext' }
      ]
    },
    {
      id: 'newsletter',
      label: 'Newsletter',
      fields: [
        { key: 'hero_newsletter_headline', label: 'Hero Headline' },
        { key: 'hero_newsletter_subtitle', label: 'Hero Subtitle' },
        { key: 'hero_newsletter_image', label: 'Hero Image', kind: 'image' },
        { key: 'hero_newsletter_image_pos', label: 'Hero Image — Vertical Position', kind: 'position' },
        { key: 'newsletter_embed_src', label: 'Beehiiv Embed URL' },
        { key: 'newsletter_intro', label: 'Section Intro', kind: 'longtext' }
      ]
    },
    {
      id: 'contact',
      label: 'Contact',
      fields: [
        { key: 'hero_contact_headline', label: 'Hero Headline' },
        { key: 'hero_contact_image', label: 'Hero Image', kind: 'image' },
        { key: 'hero_contact_image_pos', label: 'Hero Image — Vertical Position', kind: 'position' },
        { key: 'contact_email', label: 'Email' },
        { key: 'contact_phone', label: 'Phone' },
        { key: 'contact_location', label: 'Location' },
        { key: 'contact_intro', label: 'Page Intro', kind: 'longtext' }
      ]
    },
    {
      id: 'social',
      label: 'Social Links (apply to all pages)',
      fields: [
        { key: 'social_instagram', label: 'Instagram URL' },
        { key: 'social_youtube', label: 'YouTube URL' },
        { key: 'social_tiktok', label: 'TikTok URL' },
        { key: 'social_twitter', label: 'Twitter / X URL' }
      ]
    }
  ];

  // ---------- State ----------
  const state = {
    user: null,
    products: [],
    content: {},
    media: []
  };

  // ---------- DOM refs ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const loginScreen = $('#login-screen');
  const dashboard = $('#dashboard');
  const loginForm = $('#login-form');
  const loginError = $('#login-error');
  const modalBackdrop = $('#modal-backdrop');
  const modal = $('#modal');
  const toast = $('#toast');

  // ---------- Utilities ----------
  const api = async (path, opts = {}) => {
    const res = await fetch(path, {
      credentials: 'same-origin',
      headers: opts.body && !(opts.body instanceof FormData)
        ? { 'Content-Type': 'application/json', ...(opts.headers || {}) }
        : (opts.headers || {}),
      ...opts
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Request failed');
      err.status = res.status;
      throw err;
    }
    return data;
  };

  const showToast = (msg, type = '') => {
    toast.textContent = msg;
    toast.className = `toast ${type}`;
    toast.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { toast.hidden = true; }, 2800);
  };

  const openModal = (html) => {
    modal.innerHTML = html;
    modalBackdrop.hidden = false;
  };

  const closeModal = () => { modalBackdrop.hidden = true; modal.innerHTML = ''; };

  modalBackdrop.addEventListener('click', (e) => {
    if (e.target === modalBackdrop) closeModal();
  });

  const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  const catLabel = (slug) => CATEGORIES.find(c => c.slug === slug)?.label || slug;

  // ---------- Session bootstrap ----------
  async function init() {
    try {
      const { user } = await api('/api/me');
      state.user = user;
      $('#user-label').textContent = user.username;
      // Mark this browser session as admin so tracker.js skips analytics beacons
      try { sessionStorage.setItem('dmj_is_admin', '1'); } catch {}
      showDashboard();
    } catch {
      showLogin();
    }
  }

  function showLogin() {
    dashboard.hidden = true;
    loginScreen.hidden = false;
    setTimeout(() => $('#login-username').focus(), 30);
  }

  async function showDashboard() {
    loginScreen.hidden = true;
    dashboard.hidden = false;
    await Promise.all([loadProducts(), loadContent(), loadMedia()]);
    renderLinks();
    renderInfo();
    renderMedia();
  }

  // ---------- Login ----------
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.hidden = true;
    const username = $('#login-username').value.trim();
    const password = $('#login-password').value;
    try {
      const { user } = await api('/api/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });
      state.user = user;
      $('#user-label').textContent = user.username;
      $('#login-password').value = '';
      try { sessionStorage.setItem('dmj_is_admin', '1'); } catch {}
      showDashboard();
    } catch (err) {
      loginError.textContent = err.message || 'Login failed';
      loginError.hidden = false;
    }
  });

  $('#logout-btn').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    try { sessionStorage.removeItem('dmj_is_admin'); } catch {}
    state.user = null;
    showLogin();
  });

  $('#change-password-btn').addEventListener('click', () => {
    openModal(`
      <div class="modal-header">
        <h3>Change Password</h3>
        <button class="modal-close" data-close>&times;</button>
      </div>
      <div class="modal-body">
        <form id="cp-form">
          <div class="field">
            <label>Current password</label>
            <input type="password" id="cp-current" required>
          </div>
          <div class="field">
            <label>New password</label>
            <input type="password" id="cp-next" required minlength="6">
            <div class="field-hint">Min 6 characters</div>
          </div>
          <div class="login-error" id="cp-error" hidden></div>
          <div style="display:flex; justify-content:flex-end; gap:10px;">
            <button type="button" class="btn btn-ghost" data-close>Cancel</button>
            <button type="submit" class="btn btn-yellow">Update Password</button>
          </div>
        </form>
      </div>
    `);
    $('#cp-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const current = $('#cp-current').value;
      const next = $('#cp-next').value;
      try {
        await api('/api/change-password', {
          method: 'POST',
          body: JSON.stringify({ current, next })
        });
        closeModal();
        showToast('Password updated', 'success');
      } catch (err) {
        const el = $('#cp-error');
        el.textContent = err.message;
        el.hidden = false;
      }
    });
    modal.onclick = (e) => {
      if (e.target.hasAttribute('data-close')) closeModal();
    };
  });

  // ---------- Tabs ----------
  $$('.admin-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      $$('.admin-tab').forEach(b => b.classList.toggle('active', b === btn));
      $$('.tab-panel').forEach(p => {
        p.hidden = p.id !== `tab-${tab}`;
        p.classList.toggle('active', p.id === `tab-${tab}`);
      });
    });
  });

  // ---------- Data loaders ----------
  async function loadProducts() {
    const { products } = await api('/api/products?all=1');
    state.products = products;
  }
  async function loadContent() {
    const { map } = await api('/api/content');
    state.content = map;
  }
  async function loadMedia() {
    try {
      const { media } = await api('/api/media');
      state.media = media;
    } catch {
      state.media = [];
    }
  }

  // ============================================
  // TAB 1 — LINKS
  // ============================================
  const tbody = $('#links-tbody');
  const catFilter = $('#category-filter');
  const searchFilter = $('#search-filter');
  const linkCount = $('#link-count');

  function renderLinks() {
    const cat = catFilter.value;
    const q = searchFilter.value.trim().toLowerCase();

    let rows = state.products;
    if (cat) rows = rows.filter(p => p.category === cat);
    if (q) rows = rows.filter(p =>
      p.title.toLowerCase().includes(q) ||
      (p.description || '').toLowerCase().includes(q) ||
      (p.code || '').toLowerCase().includes(q)
    );

    linkCount.textContent = `${rows.length} of ${state.products.length}`;

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty">No products match.</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map(p => {
      const pinBadge = p.is_pinned ? '<span class="mini-badge badge-pinned" title="Pinned to top">📌</span>' : '';
      const featuredBadge = p.is_featured ? '<span class="mini-badge badge-featured" title="Featured on homepage">★</span>' : '';
      const animBadge = p.animation ? `<span class="mini-badge badge-anim" title="Animation: ${escapeHtml(p.animation)}">✨</span>` : '';
      const pinBtnClass = p.is_pinned ? 'btn-icon btn-pin-active' : 'btn-icon';
      return `
      <tr data-id="${p.id}"${p.is_pinned ? ' class="row-pinned"' : ''}>
        <td class="title-cell">${pinBadge}${featuredBadge}${animBadge} ${escapeHtml(p.title)}</td>
        <td><span class="cat-pill">${escapeHtml(catLabel(p.category))}</span></td>
        <td>${p.code ? `<span class="code-pill">${escapeHtml(p.code)}</span>` : '<span style="color:#bbb;">—</span>'}</td>
        <td><span class="link-truncate">${p.link ? escapeHtml(p.link) : '—'}</span></td>
        <td><span class="active-badge ${p.active ? 'yes' : 'no'}">${p.active ? '● Active' : '○ Hidden'}</span></td>
        <td>
          <div class="row-actions">
            <button class="${pinBtnClass}" data-pin="${p.id}" title="${p.is_pinned ? 'Unpin' : 'Pin to top'}">📌</button>
            <button class="btn-icon" data-edit="${p.id}" title="Edit">✎</button>
            <button class="btn-icon btn-danger-icon" data-del="${p.id}" title="Delete">✕</button>
          </div>
        </td>
      </tr>
    `;
    }).join('');
  }

  catFilter.addEventListener('change', renderLinks);
  searchFilter.addEventListener('input', renderLinks);

  tbody.addEventListener('click', async (e) => {
    const editId = e.target.closest('[data-edit]')?.dataset.edit;
    const delId = e.target.closest('[data-del]')?.dataset.del;
    const pinId = e.target.closest('[data-pin]')?.dataset.pin;
    if (pinId) {
      const prod = state.products.find(x => x.id == pinId);
      if (!prod) return;
      const newVal = prod.is_pinned ? 0 : 1;
      try {
        const { product: updated } = await api(`/api/products/${pinId}`, {
          method: 'PUT',
          body: JSON.stringify({ is_pinned: newVal })
        });
        const i = state.products.findIndex(x => x.id == pinId);
        if (i >= 0) state.products[i] = updated;
        renderLinks();
        showToast(newVal ? 'Pinned to top' : 'Unpinned', 'success');
      } catch (err) {
        showToast(err.message || 'Failed to pin', 'error');
      }
      return;
    }
    if (editId) openProductModal(state.products.find(p => p.id == editId));
    if (delId) deleteProduct(parseInt(delId, 10));
  });

  $('#add-link-btn').addEventListener('click', () => openProductModal(null));

  const ANIMATIONS = [
    { value: '',          label: 'None (default)' },
    { value: 'pulse',     label: 'Pulse — gentle scale breathing' },
    { value: 'glow',      label: 'Glow — soft yellow halo' },
    { value: 'shimmer',   label: 'Shimmer — light sweep across card' },
    { value: 'float',     label: 'Float — drifts up & down' },
    { value: 'highlight', label: '★ Top Pick — bordered w/ badge' },
  ];

  function openProductModal(product) {
    const isEdit = !!product;
    const p = product || { category: '', title: '', description: '', link: '', code: '', image_url: '', active: 1, is_featured: 0, animation: '' };

    openModal(`
      <div class="modal-header">
        <h3>${isEdit ? 'Edit Link' : 'Add New Link'}</h3>
        <button class="modal-close" data-close>&times;</button>
      </div>
      <div class="modal-body">
        <form id="product-form">
          <div class="field">
            <label>Product Title *</label>
            <input type="text" name="title" value="${escapeHtml(p.title)}" required>
          </div>
          <div class="field-row">
            <div class="field">
              <label>Category *</label>
              <select name="category" required>
                <option value="">Select…</option>
                ${CATEGORIES.map(c => `<option value="${c.slug}" ${c.slug === p.category ? 'selected' : ''}>${c.label}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label>Discount Code</label>
              <input type="text" name="code" value="${escapeHtml(p.code || '')}" placeholder="MAUS">
            </div>
          </div>
          <div class="field">
            <label>Link URL</label>
            <input type="url" name="link" value="${escapeHtml(p.link || '')}" placeholder="https://…">
          </div>
          <div class="field">
            <label>Description</label>
            <textarea name="description">${escapeHtml(p.description || '')}</textarea>
          </div>
          <div class="field">
            <label>Product Image</label>
            ${renderImagePickerHtml(p.image_url)}
          </div>
          <div class="field">
            <label>Animation</label>
            <select name="animation">
              ${ANIMATIONS.map(a => `<option value="${a.value}" ${a.value === (p.animation || '') ? 'selected' : ''}>${escapeHtml(a.label)}</option>`).join('')}
            </select>
            <div class="field-hint">Give this link extra attention on the Product Picks page.</div>
          </div>
          <div class="checkbox-stack">
            <label class="checkbox-row">
              <input type="checkbox" name="active" ${p.active ? 'checked' : ''}>
              <span>Show on site</span>
            </label>
            <label class="checkbox-row">
              <input type="checkbox" name="is_featured" ${p.is_featured ? 'checked' : ''}>
              <span>Feature on homepage <span class="hint-inline">(shows in the homepage Product Picks preview, max 6)</span></span>
            </label>
            <label class="checkbox-row">
              <input type="checkbox" name="is_pinned" ${p.is_pinned ? 'checked' : ''}>
              <span>📌 Pin to top of Product Picks page <span class="hint-inline">(appears above all categories)</span></span>
            </label>
          </div>
        </form>
      </div>
      <div class="modal-footer">
        ${isEdit ? `<button class="btn btn-danger" data-delete>Delete</button>` : ''}
        <div style="flex:1;"></div>
        <button class="btn btn-ghost" data-close>Cancel</button>
        <button class="btn btn-yellow" data-save>${isEdit ? 'Save Changes' : 'Create Link'}</button>
      </div>
    `);

    attachImagePicker(p.image_url);

    // Use .onclick (replaces previous handler each open) instead of
    // addEventListener (which would accumulate — a stale Add-Link handler
    // would silently fire on later saves and create duplicate products).
    modal.onclick = async (e) => {
      if (e.target.hasAttribute('data-close')) closeModal();
      if (e.target.hasAttribute('data-delete')) {
        if (confirm(`Delete "${p.title}"?`)) {
          await deleteProduct(p.id);
          closeModal();
        }
      }
      if (e.target.hasAttribute('data-save')) {
        const form = $('#product-form');
        if (!form) return; // modal already replaced
        const fd = new FormData(form);
        if (!fd.get('title') || !fd.get('category')) {
          showToast('Title and category required', 'error');
          return;
        }
        const payload = {
          title: fd.get('title'),
          category: fd.get('category'),
          code: fd.get('code') || null,
          link: fd.get('link') || null,
          description: fd.get('description') || null,
          image_url: $('#img-url-input').value || null,
          active: fd.get('active') ? 1 : 0,
          is_featured: fd.get('is_featured') ? 1 : 0,
          is_pinned: fd.get('is_pinned') ? 1 : 0,
          animation: fd.get('animation') || ''
        };
        try {
          if (isEdit) {
            const { product: updated } = await api(`/api/products/${p.id}`, {
              method: 'PUT',
              body: JSON.stringify(payload)
            });
            const i = state.products.findIndex(x => x.id === p.id);
            if (i >= 0) state.products[i] = updated;
            showToast('Link updated', 'success');
          } else {
            const { product: created } = await api('/api/products', {
              method: 'POST',
              body: JSON.stringify(payload)
            });
            state.products.push(created);
            state.products.sort((a, b) => (a.category.localeCompare(b.category)) || (a.sort_order - b.sort_order));
            showToast('Link added', 'success');
          }
          renderLinks();
          closeModal();
        } catch (err) {
          showToast(err.message || 'Save failed', 'error');
        }
      }
    };
  }

  async function deleteProduct(id) {
    const p = state.products.find(x => x.id === id);
    if (!p) return;
    if (!confirm(`Delete "${p.title}"?`)) return;
    try {
      await api(`/api/products/${id}`, { method: 'DELETE' });
      state.products = state.products.filter(x => x.id !== id);
      renderLinks();
      showToast('Link deleted', 'success');
    } catch (err) {
      showToast(err.message || 'Delete failed', 'error');
    }
  }

  // ============================================
  // TAB 2 — EDIT INFO
  // ============================================
  function renderInfo() {
    const root = $('#info-sections');
    root.innerHTML = INFO_SECTIONS.map(section => `
      <details class="info-section" ${section.id === 'homepage' ? 'open' : ''}>
        <summary>${escapeHtml(section.label)}</summary>
        <div class="info-section-body">
          ${section.fields.map(f => renderInfoField(f)).join('')}
          <div class="section-save-row">
            <button class="btn btn-yellow" data-save-section="${section.id}">Save Section</button>
          </div>
        </div>
      </details>
    `).join('');

    root.querySelectorAll('[data-save-section]').forEach(btn => {
      btn.addEventListener('click', () => saveSection(btn.dataset.saveSection));
    });

    // Attach image-pick buttons within info tab
    root.querySelectorAll('[data-image-pick]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.imagePick;
        const input = root.querySelector(`[data-content-input="${key}"]`);
        openImagePickerModal((url) => {
          input.value = url;
          const preview = root.querySelector(`[data-preview="${key}"]`);
          if (preview) preview.style.backgroundImage = `url("${url}")`;
          // Also refresh any position preview that references this image
          root.querySelectorAll(`[data-position-image="${key}"]`).forEach(p => {
            p.style.backgroundImage = `url("${url}")`;
          });
        });
      });
    });

    // Live position slider preview
    root.querySelectorAll('[data-position-for]').forEach(slider => {
      const key = slider.dataset.positionFor;
      const preview = root.querySelector(`[data-position-preview="${key}"]`);
      const valueEl = root.querySelector(`[data-position-value="${key}"]`);
      slider.addEventListener('input', () => {
        const pct = slider.value + '%';
        if (preview) preview.style.backgroundPosition = `center ${pct}`;
        if (valueEl) valueEl.textContent = pct;
      });
    });
  }

  function renderInfoField(f) {
    const val = state.content[f.key] ?? '';
    if (f.kind === 'image') {
      return `
        <div class="info-field">
          <label>${escapeHtml(f.label)}</label>
          <div class="image-field">
            <div class="image-field-preview" data-preview="${f.key}" style="background-image:url('${escapeHtml(val)}')"></div>
            <input type="text" data-content-input="${f.key}" value="${escapeHtml(val)}" placeholder="Image URL">
            <button type="button" class="btn btn-ghost" data-image-pick="${f.key}">Choose</button>
          </div>
        </div>
      `;
    }
    if (f.kind === 'longtext') {
      return `
        <div class="info-field">
          <label>${escapeHtml(f.label)}</label>
          <textarea class="longtext" data-content-input="${f.key}">${escapeHtml(val)}</textarea>
        </div>
      `;
    }
    if (f.kind === 'position') {
      // Find the image key this position is paired with (drop the "_pos" suffix)
      const imgKey = f.key.replace(/_pos$/, '');
      const imgUrl = state.content[imgKey] || '';
      const pct = Math.max(0, Math.min(100, parseInt(val, 10) || 50));
      return `
        <div class="info-field position-field">
          <label>${escapeHtml(f.label)}</label>
          <div class="position-wrap">
            <div class="position-preview" data-position-preview="${f.key}" data-position-image="${imgKey}"
                 style="background-image:url('${escapeHtml(imgUrl)}'); background-position: center ${pct}%;"></div>
            <div class="position-slider-row">
              <span class="position-slider-label">↑ Top</span>
              <input type="range" min="0" max="100" step="1" value="${pct}"
                     class="position-slider"
                     data-content-input="${f.key}"
                     data-position-for="${f.key}">
              <span class="position-slider-label">Bottom ↓</span>
              <span class="position-value" data-position-value="${f.key}">${pct}%</span>
            </div>
            <p class="field-hint">Drag slider to shift what part of the image shows through the hero crop.</p>
          </div>
        </div>
      `;
    }
    return `
      <div class="info-field">
        <label>${escapeHtml(f.label)}</label>
        <input type="text" data-content-input="${f.key}" value="${escapeHtml(val)}">
      </div>
    `;
  }

  async function saveSection(sectionId) {
    const section = INFO_SECTIONS.find(s => s.id === sectionId);
    if (!section) return;
    const updates = section.fields.map(f => {
      const input = document.querySelector(`[data-content-input="${f.key}"]`);
      return { key: f.key, value: input ? input.value : '' };
    });
    try {
      await api('/api/content', {
        method: 'POST',
        body: JSON.stringify({ updates })
      });
      updates.forEach(u => { state.content[u.key] = u.value; });
      showToast('Saved', 'success');
    } catch (err) {
      showToast(err.message || 'Save failed', 'error');
    }
  }

  // ============================================
  // TAB 3 — MEDIA
  // ============================================
  function renderMedia() {
    const grid = $('#media-grid');
    if (!state.media.length) {
      grid.innerHTML = `<div class="empty" style="grid-column:1/-1;">No photos uploaded yet. Drop some images in with the + Upload button.</div>`;
      return;
    }
    grid.innerHTML = state.media.map(m => `
      <div class="media-tile" data-id="${m.id}">
        <img src="${escapeHtml(m.url)}" alt="${escapeHtml(m.alt_text || m.filename)}" loading="lazy">
        <div class="media-tile-body">
          <span class="media-tile-name" title="${escapeHtml(m.filename)}">${escapeHtml(m.filename)}</span>
          <div class="media-tile-actions">
            <button data-copy="${escapeHtml(m.url)}">Copy URL</button>
            <button class="del" data-del-media="${m.id}">Delete</button>
          </div>
        </div>
      </div>
    `).join('');

    grid.querySelectorAll('[data-copy]').forEach(b => {
      b.addEventListener('click', () => {
        navigator.clipboard.writeText(location.origin + b.dataset.copy);
        showToast('URL copied');
      });
    });
    grid.querySelectorAll('[data-del-media]').forEach(b => {
      b.addEventListener('click', () => deleteMedia(parseInt(b.dataset.delMedia, 10)));
    });
  }

  const fileInput = $('#media-file-input');
  $('#upload-media-btn').addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async (e) => {
    const files = [...e.target.files];
    fileInput.value = '';
    if (!files.length) return;
    showToast(`Uploading ${files.length}…`);
    for (const file of files) {
      try {
        const fd = new FormData();
        fd.append('file', file);
        const { media } = await api('/api/media', { method: 'POST', body: fd });
        state.media.unshift(media);
      } catch (err) {
        showToast(`Failed: ${file.name}`, 'error');
      }
    }
    renderMedia();
    showToast('Upload complete', 'success');
  });

  async function deleteMedia(id) {
    const m = state.media.find(x => x.id === id);
    if (!m || !confirm(`Delete "${m.filename}"?`)) return;
    try {
      await api(`/api/media/${id}`, { method: 'DELETE' });
      state.media = state.media.filter(x => x.id !== id);
      renderMedia();
      showToast('Deleted', 'success');
    } catch (err) {
      showToast(err.message || 'Delete failed', 'error');
    }
  }

  // ---------- Image Picker (used in product modal + info tab) ----------
  function renderImagePickerHtml(currentUrl) {
    return `
      <div class="image-field">
        <div class="image-field-preview" id="img-preview" style="background-image:url('${escapeHtml(currentUrl || '')}')"></div>
        <input type="text" id="img-url-input" value="${escapeHtml(currentUrl || '')}" placeholder="Image URL or choose…">
        <button type="button" class="btn btn-ghost" id="img-picker-btn">Choose</button>
      </div>
    `;
  }

  function attachImagePicker(currentUrl) {
    const input = $('#img-url-input');
    const preview = $('#img-preview');
    const btn = $('#img-picker-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      openImagePickerModal((url) => {
        input.value = url;
        preview.style.backgroundImage = `url("${url}")`;
      });
    });
    input.addEventListener('input', () => {
      preview.style.backgroundImage = `url("${input.value}")`;
    });
  }

  function openImagePickerModal(onPick) {
    const tiles = state.media.length
      ? state.media.map(m => `
          <div class="media-picker-tile" data-url="${escapeHtml(m.url)}">
            <img src="${escapeHtml(m.url)}" alt="">
          </div>
        `).join('')
      : `<div class="media-picker-empty">No photos yet. Upload in the Media tab.</div>`;

    // Stack on top: create a new modal using a z-index above existing one
    const picker = document.createElement('div');
    picker.className = 'modal-backdrop';
    picker.style.zIndex = '150';
    picker.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3>Choose Image</h3>
          <button class="modal-close" data-close-picker>&times;</button>
        </div>
        <div class="modal-body">
          <div class="media-picker">${tiles}</div>
          <p class="field-hint" style="margin-top:10px;">Or paste a URL in the input field.</p>
        </div>
      </div>
    `;
    document.body.appendChild(picker);

    picker.addEventListener('click', (e) => {
      if (e.target === picker || e.target.hasAttribute('data-close-picker')) {
        picker.remove();
      }
      const tile = e.target.closest('[data-url]');
      if (tile) {
        onPick(tile.dataset.url);
        picker.remove();
      }
    });
  }

  // ---------- Boot ----------
  init();
})();
