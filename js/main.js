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
