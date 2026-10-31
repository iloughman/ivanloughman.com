/* ivanloughman.com — leaves falling in front of a still photograph.
 *
 * Each leaf has a depth: far leaves are small, faint and slow; near ones are
 * larger and quicker. They tumble as they fall (turning edge-on and back),
 * sway on their own, and all lean together when a slow breeze picks up.
 * Nothing moves with reduced motion turned on, and nothing runs while the
 * tab is hidden.
 */
(() => {
  'use strict';

  const canvas = document.querySelector('canvas.leaves');
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');

  // Colours taken from the leaves in the photo.
  const PALETTE = ['#d8b33c', '#e2c255', '#c99a2e', '#d2692c', '#c4522a', '#a8653a', '#8c5a38', '#b8874c'];
  const rand = (a, b) => a + Math.random() * (b - a);

  let W = 0, H = 0, dpr = 1, running = false, last = 0, time = 0;
  let leaves = [];

  function newLeaf(anywhere) {
    const z = rand(0, 1);                         // 0 = far, 1 = near
    return {
      z,
      x: rand(-0.1, 1.1),                          // fraction of width
      y: anywhere ? rand(-0.1, 1) : rand(-0.25, -0.05),
      fall: lerp(0.035, 0.11, z) * rand(0.8, 1.2), // screen heights per second
      size: lerp(6, 17, z * z) * rand(0.85, 1.15), // css px
      sway: rand(0.012, 0.03), swayRate: rand(0.5, 1.1), phase: rand(0, 100),
      spin: rand(0, Math.PI * 2), spinRate: rand(1.0, 2.6) * (Math.random() < 0.5 ? -1 : 1),
      tilt: rand(-0.6, 0.6),
      color: PALETTE[(Math.random() * PALETTE.length) | 0],
    };
  }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function resize() {
    W = canvas.clientWidth; H = canvas.clientHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    const count = Math.round(Math.min(36, Math.max(20, W * H / 38000)));
    while (leaves.length < count) leaves.push(newLeaf(true));
    leaves.length = count;
    leaves.sort((a, b) => a.z - b.z);              // draw far leaves first
  }

  // A slow breeze: mostly calm, now and then a soft gust to one side.
  function breeze(t) {
    const g = Math.sin(t * 0.13) * 0.6 + Math.sin(t * 0.051 + 2) * 0.4;
    return Math.max(0, g) ** 3 * 0.09;
  }

  function drawLeaf(L, x, y) {
    const r = L.size;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(L.tilt + Math.sin(L.spin * 0.5) * 0.6);
    ctx.scale(Math.cos(L.spin), 1);                 // tumbling: edge-on and back
    ctx.globalAlpha = lerp(0.55, 0.95, L.z);
    ctx.fillStyle = L.color;
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.bezierCurveTo(r * 0.9, -r * 0.55, r * 0.75, r * 0.6, 0, r);
    ctx.bezierCurveTo(-r * 0.75, r * 0.6, -r * 0.9, -r * 0.55, 0, -r);
    ctx.fill();
    ctx.globalAlpha *= 0.45;
    ctx.strokeStyle = '#4a2c16'; ctx.lineWidth = Math.max(0.6, r * 0.07);
    ctx.beginPath(); ctx.moveTo(0, -r * 0.8); ctx.lineTo(0, r * 1.25); ctx.stroke();
    ctx.restore();
  }

  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000 || 0); last = now; time += dt;
    const wind = breeze(time);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    for (let i = 0; i < leaves.length; i++) {
      const L = leaves[i];
      L.y += L.fall * dt;
      L.x += wind * lerp(0.4, 1, L.z) * dt;
      L.spin += L.spinRate * dt * (1 + wind * 6);
      const sx = (L.x + Math.sin(time * L.swayRate + L.phase) * L.sway) * W;
      const sy = L.y * H;
      if (sy > H + 30 || sx > W + 40) { leaves[i] = newLeaf(false); continue; }
      drawLeaf(L, sx, sy);
    }
    requestAnimationFrame(frame);
  }

  function start() {
    if (running || motionQuery.matches || document.hidden) return;
    running = true; last = performance.now(); requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  }

  resize();
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => (document.hidden ? (running = false) : start()));
  motionQuery.addEventListener?.('change', (e) => (e.matches ? stop() : start()));
  start();
})();
