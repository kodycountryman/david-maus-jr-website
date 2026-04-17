document.addEventListener('DOMContentLoaded', () => {

  // ---- Page Fade-In ----
  document.body.classList.add('loaded');

  // ---- Mobile Drawer Navigation ----
  const hamburger = document.querySelector('.hamburger');
  const drawer = document.querySelector('.mobile-drawer');
  const navOverlay = document.querySelector('.nav-overlay');
  const drawerClose = document.querySelector('.drawer-close');

  const navbar = document.querySelector('.navbar');

  const closeDrawer = () => {
    hamburger.classList.remove('open');
    if (drawer) drawer.classList.remove('open');
    if (navOverlay) navOverlay.classList.remove('open');
    if (navbar) navbar.classList.remove('drawer-open');
    document.body.style.overflow = '';
  };

  const openDrawer = () => {
    hamburger.classList.add('open');
    if (drawer) drawer.classList.add('open');
    if (navOverlay) navOverlay.classList.add('open');
    if (navbar) navbar.classList.add('drawer-open');
    document.body.style.overflow = 'hidden';
  };

  if (hamburger) {
    hamburger.addEventListener('click', () => {
      if (drawer && drawer.classList.contains('open')) {
        closeDrawer();
      } else {
        openDrawer();
      }
    });
  }

  if (drawerClose) {
    drawerClose.addEventListener('click', closeDrawer);
  }

  if (navOverlay) {
    navOverlay.addEventListener('click', closeDrawer);
  }

  // Close drawer when a link is clicked
  if (drawer) {
    drawer.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', closeDrawer);
    });
  }

  // ---- Navbar: Transparent → Glass on Scroll ----
  if (navbar) {
    const onScroll = () => {
      if (window.scrollY > 50) {
        navbar.classList.add('scrolled');
      } else {
        navbar.classList.remove('scrolled');
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll(); // check initial position (e.g. if page loaded mid-scroll)
  }

  // ---- Product Picks Tab Filter ----
  const tabBtns = document.querySelectorAll('.tab-btn');
  const picksGrid = document.getElementById('picks-grid');
  const productCount = document.getElementById('product-count');

  if (tabBtns.length && picksGrid) {
    // Re-query cards each call so dynamically-loaded products work
    const getCards = () => [...picksGrid.querySelectorAll('.product-card[data-category]')];
    const getHeaders = () => [...picksGrid.querySelectorAll('.category-header')];

    const getActiveTab = () =>
      document.querySelector('.tab-btn.active')?.dataset.tab || 'all';

    const updateCount = () => {
      if (!productCount) return;
      const total = getCards().length;
      const tab = getActiveTab();
      const visible = tab === 'all'
        ? total
        : getCards().filter(c => c.dataset.category === tab).length;
      productCount.textContent = visible === total
        ? `Showing all ${total} products`
        : `Showing ${visible} of ${total} products`;
    };

    const applyFilter = (tab) => {
      getCards().forEach(card => {
        card.style.display = (tab === 'all' || card.dataset.category === tab) ? '' : 'none';
      });
      getHeaders().forEach(h => {
        h.style.display = tab === 'all' ? '' : 'none';
      });
      updateCount();
    };

    const filterProducts = (tab) => {
      picksGrid.classList.add('fading');
      setTimeout(() => {
        applyFilter(tab);
        picksGrid.classList.remove('fading');
      }, 150);
    };

    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        filterProducts(btn.dataset.tab);
        btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      });
    });

    // Initial state (handles case when HTML already has products)
    updateCount();

    // Re-apply after dynamic load
    document.addEventListener('products-loaded', () => {
      applyFilter(getActiveTab());
    });
  }

  // ---- Beehiiv Newsletter Posts ----
  const postGrid = document.getElementById('post-grid');
  const postsFallback = document.getElementById('posts-fallback');

  if (postGrid) {
    const BEEHIIV_URL = 'https://dmjr.beehiiv.com';
    const PROXY_URL = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(BEEHIIV_URL);

    const renderPosts = (posts) => {
      if (!posts || posts.length === 0) { showPostsFallback(); return; }
      postGrid.innerHTML = posts.map(p => `
        <div class="post-card">
          ${p.img ? `<img class="post-card-img" src="${p.img}" alt="${p.title}" loading="lazy">` : '<div class="post-card-img"></div>'}
          <div class="post-card-body">
            ${p.date ? `<p class="post-meta">${p.date}</p>` : ''}
            <h3>${p.title}</h3>
            ${p.excerpt ? `<p class="post-excerpt">${p.excerpt}</p>` : ''}
            <a href="${p.href}" target="_blank" rel="noopener noreferrer" class="btn btn-yellow">Read Article</a>
          </div>
        </div>`).join('');
      // Observe newly rendered cards for stagger animation
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(e => { if (e.isIntersecting) { postGrid.classList.add('revealed'); observer.disconnect(); } });
      }, { threshold: 0.1 });
      observer.observe(postGrid);
    };

    const showPostsFallback = () => {
      postGrid.style.display = 'none';
      if (postsFallback) postsFallback.style.display = 'block';
    };

    // Parse Beehiiv page HTML — each post has two <a> elements: image link + text link
    // Text link structure: <time> for date, h2.line-clamp-2 for title, p.line-clamp-2 for excerpt
    const parseBeehiivPosts = (html) => {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const links = [...doc.querySelectorAll('a[href^="/p/"]')];
      const byHref = {};
      links.forEach(a => {
        const href = BEEHIIV_URL + a.getAttribute('href');
        if (!byHref[href]) byHref[href] = { href, img: null, title: null, date: null, excerpt: null };
        const img = a.querySelector('img');
        if (img) {
          byHref[href].img = img.getAttribute('src');
        } else {
          // Text link — extract structured fields
          const time = a.querySelector('time');
          const h2 = a.querySelector('h2');
          const p = a.querySelector('p.line-clamp-2, p.line-clamp-3');
          if (time) byHref[href].date = time.textContent.trim();
          if (h2 && !byHref[href].title) byHref[href].title = h2.textContent.trim();
          if (p && !byHref[href].excerpt) byHref[href].excerpt = p.textContent.trim();
        }
      });
      return Object.values(byHref).filter(p => p.title).slice(0, 6);
    };

    fetch(PROXY_URL)
      .then(r => r.text())
      .then(html => {
        const posts = parseBeehiivPosts(html);
        posts.length ? renderPosts(posts) : showPostsFallback();
      })
      .catch(() => showPostsFallback());
  }

  // ---- YouTube Latest Videos ----
  const ytCarousel = document.getElementById('yt-carousel');
  const ytFallback = document.getElementById('yt-fallback');

  if (ytCarousel) {
    const CHANNEL_ID = 'UCasr6iZBDikSQcmOcI7YZ3g';
    const YT_NS = 'http://www.youtube.com/xml/schemas/2015';

    // Confirmed fallback videos (verified via oEmbed)
    const FALLBACK_VIDEOS = [
      { id: '-JfwIErZtF4', title: 'been there done that' },
      { id: '1Oa5tP6qvd8', title: 'Best Chiller for DIY Cold Plunge (Don\'t Waste Your $)' },
      { id: '2BQpPu_67y8', title: 'The Cheapest Way to Keep a Cold Plunge Sparkly Clean' },
      { id: '3CygLoLJCBw', title: 'I Tested Every Cold Plunge to find the Best Material' },
      { id: '3LmvDK-xJR0', title: 'DIY Cold Plunge Anyone Can Make in Minutes!' },
      { id: '4TFrw1xfu9U', title: 'DIY Vertical Strawberry Garden | Full Build and Vlog' },
    ];

    const renderYtCards = (videos) => {
      ytCarousel.innerHTML = '';
      videos.forEach(({ id, title }) => {
        const card = document.createElement('a');
        card.href = `https://www.youtube.com/watch?v=${id}`;
        card.target = '_blank';
        card.rel = 'noopener noreferrer';
        card.className = 'yt-card';

        const thumbWrap = document.createElement('div');
        thumbWrap.className = 'yt-thumb-wrap';

        const img = document.createElement('img');
        img.src = `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
        img.alt = title;
        img.loading = 'lazy';

        const playBtn = document.createElement('div');
        playBtn.className = 'yt-play-btn';
        playBtn.innerHTML = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M8 5v14l11-7z"/></svg>`;

        thumbWrap.append(img, playBtn);

        const titleP = document.createElement('p');
        titleP.className = 'yt-title';
        titleP.textContent = title;

        card.append(thumbWrap, titleP);
        ytCarousel.appendChild(card);
      });
    };

    const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;
    const proxyUrl = `https://corsproxy.io/?url=${encodeURIComponent(feedUrl)}`;

    fetch(proxyUrl, { signal: AbortSignal.timeout(6000) })
      .then(r => r.text())
      .then(xml => {
        const doc = new DOMParser().parseFromString(xml, 'text/xml');
        const entries = [...doc.querySelectorAll('entry')].slice(0, 6);
        if (!entries.length) throw new Error('no entries');
        const videos = entries.map(e => ({
          id: e.getElementsByTagNameNS(YT_NS, 'videoId')[0]?.textContent,
          title: e.querySelector('title')?.textContent,
        })).filter(v => v.id && v.title);
        if (!videos.length) throw new Error('no videos');
        renderYtCards(videos);
      })
      .catch(() => renderYtCards(FALLBACK_VIDEOS));
  }

  // ---- Scroll Reveal (IntersectionObserver) ----
  const revealElements = document.querySelectorAll(
    '.reveal-up, .reveal-left, .reveal-right, .reveal-scale, .reveal-stagger'
  );

  if (revealElements.length > 0 && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('revealed');
          observer.unobserve(entry.target);
        }
      });
    }, {
      threshold: 0.15,
      rootMargin: '0px 0px -40px 0px'
    });

    revealElements.forEach(el => observer.observe(el));
  } else {
    // Fallback: reveal everything immediately
    revealElements.forEach(el => el.classList.add('revealed'));
  }

});
