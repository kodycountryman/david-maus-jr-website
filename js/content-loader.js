// Content hydration — fetches /api/content and injects values into
// elements with [data-content-key]. Runs on all public pages.
// Silently falls back to the static HTML values if fetch fails.

(function () {
  'use strict';

  // Also wire up social links (they use a different attr for consistency)
  const SOCIAL_MAP = {
    'instagram': 'social_instagram',
    'youtube': 'social_youtube',
    'tiktok': 'social_tiktok',
    'twitter': 'social_twitter'
  };

  async function hydrate() {
    let map;
    try {
      const res = await fetch('/api/content', { credentials: 'same-origin' });
      if (!res.ok) return;
      const data = await res.json();
      map = data.map || {};
    } catch {
      return;
    }

    // 1. Apply data-content-key bindings
    document.querySelectorAll('[data-content-key]').forEach(el => {
      const key = el.dataset.contentKey;
      const value = map[key];
      if (value == null) return;

      // Don't overwrite elements that have a dedicated hydrator
      // (e.g. data-yt-stat owns the number; content-loader can still
      // own any sibling label, but should skip the number itself)
      if (el.dataset.ytStat) return;

      // If it's an image, set src (and try to preserve query string like ?v=1)
      if (el.tagName === 'IMG') {
        el.src = value;
        // Apply paired vertical position if one is set (e.g. hero_index_image_pos)
        const posVal = map[key + '_pos'];
        if (posVal != null && posVal !== '') {
          const n = parseInt(posVal, 10);
          if (!isNaN(n)) el.style.objectPosition = `center ${n}%`;
        }
        return;
      }
      // If it's an iframe (Beehiiv), set src
      if (el.tagName === 'IFRAME') {
        el.src = value;
        return;
      }
      // If it's an anchor, set href (social links, etc)
      if (el.tagName === 'A') {
        el.href = value;
        return;
      }
      // Otherwise set text. Longtext fields use line breaks — convert to <br>
      // for the about story which is stored as plain text with \n separators.
      if (el.dataset.contentFormat === 'paragraphs') {
        el.innerHTML = formatStoryParagraphs(value);
      } else if (el.dataset.contentFormat === 'multiline') {
        el.innerHTML = escapeHtml(value).replace(/\n/g, '<br>');
      } else {
        el.textContent = value;
      }
    });

    // 2. Apply social links to all [data-social="<network>"] elements
    document.querySelectorAll('[data-social]').forEach(el => {
      const key = SOCIAL_MAP[el.dataset.social];
      if (key && map[key] && el.tagName === 'A') {
        el.href = map[key];
      }
    });

    // 3. Dispatch event so other scripts (like products-loader) know content is live
    document.dispatchEvent(new CustomEvent('content-loaded', { detail: { map } }));
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // Render the About "My Story" longtext. Plain paragraphs separated by blank
  // lines; single-line-break groups become staccato p's; a leading "> " line
  // becomes a pull-quote blockquote.
  function formatStoryParagraphs(text) {
    const blocks = text.split(/\n\s*\n/);
    return blocks.map(block => {
      const t = block.trim();
      if (!t) return '';
      if (t.startsWith('> ')) {
        return `<blockquote class="story-pull">${escapeHtml(t.slice(2))}</blockquote>`;
      }
      // Count lines within block — multi-line = staccato
      const lines = t.split('\n');
      if (lines.length > 1) {
        return `<p class="story-staccato">${lines.map(escapeHtml).join('<br>')}</p>`;
      }
      return `<p>${escapeHtml(t)}</p>`;
    }).join('\n');
  }

  // Run as soon as possible; DOM should exist since this is loaded at end of body
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hydrate);
  } else {
    hydrate();
  }
})();
