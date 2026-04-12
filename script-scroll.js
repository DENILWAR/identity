/**
 * script-scroll.js
 * Apple-style scroll-controlled frame animation
 * GSAP + ScrollTrigger + Canvas
 */

(function () {
  'use strict';

  /* ============================================================
     CONFIG — tweak these to adjust feel
  ============================================================ */
  const CONFIG = {
    // Directory where frames live (relative to this HTML file)
    framesDir: 'frames/',

    // Frame filename pattern. {n} = zero-padded number.
    framePattern: 'frame_{n}.webp',

    // Padding width for frame numbers (4 → frame_0001.webp)
    framePad: 4,

    // Exact frame count from extraction (71 frames @ 24fps, 2.97s)
    frameCount: 71,

    // Easing amount for scroll → frame mapping (0 = none, higher = more lag)
    // We handle this with a lerp on the frame index
    lerpFactor: 0.12,

    // How many frames to preload before showing the scene
    // (rest load in background)
    preloadThreshold: 0.6,   // 60% loaded = show
  };

  /* ============================================================
     STATE
  ============================================================ */
  const state = {
    frames: [],           // Array of HTMLImageElement
    loadedCount: 0,
    totalFrames: 0,
    currentIndex: 0,      // Raw target index from scroll
    displayIndex: 0,      // Lerped display index (smooth)
    rafId: null,
    isReady: false,
    scrollProgress: 0,
  };

  /* ============================================================
     DOM REFERENCES
  ============================================================ */
  const canvas       = document.getElementById('hero-canvas');
  const ctx          = canvas.getContext('2d', { alpha: false });
  const loader       = document.getElementById('loader');
  const loaderBar    = document.getElementById('loader-bar');
  const loaderText   = document.getElementById('loader-text');
  const progressBar  = document.getElementById('scroll-progress');
  const titleEl      = document.querySelector('.scroll-title');
  const subtitleEl   = document.querySelector('.scroll-subtitle');
  const scrollHint   = document.querySelector('.scroll-hint');

  /* ============================================================
     UTILITY — zero-pad number
  ============================================================ */
  function pad(n, width) {
    const s = String(n);
    return s.length >= width ? s : '0'.repeat(width - s.length) + s;
  }

  /* ============================================================
     FRAME URL BUILDER
  ============================================================ */
  function frameUrl(index) {
    return CONFIG.framesDir + CONFIG.framePattern.replace(
      '{n}', pad(index + 1, CONFIG.framePad)
    );
  }

  /* ============================================================
     AUTO-DETECT FRAME COUNT
     Tries to probe how many frames exist by binary search on 404s.
     Falls back to CONFIG.frameCount if set.
  ============================================================ */
  async function detectFrameCount() {
    if (CONFIG.frameCount > 0) return CONFIG.frameCount;

    // Probe common counts quickly
    const candidates = [120, 100, 90, 80, 70, 60, 50, 40, 30, 20, 10];
    for (const n of candidates) {
      const url = CONFIG.framesDir + CONFIG.framePattern.replace('{n}', pad(n, CONFIG.framePad));
      try {
        const res = await fetch(url, { method: 'HEAD' });
        if (res.ok) return n;
      } catch (_) { /* network error */ }
    }
    return 60; // safe fallback
  }

  /* ============================================================
     CANVAS RESIZE
     Debounced — avoids repeated redraws during pinch-zoom or
     iOS address-bar show/hide transitions.
  ============================================================ */
  let resizeTimer = null;
  function resizeCanvas() {
    // Use clientWidth/clientHeight to avoid iOS innerHeight flicker
    // when the address bar appears / disappears
    canvas.width  = document.documentElement.clientWidth;
    canvas.height = document.documentElement.clientHeight;
    drawFrame(Math.round(state.displayIndex));
  }

  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resizeCanvas, 80);
  }

  /* ============================================================
     DRAW FRAME ON CANVAS
     Scaling strategy:
       Portrait viewport (mobile): fit-to-width — the full image
         width is always visible, height may overflow vertically.
         Prevents the card from being cropped on narrow screens.
       Landscape viewport (desktop/tablet): cover — fills the
         viewport edge-to-edge for the cinematic full-bleed look.
  ============================================================ */
  function drawFrame(index) {
    const img = state.frames[index];
    if (!img || !img.complete || img.naturalWidth === 0) return;

    const cw = canvas.width;
    const ch = canvas.height;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;

    // Always paint black first — prevents ghosting between frames
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, ch);

    // Pick scale mode based on viewport vs image aspect ratio.
    // viewAspect < imageAspect  → viewport is more "portrait" than the image
    //   → scale to width so the full horizontal extent is always visible.
    // viewAspect >= imageAspect → viewport is as wide or wider than image
    //   → use cover so it fills the viewport edge-to-edge.
    const viewAspect  = cw / ch;
    const imageAspect = iw / ih;

    const scale = viewAspect < imageAspect
      ? cw / iw                      // fit-to-width (portrait / mobile)
      : Math.max(cw / iw, ch / ih);  // cover (landscape / desktop)

    const drawW = iw * scale;
    const drawH = ih * scale;
    const drawX = (cw - drawW) / 2;
    const drawY = (ch - drawH) / 2;

    ctx.drawImage(img, drawX, drawY, drawW, drawH);
  }

  /* ============================================================
     MAIN RENDER LOOP
     Uses lerp to smoothly interpolate toward the target frame
  ============================================================ */
  function renderLoop() {
    state.rafId = requestAnimationFrame(renderLoop);

    if (!state.isReady) return;

    // Lerp toward target
    const diff = state.currentIndex - state.displayIndex;
    if (Math.abs(diff) < 0.01) {
      // Close enough — snap exactly
      if (state.displayIndex !== state.currentIndex) {
        state.displayIndex = state.currentIndex;
        drawFrame(Math.round(state.displayIndex));
      }
      return;
    }

    state.displayIndex += diff * CONFIG.lerpFactor;

    const frameIdx = Math.min(
      Math.max(Math.round(state.displayIndex), 0),
      state.totalFrames - 1
    );

    drawFrame(frameIdx);
  }

  /* ============================================================
     PRELOAD FRAMES
     Loads all images; fires callback when threshold is reached
  ============================================================ */
  function preloadFrames(totalFrames, onReady) {
    state.totalFrames = totalFrames;
    state.frames = new Array(totalFrames);
    state.loadedCount = 0;

    let readyCalled = false;
    const readyAt = Math.ceil(totalFrames * CONFIG.preloadThreshold);

    for (let i = 0; i < totalFrames; i++) {
      const img = new Image();

      img.onload = () => {
        state.loadedCount++;
        const pct = state.loadedCount / totalFrames;

        // Update loader bar
        if (loaderBar)  loaderBar.style.transform  = `scaleX(${pct})`;
        if (loaderText) loaderText.textContent = `${Math.round(pct * 100)}%`;

        if (!readyCalled && state.loadedCount >= readyAt) {
          readyCalled = true;
          onReady();
        }
      };

      img.onerror = () => {
        // Count errors as loaded to avoid stall
        state.loadedCount++;
      };

      // Stagger the requests slightly to avoid overwhelming the server
      // For local file:// serving this is fine immediately
      img.src = frameUrl(i);
      state.frames[i] = img;
    }
  }

  /* ============================================================
     SCROLL PROGRESS → FRAME INDEX
  ============================================================ */
  function onScrollProgress(progress) {
    state.scrollProgress = progress;

    // Clamp and map 0→1 to frame index
    const p = Math.min(Math.max(progress, 0), 1);
    state.currentIndex = Math.round(p * (state.totalFrames - 1));

    // Update progress bar
    if (progressBar) progressBar.style.width = (p * 100) + '%';
  }

  /* ============================================================
     GSAP SCROLL TRIGGER SETUP
  ============================================================ */
  function initScrollTrigger() {
    // Safety check
    if (!window.gsap || !window['ScrollTrigger']) {
      console.warn('[scroll-anim] GSAP or ScrollTrigger not loaded. Falling back to native scroll.');
      initNativeScroll();
      return;
    }

    // Both gsap and ScrollTrigger are CDN globals on window
    const { gsap: _gsap, ScrollTrigger: ST } = window;
    _gsap.registerPlugin(ST);

    ST.create({
      trigger: '#hero',
      start: 'top top',
      end: 'bottom bottom',
      scrub: 1,              // 1s lag for buttery smoothness
      onUpdate: (self) => {
        onScrollProgress(self.progress);
      },
    });
  }

  /* ============================================================
     NATIVE SCROLL FALLBACK (no GSAP)
  ============================================================ */
  function initNativeScroll() {
    const scene = document.getElementById('hero');
    if (!scene) return;

    function onScroll() {
      const rect    = scene.getBoundingClientRect();
      const total   = scene.offsetHeight - window.innerHeight;
      const scrolled = -rect.top;
      const progress = Math.min(Math.max(scrolled / total, 0), 1);
      onScrollProgress(progress);
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ============================================================
     SHOW SCENE — called once enough frames are loaded
  ============================================================ */
  function showScene() {
    state.isReady = true;

    // Draw the first frame immediately, then fade canvas in
    drawFrame(0);
    requestAnimationFrame(() => canvas.classList.add('loaded'));

    // Hide loader (only present in scroll.html standalone mode)
    if (loader) loader.classList.add('hidden');

    // Reveal text with staggered fade
    setTimeout(() => {
      if (titleEl)    titleEl.classList.add('visible');
      if (subtitleEl) subtitleEl.classList.add('visible');
      if (scrollHint) scrollHint.classList.add('visible');
    }, 200);

    // Init scroll control
    initScrollTrigger();
  }

  /* ============================================================
     BOOT
  ============================================================ */
  async function init() {
    // Resize canvas to fill viewport
    resizeCanvas();
    window.addEventListener('resize',      onResize, { passive: true });
    window.addEventListener('orientationchange', resizeCanvas, { passive: true });

    // Start render loop immediately (draws nothing until frames load)
    renderLoop();

    // Detect or use configured frame count
    const frameCount = await detectFrameCount();
    console.log(`[scroll-anim] Detected ${frameCount} frames.`);

    // Begin preloading
    preloadFrames(frameCount, showScene);
  }

  /* ============================================================
     ENTRY POINT
  ============================================================ */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
