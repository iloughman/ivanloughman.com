/* ivanloughman.com — leaves falling into a still photograph.
 *
 * The leaves live inside the scene, not on the glass. Each one is given a
 * spot on the ground somewhere down the path; its size, speed and sway follow
 * perspective from there, so distant leaves are tiny and slow and settle near
 * the far end of the path, while nearer ones are bigger and land closer.
 * Far leaves take on the colour of the air. They flutter like real leaves
 * (rocking side to side, tilting into each swing, dropping fastest through the
 * middle of it), a few tumble end over end, and when they reach the ground
 * they settle flat and stay, gathering slowly on the path. Past a limit
 * the oldest fade back into the carpet, so the photo is never buried.
 *
 * Nothing moves with reduced motion turned on, and nothing runs while the
 * tab is hidden.
 */
(() => {
  'use strict';

  const canvas = document.querySelector('canvas.leaves');
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const SPEED = +(new URLSearchParams(location.search).get('speed') || 1);   // ?speed=8 to preview the build-up quickly

  // The photograph: its shape and how CSS crops it (object-fit: cover; object-position: 57% 56%).
  const PHOTO_ASPECT = 0.75;                // width / height
  const POS_X = 0.57, POS_Y = 0.56;
  // Where the path meets the horizon, and the nearest ground, as fractions of the photo's height.
  const HORIZON = 0.532, NEAR_GROUND = 0.97;

  // Colours from the leaves in the photo, and the hazy mid-tone of the distance.
  const PALETTE = ['#d8b33c', '#e2c255', '#c99a2e', '#d2692c', '#c4522a', '#a8653a', '#8c5a38', '#b8874c'].map(hex);
  const HAZE = hex('#a69e88');

  const rand = (a, b) => a + Math.random() * (b - a);
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  function hex(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
  const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const rgb = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;

  let W = 0, H = 0, dpr = 1, running = false, last = 0, time = 0;
  let photoW = 1, photoH = 1, photoLeft = 0, photoTop = 0;
  let leaves = [];
  let settled = [];                         // leaves that have come to rest on the path
  let settledCap = 160;

  // Is this spot (photo fractions) open ground? Not the stone wall on the left, not the tall grass on the right.
  function onGround(fx, fy) {
    const wallX = fy < 0.555 ? 0.48 : fy < 0.61 ? 0.44 : fy < 0.672 ? 0.34 : -1;
    if (fx < wallX) return false;
    if (fx > 0.58 && fy < 0.545 + (fx - 0.58) * 0.1) return false;
    return fy > HORIZON + 0.012;
  }

  // photo fractions → screen px
  const toX = (fx) => photoLeft + fx * photoW;
  const toY = (fy) => photoTop + fy * photoH;

  function newLeaf(midFall) {
    // depth: 0 = far down the path, 1 = near. Most leaves are well back; none are right at the glass.
    const d = Math.pow(Math.random(), 1.1) * 0.8;
    const landFy = lerp(HORIZON + 0.03, NEAR_GROUND, Math.pow(d, 1.6));
    const p = (landFy - HORIZON) / (NEAR_GROUND - HORIZON);       // perspective scale, ~0.07 far → 1 near
    const drop = rand(0.28, 0.55) * (0.22 + 0.78 * p);            // how far it falls, from the canopy
    const startFy = landFy - drop;
    const c = PALETTE[(Math.random() * PALETTE.length) | 0];
    const air = (1 - p) * 0.38;                                  // far leaves take on the haze
    const front = mix(c, HAZE, air);
    const light = mix(mix(c, [255, 244, 214], 0.22), HAZE, air);
    const back = mix(mix(c, [60, 38, 22], 0.3), HAZE, air);
    const ground = mix(mix(c, [112, 74, 50], 0.42 + Math.random() * 0.12), HAZE, air * 0.8);   // once it's down, it sits into the carpet
    const L = {
      p, landFy, startFy,
      fx: rand(0.02, 0.98),
      fy: startFy,
      fall: rand(0.05, 0.075) * (0.25 + 0.75 * p),                 // photo heights per second
      swayAmp: rand(0.008, 0.016) * (0.2 + 0.8 * p),               // photo heights
      swayRate: rand(1.3, 2.3), phase: rand(0, Math.PI * 2),
      tumble: Math.random() < 0.3, spin: rand(0, Math.PI * 2), spinRate: rand(2.2, 4) * (Math.random() < 0.5 ? -1 : 1),
      tilt: rand(-0.5, 0.5),
      size: 0.0165 * p * rand(0.8, 1.2),                           // half-length, in photo heights
      front: rgb(front), light: rgb(light), back: rgb(back), ground: rgb(ground),
      alpha: p > 0.35 ? 1 : lerp(0.75, 1, p / 0.35),            // only distant leaves thin into the air
      age: 0, rest: -1, 
    };
    if (midFall) { L.fy = lerp(startFy, landFy, Math.random()); L.age = 1; }
    return L;
  }

  function resize() {
    W = canvas.clientWidth; H = canvas.clientHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    const s = Math.max(W / PHOTO_ASPECT, H);                     // cover
    photoH = s; photoW = s * PHOTO_ASPECT;
    photoLeft = (W - photoW) * POS_X; photoTop = (H - photoH) * POS_Y;
    const count = Math.round(clamp(W * H / 26000, 30, 52));
    settledCap = Math.round(clamp(W * H / 7000, 90, 260));
    while (leaves.length < count) leaves.push(newLeaf(true));
    leaves.length = count;
  }

  // A slow breeze: mostly calm, now and then a soft gust to one side.
  function breeze(t) {
    const g = Math.sin(t * 0.13) * 0.6 + Math.sin(t * 0.051 + 2) * 0.4;
    return Math.max(0, g) ** 3 * 0.05;
  }

  function drawLeaf(L, x, y, rot, flip, squash, alpha) {
    const r = Math.max(1.8, L.size * photoH);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(flip, squash);
    ctx.globalAlpha = alpha;
    if (r > 3 && flip >= 0) {                                    // a little curvature: lit on one side, shaded on the other
      const g = ctx.createLinearGradient(-r * 0.8, 0, r * 0.8, 0);
      g.addColorStop(0, L.light); g.addColorStop(0.55, L.front); g.addColorStop(1, L.back);
      ctx.fillStyle = g;
    } else ctx.fillStyle = flip < 0 ? L.back : L.front;
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.bezierCurveTo(r * 0.85, -r * 0.5, r * 0.7, r * 0.55, 0, r);
    ctx.bezierCurveTo(-r * 0.7, r * 0.55, -r * 0.85, -r * 0.5, 0, -r);
    ctx.fill();
    if (r > 4) {                                                  // a stem, only where you could see one
      ctx.globalAlpha = alpha * 0.4;
      ctx.strokeStyle = '#4a2c16'; ctx.lineWidth = Math.max(0.5, r * 0.06);
      ctx.beginPath(); ctx.moveTo(0, -r * 0.75); ctx.lineTo(0, r * 1.2); ctx.stroke();
    }
    ctx.restore();
  }

  // The leaves on the ground. Past the cap, the oldest slowly fade into the carpet as new ones arrive.
  function drawSettled(dt) {
    let over = settled.length - settledCap;
    for (const S of settled) {
      if (over <= 0) break;
      if (S.fade < 0) S.fade = 0;
      over--;
    }
    for (let i = 0; i < settled.length; i++) {
      const S = settled[i];
      let a = S.a;
      if (S.fade >= 0) { S.fade += dt / 6; a *= 1 - S.fade; if (S.fade >= 1) { settled.splice(i--, 1); continue; } }
      const r = S.r * photoH;
      ctx.save();
      ctx.translate(toX(S.fx), toY(S.fy));
      ctx.rotate(S.rot); ctx.scale(S.flip, 0.42);
      ctx.globalAlpha = a;
      ctx.fillStyle = S.color;
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.bezierCurveTo(r * 0.85, -r * 0.5, r * 0.7, r * 0.55, 0, r);
      ctx.bezierCurveTo(-r * 0.7, r * 0.55, -r * 0.85, -r * 0.5, 0, -r);
      ctx.fill();
      ctx.restore();
    }
  }

  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000 || 0) * SPEED; last = now; time += dt;
    const wind = breeze(time);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    drawSettled(dt);
    leaves.sort((a, b) => a.p - b.p);                             // far first

    for (let i = 0; i < leaves.length; i++) {
      const L = leaves[i];
      L.age += dt;
      const w = time * L.swayRate + L.phase;
      let rot, flip, squash = 1, alpha = L.alpha;

      if (L.rest < 0) {
        // falling: pendulum flutter, fastest through the bottom of each swing
        const swing = Math.cos(w);
        L.fy += L.fall * (0.45 + 0.55 * Math.abs(swing)) * dt;
        L.fx += (wind * (0.3 + 0.7 * L.p)) * dt / PHOTO_ASPECT;
        if (L.tumble) { L.spin += L.spinRate * dt; flip = Math.cos(L.spin); rot = L.tilt + L.spin * 0.15; }
        else { flip = 0.55 + 0.45 * Math.cos(w * 0.5); rot = L.tilt + 0.7 * Math.sin(w); }
        alpha *= clamp(L.age / 0.3);                              // drift out of the canopy, don't pop in
        if (L.fy >= L.landFy) { L.fy = L.landFy; L.rest = 0; L.restRot = rot; L.restFlip = flip >= 0 ? 1 : -1; L.onGround = onGround(L.fx, L.fy); }
      } else {
        // landing: it settles flat over a moment, then joins the leaves on the ground
        L.rest += dt;
        const k = clamp(L.rest / 0.45);
        rot = L.restRot; flip = L.restFlip; squash = lerp(1, 0.42, k * k * (3 - 2 * k));
        if (!L.onGround) {                                         // came down on the wall or in the grass: slip out of sight
          alpha *= 1 - clamp(L.rest / 0.6);
          if (L.rest > 0.6) { leaves[i] = newLeaf(false); continue; }
        } else if (L.rest > 0.45) {
          settled.push({ fx: L.fx, fy: L.fy, rot, flip: L.restFlip, r: Math.max(1.8, L.size * photoH) / photoH, color: L.ground, a: 0.82 * L.alpha, fade: -1 });
          leaves[i] = newLeaf(false); continue;
        }
      }

      const sway = L.rest < 0 ? Math.sin(w) * L.swayAmp : 0;
      const x = toX(L.fx + sway / PHOTO_ASPECT), y = toY(L.fy);
      if (x < -20 || x > W + 20 || y > H + 20) { leaves[i] = newLeaf(false); continue; }
      if (Math.abs(flip) < 0.08) flip = flip < 0 ? -0.08 : 0.08;
      drawLeaf(L, x, y, rot, flip, squash, alpha);
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
