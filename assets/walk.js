/* The Walk — ivanloughman.com
 *
 * One photograph: an autumn path along a dry-stone wall. Scrolling walks you
 * down it. A small WebGL shader gives the photo a sense of depth: the ground
 * and wall near you slide past faster than the trees at the end of the path,
 * so it feels like walking, not zooming. Leaves fall around you, evening comes
 * on as you go, and the walk ends at a warm light far down the path.
 */
(() => {
  'use strict';

  const root = document.documentElement;
  const body = document.body;
  const scene = document.querySelector('.scene');
  const glCanvas = document.querySelector('canvas.world');
  const leafCanvas = document.querySelector('canvas.leaves');
  const still = document.querySelector('img.still');
  const track = document.querySelector('.track');
  if (!scene || !leafCanvas || !still) { root.classList.remove('js'); return; }
  window.walkReady = true;

  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = motionQuery.matches;

  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

  // Where the path disappears into the trees, as a fraction of the photo.
  const VP = { x: 0.572, y: 0.532 };
  root.style.setProperty('--vp-x', `${VP.x * 100}%`);
  root.style.setProperty('--vp-y', `${VP.y * 100}%`);

  /* ---------------- scroll → distance walked ---------------- */
  let W = 0, H = 0, dpr = 1, stableVH = 0, lastW = 0, maxScroll = 1;
  function layoutTrack(force) {
    const vh = window.innerHeight;
    if (!force && W === lastW && stableVH && Math.abs(vh - stableVH) / stableVH < 0.2) return;
    stableVH = vh; lastW = W;
    const len = Math.round(vh * 5.5);
    track.style.height = `${len + vh}px`;
    maxScroll = len;
  }
  const target = () => clamp(window.scrollY / maxScroll);

  /* ---------------- WebGL: the photo with depth ---------------- */
  let gl = null, prog = null, tex = null, imgW = 1, imgH = 1, uni = {};
  const VERT = `attribute vec2 p; varying vec2 v; void main(){ v = p * .5 + .5; v.y = 1. - v.y; gl_Position = vec4(p, 0., 1.); }`;
  const FRAG = `
    precision highp float;
    varying vec2 v;
    uniform sampler2D img;
    uniform vec2 win0, winSize;   // visible window of the photo (cover crop), in photo uv
    uniform vec2 vp;              // vanishing point, photo uv
    uniform float aspect;         // photo width / height
    uniform float walk;           // 0 → 1, distance down the path
    uniform float bob;            // footstep bob, photo uv
    uniform float dusk;           // 0 → 1
    uniform float glow;           // 0 → 1, the light at the end
    uniform float t;              // time, seconds
    uniform vec2 glowPos;         // photo uv

    // magnification at an offset from the vanishing point: near things grow faster
    float mag(vec2 o) {
      float d = length(o * vec2(aspect, 1.));
      float near = pow(clamp(d / .62, 0., 1.), 1.35);
      return 1. + walk * (1.05 + 2.1 * near);
    }

    void main() {
      vec2 base = win0 + v * winSize;
      vec2 o = base - vp;
      o.y += bob;
      vec2 s = o / mag(o);
      s = o / mag(s); s = o / mag(s); s = o / mag(s);
      vec2 uv = clamp(vp + s, vec2(.001), vec2(.999));
      vec3 c = texture2D(img, uv).rgb;

      // evening: less light overall, cool in the shadows, the colours still warm where they're bright
      float lum = dot(c, vec3(.299, .587, .114));
      vec3 shade = c * vec3(.50, .54, .64);
      vec3 lit = c * vec3(.80, .70, .58);
      vec3 eve = mix(shade, lit, smoothstep(.25, .75, lum));
      c = mix(c, eve, dusk * .8);

      // the warm light down the path: a small lamp-like core, a soft halo, light spilling on the ground
      vec2 g = (base - glowPos) * vec2(aspect, 1.) / (1. + walk * 1.05);
      float r = length(g);
      float breathe = .93 + .07 * sin(t * .9) * sin(t * .37 + 1.3);
      vec3 warm = vec3(1., .72, .38);
      float below = smoothstep(-.005, .05, g.y);            // the path in front of the light catches it
      float light = .8 * exp(-r * r / .00045) + .32 * exp(-r * r / .007) + .12 * exp(-r * r / .05) * (.4 + .6 * below);
      light *= glow * breathe;
      c = 1. - (1. - c) * (1. - warm * light);              // screen blend: brightens without blowing out
      c += warm * light * .25 * c;                           // warm the lit colours a touch
      gl_FragColor = vec4(c, 1.);
    }`;

  function initGL() {
    try {
      gl = glCanvas.getContext('webgl', { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
    } catch (e) { gl = null; }
    if (!gl) return false;
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    try {
      prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link');
    } catch (e) { gl = null; return false; }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const n of ['img', 'win0', 'winSize', 'vp', 'aspect', 'walk', 'bob', 'dusk', 'glow', 't', 'glowPos']) uni[n] = gl.getUniformLocation(prog, n);
    return true;
  }

  function uploadTexture(image) {
    if (!gl) return;
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    let src = image;
    if (image.naturalWidth > max || image.naturalHeight > max) {
      const k = max / Math.max(image.naturalWidth, image.naturalHeight);
      const c = document.createElement('canvas');
      c.width = Math.floor(image.naturalWidth * k); c.height = Math.floor(image.naturalHeight * k);
      c.getContext('2d').drawImage(image, 0, 0, c.width, c.height); src = c;
    }
    if (!tex) tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, src);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    imgW = image.naturalWidth; imgH = image.naturalHeight;
    needsFrame = true;
  }

  // The part of the photo that covers the screen, centred on the path where it can be.
  function coverWindow() {
    const s = Math.max(W / imgW, H / imgH);
    const ww = W / (imgW * s), wh = H / (imgH * s);
    const cx = clamp(VP.x, ww / 2, 1 - ww / 2), cy = clamp(VP.y + 0.04, wh / 2, 1 - wh / 2);
    return [cx - ww / 2, cy - wh / 2, ww, wh];
  }

  /* ---------------- falling leaves ---------------- */
  const lctx = leafCanvas.getContext('2d');
  const PALETTE = ['#d8b33c', '#e2c255', '#c99a2e', '#d2692c', '#c4522a', '#a8653a', '#8c5a38', '#b8874c'];
  const N_LEAVES = 26;
  const rand = (a, b) => a + Math.random() * (b - a);
  function newLeaf(far) {
    return {
      x: rand(-1.4, 1.4), y: rand(-1.2, 0.2),          // world units around the line of sight
      z: far ? rand(2.2, 4.5) : rand(0.9, 4.5),         // distance ahead of you
      fall: rand(0.06, 0.13), sway: rand(0.15, 0.35), swayRate: rand(0.6, 1.3),
      spin: rand(0, Math.PI * 2), spinRate: rand(1.2, 3.2) * (Math.random() < 0.5 ? -1 : 1),
      size: rand(0.016, 0.026), color: PALETTE[(Math.random() * PALETTE.length) | 0], seed: Math.random() * 100,
    };
  }
  const leaves = Array.from({ length: N_LEAVES }, () => newLeaf(false));

  function drawLeaves(dt, stepForward, vpx, vpy) {
    lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    lctx.clearRect(0, 0, W, H);
    if (reduced) return;
    const f = H * 0.9;                                  // focal length in px
    for (const L of leaves) {
      L.y += L.fall * dt;
      L.z -= stepForward;                                // you walk toward them
      L.spin += L.spinRate * dt;
      const sway = Math.sin(time * L.swayRate + L.seed) * L.sway;
      const sx = vpx + (L.x + sway) / L.z * f;
      const sy = vpy + L.y / L.z * f;
      const r = L.size / L.z * f;
      if (L.z < 0.55 || sy > H + 40 || L.y > 0.9 || sx < -60 || sx > W + 60) { Object.assign(L, newLeaf(true)); continue; }
      const a = clamp(1.4 - L.z * 0.28) * clamp((0.9 - L.y) * 4);
      lctx.save();
      lctx.translate(sx, sy);
      lctx.rotate(L.spin * 0.35 + sway);
      lctx.scale(Math.cos(L.spin), 1);                   // tumbling: the leaf turns edge-on and back
      lctx.globalAlpha = a * (1 - dusk * 0.5);
      lctx.fillStyle = L.color;
      lctx.beginPath();
      lctx.moveTo(0, -r);
      lctx.bezierCurveTo(r * 0.9, -r * 0.55, r * 0.75, r * 0.6, 0, r);
      lctx.bezierCurveTo(-r * 0.75, r * 0.6, -r * 0.9, -r * 0.55, 0, -r);
      lctx.fill();
      lctx.globalAlpha *= 0.5; lctx.strokeStyle = 'rgba(70,40,20,.8)'; lctx.lineWidth = Math.max(0.6, r * 0.08);
      lctx.beginPath(); lctx.moveTo(0, -r * 0.8); lctx.lineTo(0, r * 1.25); lctx.stroke();
      lctx.restore();
    }
  }

  /* ---------------- the writing at the end ---------------- */
  const stopEl = document.querySelector('.stop');
  if (stopEl) {
    stopEl.setAttribute('tabindex', '-1');
    const kids = stopEl.querySelectorAll(':scope > *, :scope .body > *');
    kids.forEach((k, i) => { k.style.transitionDelay = `${(0.3 + i * 0.35).toFixed(2)}s`; });
  }

  /* ---------------- state ---------------- */
  let walk = 0, walkVel = 0, stride = 0, time = 0, last = performance.now();
  let dusk = 0, glow = 0, needsFrame = true, renderedWalk = NaN, here = false;
  const cue = document.querySelector('.scroll-cue');

  function smoothDamp(cur, tgt, v, smoothTime, maxSpeed, dt) {
    const omega = 2 / smoothTime, x = omega * dt;
    const e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const change = clamp(cur - tgt, -maxSpeed * smoothTime, maxSpeed * smoothTime);
    const temp = (v + omega * change) * dt;
    let nv = (v - omega * temp) * e, out = cur - change + (change + temp) * e;
    if ((tgt - cur > 0) === (out > tgt)) { out = tgt; nv = 0; }
    return [out, nv];
  }

  function resize() {
    W = scene.clientWidth; H = scene.clientHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const c of [glCanvas, leafCanvas]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    if (gl) gl.viewport(0, 0, glCanvas.width, glCanvas.height);
    layoutTrack();
    needsFrame = true;
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!reduced) time += dt;

    const prev = walk;
    if (reduced) { walk = target(); walkVel = 0; }
    else [walk, walkVel] = smoothDamp(walk, target(), walkVel, 0.5, 0.35, dt);
    const step = walk - prev;

    // a footstep bob while moving forward or back, fading out as you stop
    const speed = Math.abs(walkVel);
    stride += Math.abs(step) * 38;
    const bob = reduced ? 0 : Math.sin(stride * Math.PI) * 0.0035 * smooth(0.005, 0.06, speed);

    dusk = smooth(0.25, 1, walk);
    glow = smooth(0.62, 0.98, walk);

    if (cue) cue.style.opacity = window.scrollY < 8 ? '1' : '0';

    const arrived = walk > 0.985;
    if (stopEl && arrived !== here) { here = arrived; stopEl.classList.toggle('is-here', here); }

    // screen position of the vanishing point, for the leaves
    let vpx = W * 0.5, vpy = H * 0.5;
    if (gl && tex) {
      const [x0, y0, ww, wh] = coverWindow();
      vpx = (VP.x - x0) / ww * W; vpy = (VP.y - y0) / wh * H;
      if (!reduced || needsFrame || walk !== renderedWalk) {
        gl.uniform1i(uni.img, 0);
        gl.uniform2f(uni.win0, x0, y0); gl.uniform2f(uni.winSize, ww, wh);
        gl.uniform2f(uni.vp, VP.x, VP.y); gl.uniform1f(uni.aspect, imgW / imgH);
        gl.uniform1f(uni.walk, walk); gl.uniform1f(uni.bob, bob);
        gl.uniform1f(uni.dusk, dusk); gl.uniform1f(uni.glow, glow); gl.uniform1f(uni.t, time);
        gl.uniform2f(uni.glowPos, VP.x - 0.004, VP.y - 0.012);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        renderedWalk = walk; needsFrame = false;
      }
    } else {
      root.style.setProperty('--zoom', (1 + walk * 1.3).toFixed(4));
      still.style.filter = `brightness(${(1 - dusk * 0.35).toFixed(3)}) saturate(${(1 - dusk * 0.3).toFixed(3)})`;
    }
    drawLeaves(dt, step * 3.2, vpx, vpy);

    if (!reduced) requestAnimationFrame(frame);
  }

  /* ---------------- wiring ---------------- */
  const hasGL = glCanvas && initGL();
  if (!hasGL) body.classList.add('no-webgl');

  function loadPhoto() {
    const wantLarge = Math.max(screen.width, screen.height) * (window.devicePixelRatio || 1) > 1900;
    const src = wantLarge && still.dataset.large ? still.dataset.large : still.currentSrc || still.src;
    const go = (img) => { uploadTexture(img); if (reduced) requestAnimationFrame(frame); };
    if (src === (still.currentSrc || still.src) && still.complete && still.naturalWidth) { go(still); return; }
    const im = new Image();
    im.onload = () => go(im);
    im.onerror = () => { if (still.complete && still.naturalWidth) go(still); else still.addEventListener('load', () => go(still), { once: true }); };
    im.src = src;
    // show the small one while the large one loads
    if (still.complete && still.naturalWidth) uploadTexture(still);
    else still.addEventListener('load', () => { if (!tex) uploadTexture(still); }, { once: true });
  }
  if (hasGL) loadPhoto();

  window.addEventListener('scroll', () => { if (reduced) requestAnimationFrame(frame); }, { passive: true });
  window.addEventListener('resize', () => { resize(); if (reduced) requestAnimationFrame(frame); });
  motionQuery.addEventListener?.('change', (e) => { reduced = e.matches; last = performance.now(); requestAnimationFrame(frame); });

  document.querySelector('.skip')?.addEventListener('click', (e) => {
    e.preventDefault();
    window.scrollTo(0, maxScroll);
    walk = 1;
    if (stopEl) setTimeout(() => stopEl.focus({ preventScroll: true }), 60);
  });

  resize();
  layoutTrack(true);
  walk = target();
  if (location.hash === '#writing') { window.scrollTo(0, maxScroll); walk = 1; }
  if (/[?&]debug\b/.test(location.search)) window.__walk = () => ({ walk, walkVel, dusk, glow, gl: !!gl });
  requestAnimationFrame(frame);
})();
