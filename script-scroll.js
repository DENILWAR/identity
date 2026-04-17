/**
 * script-scroll.js
 * Apple-style scroll-controlled frame animation
 * GSAP + ScrollTrigger + Canvas
 *
 * Quality architecture:
 *   — Canvas physical pixels = CSS pixels × devicePixelRatio
 *   — ctx transform is set to DPR so all draw calls use logical (CSS) coordinates
 *   — On Retina/HiDPI: DPR=2 → canvas has 4× pixels → full native sharpness
 *   — HQ frames (frames-hq/) served automatically on DPR > 1 if they exist
 */

(function () {
  'use strict';

  /* ============================================================
     CONFIG
  ============================================================ */
  const CONFIG = {
    framesDir:    'frames/',      // Standard 1280px frames (1× displays)
    framesHqDir:  'frames-hq/',  // HQ frames for Retina (set to '' to disable)

    framePattern: 'frame_{n}.webp',
    framePad:     4,

    // Known frame count — avoids a network probe round-trip at startup
    frameCount: 71,

    // GSAP scrub duration in seconds (lower = snappier response)
    scrubDuration: 0.9,

    // Lerp factor for the render loop (0 = no lerp, 1 = instant)
    // Keep low so the DPR-accurate canvas draws stay ahead of scroll velocity
    lerpFactor: 0.14,

    // Fraction of frames that must be loaded before revealing the canvas
    preloadThreshold: 0.55,

    // Max DPR to render at — 2 covers all Retina screens without
    // the memory cost of 3× on high-density mobile devices
    maxDpr: 2,
  };

  /* ============================================================
     VIEWPORT — logical (CSS) dimensions + physical DPR
     Updated by resizeCanvas(). All drawFrame() calls read from here.
  ============================================================ */
  const vp = {
    logicalW: 0,
    logicalH: 0,
    physicalW: 0,
    physicalH: 0,
    dpr: 1,
  };

  /* ============================================================
     ANIMATION STATE
  ============================================================ */
  const state = {
    frames: [],
    loadedCount: 0,
    totalFrames: 0,
    currentIndex: 0,
    displayIndex: 0,
    rafId: null,
    isReady: false,
    scrollProgress: 0,
    lastDrawnIndex: -1,
  };

  /* ============================================================
     DOM
  ============================================================ */
  const canvas      = document.getElementById('hero-canvas');
  const ctx         = canvas.getContext('2d', { alpha: false });
  const loader      = document.getElementById('loader');
  const loaderBar   = document.getElementById('loader-bar');
  const loaderText  = document.getElementById('loader-text');
  const progressBar = document.getElementById('scroll-progress');
  const titleEl     = document.querySelector('.scroll-title');
  const subtitleEl  = document.querySelector('.scroll-subtitle');
  const scrollHint  = document.querySelector('.scroll-hint');

  /* ============================================================
     UTILITY
  ============================================================ */
  function pad(n, width) {
    const s = String(n);
    return s.length >= width ? s : '0'.repeat(width - s.length) + s;
  }

  function frameUrl(index) {
    return CONFIG.framesDir + CONFIG.framePattern.replace(
      '{n}', pad(index + 1, CONFIG.framePad)
    );
  }

  /* ============================================================
     CANVAS RESIZE — DPR-aware
     Physical canvas = logical × DPR so every canvas pixel maps 1:1
     to a physical screen pixel on Retina displays.
  ============================================================ */
  let resizeTimer = null;

  function resizeCanvas() {
    vp.dpr      = Math.min(window.devicePixelRatio || 1, CONFIG.maxDpr);
    vp.logicalW = document.documentElement.clientWidth;
    vp.logicalH = document.documentElement.clientHeight;
    vp.physicalW = Math.round(vp.logicalW * vp.dpr);
    vp.physicalH = Math.round(vp.logicalH * vp.dpr);

    // Size the canvas in physical pixels
    canvas.width  = vp.physicalW;
    canvas.height = vp.physicalH;

    // Keep CSS size at logical pixels — browser maps 1 CSS px → DPR physical px
    canvas.style.width  = vp.logicalW + 'px';
    canvas.style.height = vp.logicalH + 'px';

    // Reset transform to DPR scale so draw calls use logical coordinates.
    // Using setTransform (not scale) avoids accumulation across resizes.
    ctx.setTransform(vp.dpr, 0, 0, vp.dpr, 0, 0);

    // Highest quality interpolation when scaling frames
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    state.lastDrawnIndex = -1; // force redraw
    drawFrame(Math.round(state.displayIndex));
  }

  function onResize() {
    clearTimeout(resizeTimer);
    // Debounce: skip intermediate sizes during window drag or iOS bar toggle
    resizeTimer = setTimeout(resizeCanvas, 80);
  }

  /* ============================================================
     DRAW FRAME
     All coordinates here are in logical (CSS) pixels.
     ctx.setTransform(dpr, …) handles the physical-pixel mapping.

     Scaling strategy:
       Portrait viewport   → fit-to-width  (card always fully visible)
       Landscape viewport  → cover         (cinematic full-bleed fill)
  ============================================================ */
  function drawFrame(index) {
    const img = state.frames[index];
    if (!img || !img.complete || img.naturalWidth === 0) return;

    // Skip if nothing changed and canvas is up to date
    if (index === state.lastDrawnIndex &&
        vp.logicalW === canvas._lastW &&
        vp.logicalH === canvas._lastH) return;

    const cw = vp.logicalW;   // logical CSS pixels (ctx transform covers DPR)
    const ch = vp.logicalH;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;

    // Black fill prevents ghosting / blank frames on resize
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, ch);

    const viewAspect  = cw / ch;
    const imageAspect = iw / ih;

    // Portrait viewport (viewAspect < imageAspect): scale to fit width
    // Landscape viewport: cover to fill viewport edge-to-edge
    const scale = viewAspect < imageAspect
      ? cw / iw
      : Math.max(cw / iw, ch / ih);

    const drawW = iw * scale;
    const drawH = ih * scale;
    const drawX = (cw - drawW) / 2;
    const drawY = (ch - drawH) / 2;

    ctx.drawImage(img, drawX, drawY, drawW, drawH);

    state.lastDrawnIndex = index;
    canvas._lastW = cw;
    canvas._lastH = ch;
  }

  /* ============================================================
     RENDER LOOP — lerp toward target frame index
  ============================================================ */
  function renderLoop() {
    state.rafId = requestAnimationFrame(renderLoop);
    if (!state.isReady) return;

    const diff = state.currentIndex - state.displayIndex;

    if (Math.abs(diff) < 0.01) {
      // Snap and skip unnecessary redraws
      if (state.displayIndex !== state.currentIndex) {
        state.displayIndex = state.currentIndex;
        drawFrame(Math.round(state.displayIndex));
      }
      return;
    }

    state.displayIndex += diff * CONFIG.lerpFactor;

    drawFrame(
      Math.min(Math.max(Math.round(state.displayIndex), 0), state.totalFrames - 1)
    );
  }

  /* ============================================================
     PRELOAD
     Loads all images in order. Fires onReady() when
     CONFIG.preloadThreshold fraction have loaded.
  ============================================================ */
  function preloadFrames(totalFrames, onReady) {
    state.totalFrames = totalFrames;
    state.frames      = new Array(totalFrames);
    state.loadedCount = 0;

    let readyCalled = false;
    const readyAt   = Math.ceil(totalFrames * CONFIG.preloadThreshold);

    for (let i = 0; i < totalFrames; i++) {
      const img = new Image();

      img.onload = () => {
        state.loadedCount++;
        const pct = state.loadedCount / totalFrames;

        if (loaderBar)  loaderBar.style.transform  = `scaleX(${pct})`;
        if (loaderText) loaderText.textContent      = `${Math.round(pct * 100)}%`;

        if (!readyCalled && state.loadedCount >= readyAt) {
          readyCalled = true;
          onReady();
        }
      };

      img.onerror = () => { state.loadedCount++; };

      img.src = frameUrl(i);
      state.frames[i] = img;
    }
  }

  /* ============================================================
     FRAME COUNT DETECTION
  ============================================================ */
  async function detectFrameCount() {
    if (CONFIG.frameCount > 0) return CONFIG.frameCount;

    const candidates = [120, 100, 90, 80, 71, 70, 60, 50, 40, 30, 20];
    for (const n of candidates) {
      const url = CONFIG.framesDir + CONFIG.framePattern.replace('{n}', pad(n, CONFIG.framePad));
      try {
        const res = await fetch(url, { method: 'HEAD' });
        if (res.ok) return n;
      } catch (_) { /* ignore */ }
    }
    return 60;
  }

  /* ============================================================
     SCROLL PROGRESS → FRAME INDEX
  ============================================================ */
  function onScrollProgress(progress) {
    state.scrollProgress = progress;
    const p = Math.min(Math.max(progress, 0), 1);
    state.currentIndex  = Math.round(p * (state.totalFrames - 1));
    if (progressBar) progressBar.style.width = (p * 100) + '%';
  }

  /* ============================================================
     SCROLL TRIGGER (GSAP) — with native fallback
  ============================================================ */
  function initScrollTrigger() {
    if (!window.gsap || !window['ScrollTrigger']) {
      console.warn('[scroll-anim] GSAP not found — using native scroll.');
      initNativeScroll();
      return;
    }

    const { gsap: _gsap, ScrollTrigger: ST } = window;
    _gsap.registerPlugin(ST);

    ST.create({
      trigger:  '#hero',
      start:    'top top',
      end:      'bottom bottom',
      scrub:    CONFIG.scrubDuration,
      onUpdate: (self) => onScrollProgress(self.progress),
    });
  }

  function initNativeScroll() {
    const scene = document.getElementById('hero');
    if (!scene) return;

    function onScroll() {
      const total    = scene.offsetHeight - window.innerHeight;
      const scrolled = -scene.getBoundingClientRect().top;
      onScrollProgress(scrolled / total);
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ============================================================
     SHOW SCENE
  ============================================================ */
  function showScene() {
    state.isReady = true;

    drawFrame(0);
    // One RAF tick delay so the frame paints before we trigger the fade-in
    requestAnimationFrame(() => {
      requestAnimationFrame(() => canvas.classList.add('loaded'));
    });

    if (loader) loader.classList.add('hidden');

    setTimeout(() => {
      if (titleEl)    titleEl.classList.add('visible');
      if (subtitleEl) subtitleEl.classList.add('visible');
      if (scrollHint) scrollHint.classList.add('visible');
    }, 200);

    initScrollTrigger();
  }

  /* ============================================================
     HQ FRAME DIRECTORY SELECTION
     If the device has a DPR > 1 and frames-hq/ has been extracted,
     serve HQ frames automatically. Falls back to standard frames
     if frames-hq/ is empty or doesn't exist.
  ============================================================ */
  async function selectFrameDir() {
    if (!CONFIG.framesHqDir || window.devicePixelRatio <= 1) return;

    // Quick probe — check if frame_0001.webp exists in hq dir
    const testUrl = CONFIG.framesHqDir + CONFIG.framePattern.replace('{n}', pad(1, CONFIG.framePad));
    try {
      const res = await fetch(testUrl, { method: 'HEAD' });
      if (res.ok) {
        CONFIG.framesDir = CONFIG.framesHqDir;
        console.log('[scroll-anim] HQ frames active (DPR=' + window.devicePixelRatio + ')');
      }
    } catch (_) { /* fall back to standard */ }
  }

  /* ============================================================
     BOOT
  ============================================================ */
  async function init() {
    // Initial resize — must run before renderLoop so vp is populated
    resizeCanvas();

    window.addEventListener('resize',           onResize,    { passive: true });
    window.addEventListener('orientationchange', resizeCanvas, { passive: true });

    // Start loop (draws nothing until isReady = true)
    renderLoop();

    // Auto-upgrade to HQ frames on Retina if available
    await selectFrameDir();

    const frameCount = await detectFrameCount();
    console.log(`[scroll-anim] ${frameCount} frames @ DPR=${vp.dpr} (${vp.physicalW}×${vp.physicalH}px physical)`);

    preloadFrames(frameCount, showScene);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
