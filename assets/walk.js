/* The Walk — ivanloughman.com
 *
 * A side-on world drawn procedurally on one canvas. Scrolling is walking:
 * the figure follows the scroll position (eased, with a top speed, so a fast
 * scroll makes him run). Each post is a stop at a lamp; when he arrives and
 * stands still, the post fades in beside him.
 *
 * World units are viewport heights (1 unit = canvas height). Layers have a
 * parallax factor p (1 = the walker's plane) and a fog amount (0 = darkest
 * silhouette, 1 = dissolved into the fog colour).
 */
(() => {
  'use strict';

  const canvas = document.querySelector('canvas.world');
  const root = document.documentElement;
  if (!canvas || !canvas.getContext) { root.classList.remove('js'); return; }
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) { root.classList.remove('js'); return; }
  window.walkReady = true;

  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = motionQuery.matches;

  /* ---------------- utilities ---------------- */
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const TAU = Math.PI * 2;

  function hash(i, seed = 0) {
    let h = Math.imul((i | 0) ^ Math.imul(seed + 1, 0x9e3779b1), 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function noise1(x, seed) {
    const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
    return lerp(hash(i, seed), hash(i + 1, seed), u);
  }
  function fbm1(x, seed) {
    return noise1(x, seed) * 0.55 + noise1(x * 2.1, seed + 9) * 0.3 + noise1(x * 4.3, seed + 17) * 0.15;
  }

  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

  /* ---------------- palette: dusk falls as you walk ---------------- */
  const KEYS = [
    { t: 0.00, top: hex('#7c878c'), hor: hex('#c4c9c3'), sil: hex('#16191b') },
    { t: 0.40, top: hex('#6a7378'), hor: hex('#aab0aa'), sil: hex('#141618') },
    { t: 0.72, top: hex('#3e464a'), hor: hex('#737a76'), sil: hex('#101214') },
    { t: 1.00, top: hex('#1c2124'), hor: hex('#3f4646'), sil: hex('#0b0c0d') },
  ];
  const P = { top: KEYS[0].top, hor: KEYS[0].hor, sil: KEYS[0].sil, t: 0 };
  function setPalette(t) {
    let k = 0;
    while (k < KEYS.length - 2 && t > KEYS[k + 1].t) k++;
    const a = KEYS[k], b = KEYS[k + 1], u = smooth(a.t, b.t, t);
    P.top = mix(a.top, b.top, u); P.hor = mix(a.hor, b.hor, u); P.sil = mix(a.sil, b.sil, u); P.t = t;
  }
  const fogged = (amt, a = 1) => rgb(mix(P.sil, P.hor, amt), a);

  const WARM = hex('#e9d6a3');
  const SHIRT = hex('#8e2a23');
  const SHIRT_FAR = hex('#6a1f1a');

  /* ---------------- the route ---------------- */
  const stopEls = Array.from(document.querySelectorAll('.stop'));
  const START = 0.55;
  const LAMP0 = 11.4, LAMP_GAP = 6.5;
  const lampX = (stopEls.length ? stopEls : [null]).map((_, i) => LAMP0 + i * LAMP_GAP);
  const standX = lampX.map((x) => x - 0.115);           // where he stands, under the light
  const END = standX[standX.length - 1];

  // Terrain zones by world x.
  const forest = (x) => 1 - smooth(3.0, 4.8, x);
  const field = (x) => smooth(3.4, 4.6, x) * (1 - smooth(7.8, 8.6, x));
  const industry = (x) => smooth(7.7, 8.5, x);

  function groundY(x) {
    let y = 0.80 + 0.014 * (fbm1(x * 0.7, 7) - 0.5) * 2 + 0.005 * Math.sin(x * 2.3);
    for (const lx of lampX) y = lerp(y, 0.80, 1 - smooth(0.3, 1.0, Math.abs(x - lx)));
    return y;
  }

  /* ---------------- canvas sizing ---------------- */
  let W = 0, H = 0, U = 0, dpr = 1, aspect = 1;
  let fig = null, figCtx = null, figW = 0, figH = 0, figPad = 0;
  const BOY_H = 0.085;

  function resize() {
    W = canvas.clientWidth; H = canvas.clientHeight; U = H; aspect = W / H;
    dpr = Math.min(window.devicePixelRatio || 1, W < 700 ? 1.5 : 1.75);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    const bh = BOY_H * U;
    figW = Math.ceil(bh * 1.4); figH = Math.ceil(bh * 1.35); figPad = Math.ceil(bh * 0.12);
    fig = document.createElement('canvas');
    fig.width = Math.ceil(figW * dpr); fig.height = Math.ceil(figH * dpr);
    figCtx = fig.getContext('2d');
    placeStops();
    const before = stops.map((s) => s.pages.length).join();
    paginate();
    layoutTrack(stops.map((s) => s.pages.length).join() !== before);
    if (typeof showPages === 'function') showPages();
    needsFrame = true;
  }

  /* ---------------- scroll → distance ---------------- */
  const track = document.querySelector('.track');
  let points = [], stableVH = 0, lastW = 0;

  function layoutTrack(force) {
    const vh = window.innerHeight;
    // Ignore small height changes (mobile URL bar) so the scroll position doesn't jump.
    if (!force && W === lastW && stableVH && Math.abs(vh - stableVH) / stableVH < 0.2) return;
    stableVH = vh; lastW = W;
    const ppu = 0.55 * vh;
    points = [{ s: 0, x: START }];
    let s = 0, prev = START;
    for (const [i, sx] of standX.entries()) {
      const pages = stops[i] ? stops[i].pages.length : 1;
      const dwell = vh * (0.5 + 0.75 * pages);       // time standing at the lamp: more pages, longer stay
      s += (sx - prev) * ppu; points.push({ s, x: sx });
      s += dwell; points.push({ s, x: sx });
      prev = sx;
    }
    track.style.setProperty('--track', `${Math.ceil(s + vh)}px`);
    track.style.height = `${Math.ceil(s + vh)}px`;
  }
  function scrollToX(sc) {
    if (sc <= 0) return points[0].x;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      if (sc <= b.s) return b.s === a.s ? b.x : lerp(a.x, b.x, (sc - a.s) / (b.s - a.s));
    }
    return points[points.length - 1].x;
  }
  const stopScroll = (i) => points[1 + i * 2].s + 0.02 * (points[2 + i * 2].s - points[1 + i * 2].s);

  /* ---------------- stops (posts) ---------------- */
  // A post is shown beside the lamp a page at a time (as many stanzas or paragraphs as fit).
  // While he stands in the light, scrolling on turns the page; his walk resumes after the last.
  const stops = stopEls.map((el) => {
    el.setAttribute('tabindex', '-1');
    const poem = el.classList.contains('poem');
    const blocks = Array.from(el.querySelectorAll('.body > p, .body > blockquote, .body > ul, .body > ol, .body > pre'));
    blocks.forEach((b) => {
      b.classList.add('stanza');
      if (poem && b.tagName === 'P') {
        b.innerHTML = b.innerHTML.split('\n').filter((l) => l.trim()).map((l) => `<span class="line">${l}</span>`).join('\n');
      } else {
        b.innerHTML = `<span class="line">${b.innerHTML}</span>`;
      }
    });
    const pager = document.createElement('p');
    pager.className = 'pager'; pager.setAttribute('aria-hidden', 'true');
    el.querySelector('.body').after(pager);
    const h = el.querySelector('h2'); if (h) h.style.transitionDelay = '0.15s';
    return { el, blocks, pager, pages: [blocks.map((_, i) => i)], page: -1 };
  });

  function paginate() {
    const narrow = aspect < 0.8 || W < 704;
    const avail = window.innerHeight * (narrow ? 0.46 : 0.5);
    for (const s of stops) {
      s.blocks.forEach((b) => { b.hidden = false; });
      const hs = s.blocks.map((b) => b.getBoundingClientRect().height + parseFloat(getComputedStyle(b).marginBottom || 0));
      s.pages = []; let cur = [], h = 0;
      hs.forEach((bh, i) => {
        if (cur.length && h + bh > avail) { s.pages.push(cur); cur = []; h = 0; }
        cur.push(i); h += bh;
      });
      if (cur.length) s.pages.push(cur);
      if (!s.pages.length) s.pages = [[]];
      s.page = -1;
    }
  }

  function showPage(s, k) {
    if (s.page === k) return;
    s.page = k;
    const on = new Set(s.pages[k]);
    s.blocks.forEach((b, i) => { b.classList.remove('on'); b.hidden = !on.has(i); });
    let n = 0;
    const first = k === 0 ? 0.7 : 0.2;
    for (const i of s.pages[k]) {
      s.blocks[i].querySelectorAll('.line').forEach((l) => { l.style.transitionDelay = `${(first + n++ * 0.42).toFixed(2)}s`; });
    }
    s.el.style.setProperty('--last-delay', `${(first + n * 0.42 + 0.2).toFixed(2)}s`);
    s.el.classList.toggle('last-page', k === s.pages.length - 1);
    s.pager.textContent = s.pages.length > 1 ? `${k + 1} / ${s.pages.length}` : '';
    // next frame, so the newly shown lines fade in rather than appear
    requestAnimationFrame(() => requestAnimationFrame(() => { if (s.page === k) for (const i of s.pages[k]) s.blocks[i].classList.add('on'); }));
  }

  function pageFor(i, sc) {
    const a = points[1 + i * 2].s, b = points[2 + i * 2].s, n = stops[i].pages.length;
    if (sc <= a) return 0;
    return Math.min(n - 1, Math.floor(clamp((sc - a) / (b - a)) * n));
  }
  function showPages() { stops.forEach((s, i) => showPage(s, pageFor(i, window.scrollY))); }

  const boyFrac = () => (aspect < 0.8 ? 0.24 : 0.34);
  function placeStops() {
    // Text sits to the right of the lamp, in the dark above the far skyline.
    const lampScreen = boyFrac() * aspect + 0.115;
    const x = clamp((lampScreen + 0.16) / aspect, 0.3, 0.56);
    stopEls.forEach((el) => {
      el.style.setProperty('--stop-x', `${(x * 100).toFixed(2)}%`);
      el.style.setProperty('--stop-y', '18%');
    });
  }

  /* ---------------- fog texture ---------------- */
  // A horizontally tileable fBm alpha mask, tinted twice (day / dusk) and crossfaded.
  function makeFog(tint, seed) {
    const w = 384, h = 96, c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d'), img = g.createImageData(w, h);
    const per = 6;
    const vn = (x, y, s) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      const r = (a, b) => hash(((a % per) + per) % per + b * 131, s);
      return lerp(lerp(r(xi, yi), r(xi + 1, yi), u), lerp(r(xi, yi + 1), r(xi + 1, yi + 1), u), v);
    };
    for (let y = 0; y < h; y++) {
      const band = Math.sin(Math.PI * y / (h - 1)); // fade top and bottom
      for (let x = 0; x < w; x++) {
        const fx = x / w * per, fy = y / h * 1.6;
        let n = vn(fx, fy, seed) * 0.55;
        n += vn(fx * 2, fy * 2, seed + 3) * 0.28 * 1; // octave periods stay multiples of per
        n += vn(fx * 4, fy * 4, seed + 7) * 0.17;
        const a = clamp((n - 0.32) * 2.2) * band * band;
        const o = (y * w + x) * 4;
        img.data[o] = tint[0]; img.data[o + 1] = tint[1]; img.data[o + 2] = tint[2];
        img.data[o + 3] = a * 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }
  // Octaves scale fx by whole numbers, so wrapping every octave at `per` keeps the texture seamless.
  const fogDay = makeFog(hex('#d9dcd6'), 11);
  const fogDusk = makeFog(hex('#5f6766'), 11);

  function fogBank(p, yCenter, height, alpha, drift, offset = 0) {
    if (alpha <= 0.002) return;
    const bw = W * 1.9, bh = height * U;
    let x0 = -(((cam * p * U + time * drift * U + offset * W) % bw) + bw) % bw;
    const y0 = yCenter * U - bh / 2;
    ctx.globalAlpha = alpha * (1 - P.t);
    for (let x = x0; x < W; x += bw) ctx.drawImage(fogDay, x, y0, bw, bh);
    ctx.globalAlpha = alpha * P.t;
    for (let x = x0; x < W; x += bw) ctx.drawImage(fogDusk, x, y0, bw, bh);
    ctx.globalAlpha = 1;
  }

  /* ---------------- drawing helpers ---------------- */
  const sx = (X, p) => (X - cam * p) * U;            // layer x → screen px
  const range = (p, m = 0.3) => [cam * p - m, cam * p + aspect + m];

  function ridge(p, base, amp, freq, seed, fog) {
    const [a, b] = range(p, 0.1);
    ctx.fillStyle = fogged(fog);
    ctx.beginPath(); ctx.moveTo(sx(a, p), H);
    for (let X = a; X <= b + 0.02; X += 0.02) {
      ctx.lineTo(sx(X, p), (base + amp * (fbm1(X * freq, seed) - 0.5) * 2) * U);
    }
    ctx.lineTo(sx(b + 0.02, p), H); ctx.closePath(); ctx.fill();
  }

  function trunk(x, base, top, w, lean) {
    ctx.moveTo(x - w / 2, base); ctx.lineTo(x + w / 2, base);
    ctx.lineTo(x + lean + w * 0.32, top); ctx.lineTo(x + lean - w * 0.32, top); ctx.closePath();
  }

  function trees(p, cell, seed, fog, base, wMin, wMax, density, branches) {
    const [a, b] = range(p, 0.4);
    ctx.fillStyle = fogged(fog); ctx.strokeStyle = fogged(fog);
    ctx.beginPath();
    const br = [];
    for (let k = Math.floor(a / cell); k <= Math.ceil(b / cell); k++) {
      const X = (k + hash(k, seed) * 0.8) * cell;
      if (hash(k, seed + 1) > density(X / p)) continue;
      const w = lerp(wMin, wMax, hash(k, seed + 2)) * U;
      const x = sx(X, p), bY = (base + hash(k, seed + 3) * 0.02) * U;
      const lean = (hash(k, seed + 4) - 0.5) * 0.04 * U;
      trunk(x, bY, -0.08 * U, w, lean);
      if (branches) {
        const nb = 1 + Math.floor(hash(k, seed + 5) * 4);
        for (let j = 0; j < nb; j++) {
          const r = (n) => hash(k * 7 + j, seed + n);
          const t = 0.3 + r(6) * 0.45;
          const y = lerp(bY, -0.08 * U, t), xx = x + lean * t;
          const dir = r(8) > 0.5 ? 1 : -1;
          const len = (0.025 + r(9) * 0.06) * U;
          const rise = 0.55 + r(10) * 0.7;               // steep, reaching up
          const ex = xx + dir * len, ey = y - len * rise;
          br.push([xx, y, ex, ey, w * 0.16]);
          if (r(11) > 0.45) {                              // a twig off the branch
            const tx = lerp(xx, ex, 0.55), ty = lerp(y, ey, 0.55);
            br.push([tx, ty, tx + dir * len * 0.18, ty - len * 0.45, w * 0.08]);
          }
        }
      }
    }
    ctx.fill();
    ctx.lineCap = 'round';
    for (const [x1, y1, x2, y2, lw] of br) {
      ctx.lineWidth = Math.max(0.8, lw); ctx.beginPath(); ctx.moveTo(x1, y1);
      // a slight upward bow, never a droop
      ctx.quadraticCurveTo(lerp(x1, x2, 0.35), lerp(y1, y2, 0.6), x2, y2); ctx.stroke();
    }
  }

  /* ---------------- far skyline ---------------- */
  const SKY_P = 0.16, SKY_FOG = 0.74, SKY_BASE = 0.735;
  const skyline = [
    ['cool', 1.95, 0.13, 0.17], ['cool', 2.16, 0.11, 0.14],
    ['chim', 2.55, 0.012, 0.30], ['chim', 2.64, 0.010, 0.26],
    ['hall', 2.82, 0.32, 0.075], ['silo', 3.22, 0.04, 0.13], ['silo', 3.28, 0.04, 0.13], ['silo', 3.34, 0.04, 0.115],
    ['mast', 3.55, 0.006, 0.36], ['hall', 3.75, 0.25, 0.05], ['chim', 3.95, 0.014, 0.24],
  ];
  function drawSkyline() {
    ctx.fillStyle = fogged(SKY_FOG);
    const base = SKY_BASE * U;
    for (const [kind, X, w, h] of skyline) {
      const x = sx(X, SKY_P), ww = w * U, hh = h * U;
      if (x < -ww * 2 - 0.3 * U || x > W + ww * 2 + 0.3 * U) continue;
      ctx.beginPath();
      if (kind === 'cool') {
        ctx.moveTo(x - ww / 2, base);
        ctx.quadraticCurveTo(x - ww * 0.3, base - hh * 0.65, x - ww * 0.34, base - hh);
        ctx.lineTo(x + ww * 0.34, base - hh);
        ctx.quadraticCurveTo(x + ww * 0.3, base - hh * 0.65, x + ww / 2, base);
      } else if (kind === 'chim') {
        ctx.moveTo(x - ww / 2, base); ctx.lineTo(x - ww * 0.35, base - hh);
        ctx.lineTo(x + ww * 0.35, base - hh); ctx.lineTo(x + ww / 2, base);
      } else if (kind === 'hall') {
        ctx.moveTo(x, base); ctx.lineTo(x, base - hh);
        const teeth = 7, tw = ww / teeth;
        for (let i = 0; i < teeth; i++) { ctx.lineTo(x + tw * i + tw * 0.75, base - hh - 0.022 * U); ctx.lineTo(x + tw * (i + 1), base - hh); }
        ctx.lineTo(x + ww, base);
      } else if (kind === 'silo') {
        ctx.rect(x - ww / 2, base - hh, ww, hh);
        ctx.moveTo(x + ww / 2, base - hh); ctx.arc(x, base - hh, ww / 2, 0, Math.PI, true);
      } else if (kind === 'mast') {
        ctx.moveTo(x - ww * 3, base); ctx.lineTo(x, base - hh); ctx.lineTo(x + ww * 3, base);
      }
      ctx.closePath(); ctx.fill();
      if (kind === 'chim') smoke(x, base - hh, X);
      ctx.fillStyle = fogged(SKY_FOG);
    }
  }
  function smoke(x, y, seed) {
    const light = mix(P.hor, [235, 237, 232], 0.25 * (1 - P.t));
    for (let k = 0; k < 9; k++) {
      const age = ((time * 0.022 + k / 9 + seed) % 1);
      const px = x + age * 0.26 * U + Math.sin(age * 5 + seed) * 0.01 * U;
      const py = y - age * 0.09 * U - 0.004 * U;
      const r = (0.008 + age * 0.05) * U;
      const g = ctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, rgb(light, 0.32 * (1 - age))); g.addColorStop(1, rgb(light, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, r, 0, TAU); ctx.fill();
    }
  }

  /* ---------------- pylons (p 0.5) ---------------- */
  const PY_P = 0.5, PY_FOG = 0.5;
  const pylonX = [1.55, 2.85, 4.15, 5.45, 6.75];
  function drawPylons() {
    const base = 0.775 * U, h = 0.46 * U;
    ctx.strokeStyle = fogged(PY_FOG); ctx.lineWidth = Math.max(1, 0.0028 * U);
    const tops = [];
    for (const X of pylonX) {
      const x = sx(X, PY_P);
      if (x < -0.6 * U || x > W + 0.6 * U) { tops.push(null); continue; }
      const bw = 0.07 * U, tw = 0.012 * U;
      const L = (t) => [lerp(x - bw / 2, x - tw / 2, t), base - h * t];
      const R = (t) => [lerp(x + bw / 2, x + tw / 2, t), base - h * t];
      ctx.beginPath();
      ctx.moveTo(...L(0)); ctx.lineTo(...L(1)); ctx.moveTo(...R(0)); ctx.lineTo(...R(1));
      const levels = [0, 0.18, 0.34, 0.48, 0.6, 0.71, 0.8, 0.88, 1];
      for (let i = 0; i < levels.length - 1; i++) {
        ctx.moveTo(...L(levels[i])); ctx.lineTo(...R(levels[i + 1]));
        ctx.moveTo(...R(levels[i])); ctx.lineTo(...L(levels[i + 1]));
        ctx.moveTo(...L(levels[i + 1])); ctx.lineTo(...R(levels[i + 1]));
      }
      for (const [ty, aw] of [[0.72, 0.09], [0.86, 0.065]]) {
        const y = base - h * ty;
        ctx.moveTo(x - aw * U, y); ctx.lineTo(x + aw * U, y);
        ctx.moveTo(x - aw * U, y); ctx.lineTo(x - 0.015 * U, y - 0.03 * U);
        ctx.moveTo(x + aw * U, y); ctx.lineTo(x + 0.015 * U, y - 0.03 * U);
      }
      ctx.stroke();
      tops.push(x);
    }
    // wires
    ctx.lineWidth = Math.max(0.6, 0.0012 * U);
    ctx.beginPath();
    for (let i = 0; i < pylonX.length - 1; i++) {
      const x1 = sx(pylonX[i], PY_P), x2 = sx(pylonX[i + 1], PY_P);
      if (x2 < 0 || x1 > W) continue;
      for (const [ty, aw] of [[0.72, -0.09], [0.72, 0.09], [0.86, -0.065], [0.86, 0.065]]) {
        const y = base - h * ty;
        ctx.moveTo(x1 + aw * U, y);
        ctx.quadraticCurveTo((x1 + x2) / 2 + aw * U, y + 0.09 * U, x2 + aw * U, y);
      }
    }
    ctx.stroke();
  }

  /* ---------------- near-background props (p 0.9) ---------------- */
  const NB_P = 0.9, NB_FOG = 0.16;
  const poles = [4.3, 6.0, 7.7].map((x) => x * NB_P);
  const POLE_H = 0.33;
  const nbBase = (X) => (groundY(X / NB_P) - 0.012) * U;
  function wireY(i, u, which) {
    const y = POLE_H - (which === 0 ? 0 : 0.012);
    return nbBase(poles[i]) - y * U + 0.035 * U * 4 * u * (1 - u);
  }
  function drawPoles() {
    ctx.strokeStyle = fogged(NB_FOG); ctx.fillStyle = fogged(NB_FOG);
    for (const X of poles) {
      const x = sx(X, NB_P);
      if (x < -0.5 * U || x > W + 0.5 * U) continue;
      const b = nbBase(X), top = b - POLE_H * U;
      ctx.beginPath(); trunk(x, b, top, 0.009 * U, 0); ctx.fill();
      ctx.fillRect(x - 0.035 * U, top + 0.012 * U, 0.07 * U, 0.004 * U);
      for (const dx of [-0.03, 0.03]) ctx.fillRect(x + dx * U - 0.002 * U, top + 0.006 * U, 0.004 * U, 0.008 * U);
    }
    ctx.lineWidth = Math.max(0.6, 0.0011 * U);
    ctx.beginPath();
    for (let i = 0; i < poles.length - 1; i++) {
      const x1 = sx(poles[i], NB_P), x2 = sx(poles[i + 1], NB_P);
      if (x2 < 0 || x1 > W) continue;
      for (const dx of [-0.03, 0.03]) {
        const y = nbBase(poles[i]) - (POLE_H - 0.008) * U;
        const y2 = nbBase(poles[i + 1]) - (POLE_H - 0.008) * U;
        ctx.moveTo(x1 + dx * U, y);
        ctx.quadraticCurveTo((x1 + x2) / 2 + dx * U, (y + y2) / 2 + 0.07 * U, x2 + dx * U, y2);
      }
    }
    ctx.stroke();
  }

  // Crows on the wire between the first two poles; they lift off as he passes.
  const birds = [0.22, 0.27, 0.41, 0.47, 0.58, 0.63].map((u, i) => ({ u, i, flown: -1, seed: hash(i, 77) }));
  function birdPerch(b) {
    const x1 = poles[0], x2 = poles[1];
    const X = lerp(x1, x2, b.u);
    const y1 = nbBase(x1) - (POLE_H - 0.008) * U, y2 = nbBase(x2) - (POLE_H - 0.008) * U;
    const sx1 = sx(x1, NB_P), sx2 = sx(x2, NB_P);
    const t = b.u;
    // point on the quadratic wire (dx = +0.03 side)
    const cx = (sx1 + sx2) / 2, cy = (y1 + y2) / 2 + 0.07 * U;
    const px = (1 - t) * (1 - t) * sx1 + 2 * (1 - t) * t * cx + t * t * sx2 + 0.03 * U;
    const py = (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * cy + t * t * y2;
    return [px, py, X];
  }
  function drawBirds(boyScreen) {
    ctx.fillStyle = fogged(NB_FOG); ctx.strokeStyle = fogged(NB_FOG);
    ctx.lineWidth = Math.max(1, 0.0022 * U); ctx.lineCap = 'round';
    for (const b of birds) {
      let [px, py] = birdPerch(b);
      if (b.flown < 0 && Math.abs(boyScreen - px) < 0.28 * U + b.seed * 0.12 * U && !reduced) b.flown = time;
      if (b.flown >= 0 && boyScreen < px - 1.4 * U) b.flown = -1;          // they come back once he's far behind
      const s = 0.0075 * U;
      if (b.flown < 0) {
        if (px < -20 || px > W + 20) continue;
        ctx.beginPath(); ctx.ellipse(px, py - s * 0.6, s * 0.9, s * 0.55, -0.2, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(px + s * 0.75, py - s * 1.15, s * 0.38, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.moveTo(px - s * 0.7, py - s * 0.4); ctx.lineTo(px - s * 1.6, py + s * 0.2); ctx.stroke();
      } else {
        const t = time - b.flown;
        if (t > 8) continue;
        const fx = px + (0.10 + b.seed * 0.08) * U * t + 0.02 * U * t * t;
        const fy = py - (0.06 + b.seed * 0.05) * U * t - 0.012 * U * Math.sin(t * 2 + b.seed * 6);
        const flap = Math.sin(time * (16 + b.seed * 6) + b.seed * 10);
        const span = s * 1.6;
        ctx.beginPath();
        ctx.moveTo(fx - span, fy - flap * span * 0.7);
        ctx.quadraticCurveTo(fx - span * 0.4, fy - span * 0.2, fx, fy);
        ctx.quadraticCurveTo(fx + span * 0.4, fy - span * 0.2, fx + span, fy - flap * span * 0.7);
        ctx.stroke();
      }
    }
  }

  // Chain-link fence with an open gate, then a concrete wall.
  const FENCE = [[8.05, 8.95], [9.32, 9.9], [10.72, 11.05]].map(([a, b]) => [a * NB_P, b * NB_P]);
  const GATE = [8.95 * NB_P, 9.32 * NB_P];
  const WALL = [9.95 * NB_P, 10.66 * NB_P];
  const FENCE_H = 0.15;
  function drawFence() {
    const col = fogged(NB_FOG);
    ctx.fillStyle = col; ctx.strokeStyle = col;
    const fx = (X) => sx(X, NB_P);
    for (const [a, b] of FENCE) {
      const xa = fx(a), xb = fx(b);
      if (xb < -10 || xa > W + 10) continue;
      const top = (X) => nbBase(X) - FENCE_H * U;
      // posts
      for (let X = a; X <= b + 1e-6; X += 0.11) {
        const x = fx(X); ctx.fillRect(x - 0.0025 * U, top(X) - 0.004 * U, 0.005 * U, FENCE_H * U + 0.006 * U);
      }
      // rail
      ctx.lineWidth = Math.max(1, 0.003 * U);
      ctx.beginPath(); ctx.moveTo(xa, top(a)); ctx.lineTo(xb, top(b)); ctx.stroke();
      // mesh
      ctx.save();
      ctx.beginPath(); ctx.rect(xa, top(a) - 2, xb - xa, FENCE_H * U + 4); ctx.clip();
      ctx.globalAlpha = 0.32; ctx.lineWidth = Math.max(0.5, 0.0008 * U);
      const step = 0.011 * U, hh = FENCE_H * U, y0 = top(a);
      ctx.beginPath();
      for (let x = xa - hh; x < xb + hh; x += step) {
        ctx.moveTo(x, y0); ctx.lineTo(x + hh, y0 + hh);
        ctx.moveTo(x + hh, y0); ctx.lineTo(x, y0 + hh);
      }
      ctx.stroke(); ctx.restore();
    }
    // the open gate: a leaf swung toward us, foreshortened
    const ga = fx(GATE[0]), gb = fx(GATE[1]);
    if (gb > -40 && ga < W + 40) {
      const b0 = nbBase(GATE[1]), t0 = b0 - FENCE_H * U;
      const lx = gb - 0.075 * U;
      ctx.lineWidth = Math.max(1, 0.003 * U);
      ctx.beginPath();
      ctx.moveTo(gb, t0); ctx.lineTo(lx, t0 - 0.008 * U); ctx.lineTo(lx, b0 + 0.016 * U); ctx.lineTo(gb, b0);
      ctx.moveTo(gb, b0); ctx.lineTo(lx, t0 - 0.008 * U);
      ctx.stroke();
      ctx.fillRect(ga - 0.003 * U, nbBase(GATE[0]) - FENCE_H * U - 0.006 * U, 0.006 * U, FENCE_H * U + 0.008 * U);
      ctx.fillRect(gb - 0.003 * U, t0 - 0.006 * U, 0.006 * U, FENCE_H * U + 0.008 * U);
    }
    // wall
    const wa = fx(WALL[0]), wb = fx(WALL[1]);
    if (wb > -10 && wa < W + 10) {
      // precast panels, uneven heights, one broken; a little lighter where the sky catches the top
      const b = nbBase((WALL[0] + WALL[1]) / 2) + 0.004 * U, pw = 0.105 * U;
      let i = 0;
      for (let x = wa; x < wb - 1; x += pw, i++) {
        const w = Math.min(pw, wb - x) - Math.max(1, 0.002 * U);
        const h = (0.085 + hash(i, 701) * 0.018) * U;
        const broken = i === 3;
        ctx.fillStyle = fogged(NB_FOG);
        ctx.beginPath();
        ctx.moveTo(x, b + 0.01 * U); ctx.lineTo(x, b - h);
        if (broken) { ctx.lineTo(x + w * 0.35, b - h); ctx.lineTo(x + w * 0.55, b - h * 0.55); ctx.lineTo(x + w * 0.8, b - h * 0.7); ctx.lineTo(x + w, b - h * 0.62); }
        else ctx.lineTo(x + w, b - h);
        ctx.lineTo(x + w, b + 0.01 * U); ctx.closePath(); ctx.fill();
        if (!broken) { ctx.fillStyle = fogged(NB_FOG + 0.1); ctx.fillRect(x, b - h, w, Math.max(1, 0.0025 * U)); }
        // rain streaks
        ctx.fillStyle = fogged(NB_FOG + 0.035);
        if (!broken) for (let s = 0; s < 3; s++) ctx.fillRect(x + w * (0.2 + hash(i * 3 + s, 702) * 0.6), b - h + 0.003 * U, Math.max(1, 0.0012 * U), h * (0.25 + hash(i * 3 + s, 703) * 0.4));
      }
    }
  }

  /* ---------------- the walker's plane (p 1) ---------------- */
  const GROUND_FOG = 0.05;
  function drawGround() {
    const [a, b] = range(1, 0.1);
    // fog sits on the surface; the earth darkens toward the viewer
    const g = ctx.createLinearGradient(0, 0.78 * U, 0, H);
    g.addColorStop(0, fogged(GROUND_FOG + 0.1)); g.addColorStop(0.18, fogged(GROUND_FOG));
    g.addColorStop(1, rgb(mix(P.sil, [0, 0, 0], 0.3)));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(sx(a, 1), H);
    for (let x = a; x <= b + 0.02; x += 0.015) ctx.lineTo(sx(x, 1), groundY(x) * U);
    ctx.lineTo(sx(b + 0.02, 1), H); ctx.closePath(); ctx.fill();
  }

  function grass(p, fog, seed, step, hMin, hMax, densityFn, yOff, sway) {
    const [a, b] = range(p, 0.05);
    ctx.strokeStyle = fogged(fog); ctx.lineWidth = Math.max(0.8, 0.0018 * U); ctx.lineCap = 'round';
    ctx.beginPath();
    for (let k = Math.floor(a / step); k <= Math.ceil(b / step); k++) {
      const X = (k + hash(k, seed)) * step, wx = X / p;
      const d = densityFn(wx);
      if (d <= 0 || hash(k, seed + 1) > d) continue;
      const h = lerp(hMin, hMax, hash(k, seed + 2) * d) * U;
      const x = sx(X, p), y = (groundY(wx) + yOff) * U + 1;
      const bend = (Math.sin(time * 1.1 + X * 3.1) * 0.5 + Math.sin(time * 0.43 + X * 1.3) * 0.5) * sway * U
        + (hash(k, seed + 3) - 0.5) * 0.012 * U;
      ctx.moveTo(x, y); ctx.quadraticCurveTo(x + bend * 0.3, y - h * 0.6, x + bend, y - h);
    }
    ctx.stroke();
  }
  const grassDensity = (x) => field(x) * 0.95 + forest(x) * 0.35 + industry(x) * 0.12;

  function drawLampPost(L) {
    const x = sx(L, 1);
    if (x < -0.4 * U || x > W + 0.4 * U) return null;
    const b = groundY(L) * U, top = b - 0.40 * U;
    ctx.fillStyle = fogged(GROUND_FOG * 0.6); ctx.strokeStyle = fogged(GROUND_FOG * 0.6);
    ctx.beginPath(); trunk(x, b, top, 0.011 * U, 0); ctx.fill();
    ctx.fillRect(x - 0.011 * U, b - 0.03 * U, 0.022 * U, 0.03 * U);
    ctx.lineWidth = 0.006 * U; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, top + 0.004 * U);
    ctx.quadraticCurveTo(x, top - 0.03 * U, x - 0.06 * U, top - 0.028 * U);
    ctx.lineTo(x - 0.105 * U, top - 0.02 * U); ctx.stroke();
    const hx = x - 0.115 * U, hy = top - 0.012 * U;
    ctx.beginPath();
    ctx.moveTo(hx - 0.026 * U, hy + 0.012 * U); ctx.lineTo(hx - 0.012 * U, hy - 0.008 * U);
    ctx.lineTo(hx + 0.016 * U, hy - 0.008 * U); ctx.lineTo(hx + 0.026 * U, hy + 0.012 * U); ctx.closePath(); ctx.fill();
    return [hx, hy + 0.013 * U, b];
  }

  let flickerAt = 9, flickerUntil = 0;
  function lampIntensity() {
    if (reduced) return 1;
    if (time > flickerAt) { flickerUntil = time + 0.55; flickerAt = time + 8 + Math.random() * 14; }
    if (time < flickerUntil) {
      const f = Math.sin(time * 71) + Math.sin(time * 37);
      return f > 0.4 ? 1 : 0.25 + 0.2 * Math.random();
    }
    return 0.96 + 0.04 * Math.sin(time * 9.3) * Math.sin(time * 2.1);
  }

  function drawLampLight(bx, by, gy, I) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    // wide atmospheric glow in the fog
    let g = ctx.createRadialGradient(bx, by, 0, bx, by, 0.75 * U);
    g.addColorStop(0, rgb(WARM, 0.20 * I)); g.addColorStop(0.4, rgb(WARM, 0.07 * I)); g.addColorStop(1, rgb(WARM, 0));
    ctx.fillStyle = g; ctx.fillRect(bx - 0.8 * U, by - 0.8 * U, 1.6 * U, 1.6 * U);
    // cone
    const spread = 0.17 * U;
    g = ctx.createLinearGradient(0, by, 0, gy);
    g.addColorStop(0, rgb(WARM, 0.22 * I)); g.addColorStop(1, rgb(WARM, 0.05 * I));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(bx - 0.018 * U, by); ctx.lineTo(bx + 0.018 * U, by);
    ctx.lineTo(bx + spread, gy); ctx.lineTo(bx - spread, gy); ctx.closePath(); ctx.fill();
    // pool on the ground
    ctx.save(); ctx.translate(bx, gy); ctx.scale(1, 0.12);
    g = ctx.createRadialGradient(0, 0, 0, 0, 0, spread * 1.5);
    g.addColorStop(0, rgb(WARM, 0.42 * I)); g.addColorStop(1, rgb(WARM, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, spread * 1.5, 0, TAU); ctx.fill();
    ctx.restore();
    // halo + bulb
    g = ctx.createRadialGradient(bx, by, 0, bx, by, 0.09 * U);
    g.addColorStop(0, rgb([255, 244, 214], 0.95 * I)); g.addColorStop(0.15, rgb(WARM, 0.55 * I)); g.addColorStop(1, rgb(WARM, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(bx, by, 0.09 * U, 0, TAU); ctx.fill();
    ctx.restore();
  }

  function drawMoths(bx, by, I) {
    ctx.fillStyle = rgb([255, 240, 205], 0.75 * I);
    for (let i = 0; i < 3; i++) {
      const a = time * (1.7 + i * 0.6) + i * 2.1 + Math.sin(time * 3.1 + i) * 0.8;
      const r = (0.025 + 0.014 * Math.sin(time * 1.3 + i * 4)) * U;
      ctx.beginPath(); ctx.arc(bx + Math.cos(a) * r, by + 0.02 * U + Math.sin(a) * r * 0.6, Math.max(0.9, 0.0018 * U), 0, TAU); ctx.fill();
    }
  }

  /* ---------------- light shafts in the forest (p 0.6) ---------------- */
  function drawShafts() {
    const p = 0.6, cell = 0.55;
    const strength = (1 - P.t * 0.85);
    if (strength <= 0.02) return;
    const [a, b] = range(p, 0.9);
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    for (let k = Math.floor(a / cell); k <= Math.ceil(b / cell); k++) {
      const X = (k + hash(k, 401) * 0.7) * cell;
      const d = forest(X / p);
      if (hash(k, 402) > d * 0.85) continue;
      const x = sx(X, p), top = -0.05 * U, bot = 0.82 * U;
      const w = (0.03 + hash(k, 403) * 0.06) * U, slant = 0.32 * (bot - top);
      const breathe = 0.75 + 0.25 * Math.sin(time * 0.35 + k * 1.7);
      const g = ctx.createLinearGradient(0, top, 0, bot);
      const A = 0.15 * d * strength * breathe;
      g.addColorStop(0, 'rgba(240,242,234,0)'); g.addColorStop(0.35, `rgba(240,242,234,${A})`);
      g.addColorStop(0.8, `rgba(240,242,234,${A * 0.35})`); g.addColorStop(1, 'rgba(240,242,234,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(x - w / 2, top); ctx.lineTo(x + w / 2, top);
      ctx.lineTo(x + slant + w * 1.6, bot); ctx.lineTo(x + slant - w * 1.6, bot); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  /* ---------------- dust ---------------- */
  const motes = Array.from({ length: 70 }, (_, i) => [hash(i, 501), hash(i, 502), hash(i, 503)]);
  function drawDust() {
    const f = forest(boyX) * (1 - P.t);
    if (f <= 0.02) return;
    const span = W * 1.2;
    for (const [mx, my, ms] of motes) {
      const x = (((mx * span - cam * 0.75 * U + Math.sin(time * 0.21 + ms * 20) * 18) % span) + span) % span - W * 0.1;
      const y = ((my + time * 0.006 * (0.5 + ms)) % 1) * H * 0.85;
      ctx.fillStyle = `rgba(236,238,230,${(0.12 + ms * 0.25) * f})`;
      ctx.fillRect(x, y, 1 + ms * 1.4, 1 + ms * 1.4);
    }
  }

  /* ---------------- foreground (p 1.5) ---------------- */
  function drawForeground() {
    const p = 1.5, cell = 0.75, [a, b] = range(p, 0.5);
    const dark = rgb(mix(P.sil, [0, 0, 0], 0.35));
    ctx.fillStyle = dark; ctx.strokeStyle = dark;
    for (let k = Math.floor(a / cell); k <= Math.ceil(b / cell); k++) {
      const X = (k + hash(k, 601) * 0.6) * cell, wx = X / p;
      const x = sx(X, p), r = hash(k, 602);
      if (r < forest(wx) * 0.4) {
        ctx.beginPath(); trunk(x, H + 0.05 * U, -0.1 * U, (0.10 + hash(k, 603) * 0.08) * U, (hash(k, 604) - 0.5) * 0.06 * U); ctx.fill();
      } else if (r < forest(wx) * 0.4 + field(wx) * 0.7) {
        // a dark tuft of tall grass rising from the bottom edge
        ctx.lineWidth = 0.004 * U; ctx.lineCap = 'round'; ctx.beginPath();
        for (let j = 0; j < 26; j++) {
          const bx = x + (hash(k * 31 + j, 605) - 0.5) * 0.22 * U, h = (0.06 + hash(k * 31 + j, 606) * 0.13) * U;
          const bend = (Math.sin(time * 0.9 + j + X) * 0.012 + (hash(k * 31 + j, 607) - 0.5) * 0.05) * U;
          ctx.moveTo(bx, H + 2); ctx.quadraticCurveTo(bx + bend * 0.3, H - h * 0.6, bx + bend, H - h);
        }
        ctx.stroke();
      } else if (r < forest(wx) * 0.4 + field(wx) * 0.7 + industry(wx) * 0.45) {
        const w = 0.035 * U;
        ctx.fillRect(x - w / 2, 0.86 * U, w, H);
        ctx.fillRect(x - w, 0.86 * U, w * 2, 0.012 * U);
      }
    }
  }

  /* ---------------- the walker ---------------- */
  function limb(g, x, y, a1, a2, l1, l2, w, col) {
    const kx = x + Math.sin(a1) * l1, ky = y + Math.cos(a1) * l1;
    const ex = kx + Math.sin(a2) * l2, ey = ky + Math.cos(a2) * l2;
    g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(x, y); g.lineTo(kx, ky); g.lineTo(ex, ey); g.stroke();
    return [ex, ey];
  }

  function drawWalker(screenX, groundPx, lampDX, lampProx) {
    const g = figCtx, h = BOY_H * U;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, figW, figH);
    const ox = figW / 2, oy = figH - figPad;            // feet origin

    const amp = gait * (0.42 + 0.2 * run), lean = run * 0.16 + gait * 0.04;
    const L1 = 0.25 * h, L2 = 0.24 * h;
    // legs: place hip so the lower foot is on the ground (this gives the bob)
    const legs = [0, 1].map((s) => {
      const ph = phase + s * Math.PI;
      const a1 = amp * Math.sin(ph);
      const bend = 0.06 + gait * Math.max(0, Math.cos(ph)) * (0.55 + 0.7 * run);
      const a2 = a1 - bend;
      const fy = Math.cos(a1) * L1 + Math.cos(a2) * L2;
      return { a1, a2, fy, ph };
    });
    const hipY = oy - Math.max(legs[0].fy, legs[1].fy) - 0.012 * h;
    const hipX = ox;
    const breathe = (1 - gait) * Math.sin(time * 1.9) * 0.008 * h;
    const look = (1 - gait) * lampProx;                 // looks up toward the light when standing under it

    const legCol = '#141517', legFar = '#0e0f10';
    const front = legs[0].a1 > legs[1].a1 ? 0 : 1;
    const back = 1 - front;
    // far leg, far arm
    const footLen = 0.06 * h;
    const drawLeg = (L, col) => {
      const [fx, fy] = limb(g, hipX, hipY, L.a1, L.a2, L1, L2, 0.075 * h, col);
      g.beginPath(); g.moveTo(fx - footLen * 0.2, fy); g.lineTo(fx + footLen, fy + 0.004 * h); g.stroke();
    };
    drawLeg(legs[back], legFar);

    const torsoL = 0.30 * h + breathe;
    const shX = hipX + Math.sin(lean) * torsoL, shY = hipY - Math.cos(lean) * torsoL;
    const armAmp = gait * (0.5 + 0.25 * run);
    const arm = (s) => {
      const ph = phase + s * Math.PI;
      const a = -armAmp * Math.sin(ph) + lean * 0.6;
      const elbow = 0.25 + run * 1.0 + gait * 0.15;
      return [a, a + elbow];
    };
    const armBack = arm(front), armFront = arm(back);  // arms swing opposite to legs
    limb(g, shX, shY + 0.015 * h, armBack[0], armBack[1], 0.16 * h, 0.15 * h, 0.06 * h, rgb(SHIRT_FAR));

    // trousers + jumper
    g.strokeStyle = legCol; g.lineCap = 'round'; g.lineWidth = 0.15 * h;
    g.beginPath(); g.moveTo(hipX, hipY); g.lineTo(hipX + Math.sin(lean) * 0.05 * h, hipY - Math.cos(lean) * 0.05 * h); g.stroke();
    g.strokeStyle = rgb(SHIRT); g.lineWidth = 0.158 * h;
    g.beginPath();
    g.moveTo(hipX + Math.sin(lean) * 0.085 * h, hipY - Math.cos(lean) * 0.085 * h);
    g.lineTo(shX - Math.sin(lean) * 0.005 * h, shY + 0.03 * h); g.stroke();

    drawLeg(legs[front], legCol);

    // head
    const hx = shX + Math.sin(lean) * 0.11 * h + 0.012 * h - look * 0.01 * h;
    const hy = shY - 0.105 * h - look * 0.006 * h;
    g.fillStyle = '#151618';
    g.beginPath(); g.arc(hx, hy, 0.086 * h, 0, TAU); g.fill();
    g.beginPath(); g.arc(hx - 0.01 * h, hy + 0.06 * h, 0.035 * h, 0, TAU); g.fill(); // neck

    limb(g, shX, shY + 0.015 * h, armFront[0], armFront[1], 0.16 * h, 0.15 * h, 0.062 * h, rgb(SHIRT));

    // light on the figure: cool sky rim by day, warm lamplight near the lamp
    g.globalCompositeOperation = 'source-atop';
    const top = hy - 0.09 * h;
    let gr = g.createLinearGradient(0, top, 0, oy);
    gr.addColorStop(0, `rgba(205,214,214,${0.18 * (1 - P.t)})`); gr.addColorStop(0.5, 'rgba(205,214,214,0)');
    g.fillStyle = gr; g.fillRect(0, 0, figW, figH);
    if (lampProx > 0.01) {
      const side = lampDX >= 0 ? 1 : -1;            // in figure-local space (after facing flip)
      gr = g.createLinearGradient(ox + side * 0.12 * h, top, ox - side * 0.08 * h, oy - 0.3 * h);
      gr.addColorStop(0, rgb(WARM, 0.7 * lampProx)); gr.addColorStop(0.55, rgb(WARM, 0.12 * lampProx)); gr.addColorStop(1, rgb(WARM, 0));
      g.fillStyle = gr; g.fillRect(0, 0, figW, figH);
    }

    ctx.save();
    ctx.translate(screenX, groundPx);
    // turning: squeeze through a sliver rather than snapping
    ctx.scale(Math.sign(turn || 1) * Math.max(0.12, Math.abs(turn)), 1);
    ctx.drawImage(fig, -ox, -oy, figW, figH);
    ctx.restore();
  }

  /* ---------------- state ---------------- */
  let boyX = START, vel = 0, phase = 0, gait = 0, run = 0, facing = 1, turn = 1;
  let cam = 0, lead = 0, leadVel = 0, time = 0, last = performance.now();
  let needsFrame = true, here = -1, renderedX = NaN;
  const titleCard = document.querySelector('.title-card');
  const cue = document.querySelector('.scroll-cue');

  // Critically damped follow (the SmoothDamp used in games): eases in and out, never overshoots.
  function smoothDamp(cur, target, v, smoothTime, maxSpeed, dt) {
    const omega = 2 / smoothTime, x = omega * dt;
    const e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const maxChange = maxSpeed * smoothTime;
    const change = clamp(cur - target, -maxChange, maxChange);
    const t2 = cur - change;
    const temp = (v + omega * change) * dt;
    let nv = (v - omega * temp) * e;
    let out = t2 + (change + temp) * e;
    if ((target - cur > 0) === (out > target)) { out = target; nv = 0; }
    return [out, nv];
  }

  function update(dt) {
    const target = scrollToX(window.scrollY);
    if (reduced) {
      boyX = target; vel = 0;
    } else {
      [boyX, vel] = smoothDamp(boyX, target, vel, 0.42, 2.2, dt);
    }
    const speed = Math.abs(vel);
    const away = target - boyX;

    // Gait: picks up quickly, winds down gently so the last step finishes instead of freezing.
    const want = smooth(0.012, 0.2, speed);
    gait = lerp(gait, want, 1 - Math.exp(-dt * (want > gait ? 9 : 3.2)));
    run = lerp(run, smooth(0.8, 1.8, speed), 1 - Math.exp(-dt * 3));
    const cadence = 0.85 + 0.85 * run;
    // As he slows, keep stepping until his feet come together (sin(phase) ≈ 0).
    const midStride = Math.abs(Math.sin(phase)) > 0.12;
    const rate = (midStride && gait > 0.004) ? Math.max(gait, 0.4) : gait;
    phase += dt * TAU * cadence * rate;
    if (gait < 0.02 && !midStride) phase = Math.round(phase / Math.PI) * Math.PI;

    // Face where he's going; only turn when the scroll really changes direction.
    if (Math.abs(away) > 0.015) facing = Math.sign(away);
    turn = reduced ? facing : clamp(turn + Math.sign(facing - turn) * dt / 0.16, -1, 1);

    // Camera locked to him, with a soft look-ahead that grows when he runs.
    if (reduced) { lead = 0; } else { [lead, leadVel] = smoothDamp(lead, clamp(vel * 0.08, -0.12, 0.12), leadVel, 0.6, 1, dt); }
    cam = boyX - boyFrac() * aspect + lead;

    setPalette(clamp((boyX - START) / (END - START)));

    const intro = 1 - smooth(START + 0.04, START + 0.9, boyX);
    if (titleCard) titleCard.style.setProperty('--intro', intro.toFixed(3));
    if (cue) cue.style.opacity = (intro * (window.scrollY < 8 ? 1 : 0.0)).toFixed(3);

    // arrival
    let nowHere = -1;
    standX.forEach((x, i) => {
      if (!stopEls[i]) return;
      const d = Math.abs(boyX - x);
      if (d < 0.035 && speed < 0.12) nowHere = i;
      else if (here === i && d < 0.22) nowHere = i;     // hysteresis
    });
    if (nowHere !== here) {
      if (here >= 0) stopEls[here].classList.remove('is-here');
      if (nowHere >= 0) stopEls[nowHere].classList.add('is-here');
      here = nowHere;
    }
    if (here >= 0 && stops[here]) showPage(stops[here], pageFor(here, window.scrollY));
    return speed > 0.0005 || Math.abs(target - boyX) > 0.0004;
  }

  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // sky
    const sky = ctx.createLinearGradient(0, 0, 0, 0.74 * U);
    sky.addColorStop(0, rgb(P.top)); sky.addColorStop(1, rgb(P.hor));
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    // the sun, a pale smudge behind the fog, upper left; fades into dusk
    const sunA = 0.32 * (1 - smooth(0.1, 0.75, P.t));
    if (sunA > 0.01) {
      const sxp = (0.22 - cam * 0.03) * U, syp = 0.16 * U;
      const g = ctx.createRadialGradient(sxp, syp, 0, sxp, syp, 0.55 * U);
      g.addColorStop(0, `rgba(240,240,232,${sunA})`); g.addColorStop(1, 'rgba(240,240,232,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }

    ridge(0.1, 0.70, 0.05, 0.9, 1, 0.86);
    drawSkyline();
    fogBank(0.2, 0.69, 0.30, 0.55, 0.004);
    ridge(0.3, 0.755, 0.03, 1.4, 2, 0.64);
    trees(0.32, 0.055, 11, 0.62, 0.755, 0.006, 0.012, (x) => forest(x) * 0.85, false);
    drawPylons();
    fogBank(0.45, 0.76, 0.24, 0.5, 0.007, 0.37);
    ridge(0.6, 0.79, 0.02, 1.7, 3, 0.37);
    trees(0.6, 0.11, 21, 0.37, 0.787, 0.017, 0.032, (x) => forest(x) * 0.82, true);
    drawShafts();
    fogBank(0.75, 0.80, 0.18, 0.38, 0.011, 0.71);

    trees(NB_P, 0.27, 31, NB_FOG, 0.81, 0.034, 0.06, (x) => forest(x) * 0.75, true);
    drawPoles();
    drawFence();
    grass(NB_P, NB_FOG, 41, 0.007, 0.006, 0.03, (x) => field(x) * 0.8 + forest(x) * 0.2, -0.012, 0.004);

    drawGround();
    grass(1, GROUND_FOG, 51, 0.0055, 0.008, 0.046, grassDensity, 0, 0.006);

    // lamps
    const I = lampIntensity();
    const lit = [];
    for (const L of lampX) { const r = drawLampPost(L); if (r) lit.push(r); }

    // walker
    const bxs = sx(boyX, 1), gpx = groundY(boyX) * U + 0.5;
    let prox = 0, lampDX = 0;
    for (const L of lampX) {
      const d = L - 0.115 - boyX;
      const pr = 1 - smooth(0.05, 0.55, Math.abs(d));
      if (pr > prox) { prox = pr; lampDX = (L - 0.115 + 0.02) - boyX; }
    }
    if (prox > 0.01) {
      ctx.save(); ctx.translate(bxs, gpx); ctx.scale(1, 0.18);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.05 * U);
      g.addColorStop(0, `rgba(0,0,0,${0.55 * prox})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 0.05 * U, 0, TAU); ctx.fill(); ctx.restore();
    }
    drawWalker(bxs, gpx, lampDX * Math.sign(turn || 1), prox * I);
    drawBirds(bxs);

    // grass in front of him
    grass(1, GROUND_FOG * 0.4, 61, 0.009, 0.006, 0.04, (x) => grassDensity(x) * 0.6, 0.008, 0.007);

    for (const [hx, hy, gy] of lit) { drawLampLight(hx, hy, gy, I); drawMoths(hx, hy, I); }

    fogBank(1.15, 0.86, 0.12, 0.22, 0.016, 0.13);
    drawForeground();
    drawDust();
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!reduced) time += dt;
    update(dt);
    // With reduced motion there's no animation loop: redraw only when he has moved.
    if (!reduced || needsFrame || boyX !== renderedX) { render(); needsFrame = false; renderedX = boyX; }
    if (!reduced) requestAnimationFrame(frame);
  }

  /* ---------------- wiring ---------------- */
  function onScroll() {
    if (reduced) requestAnimationFrame(frame);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', () => { resize(); if (reduced) requestAnimationFrame(frame); });
  motionQuery.addEventListener?.('change', (e) => {
    reduced = e.matches; last = performance.now(); requestAnimationFrame(frame);
  });

  function goToStop(i, smoothScroll) {
    if (!stopEls[i]) return;
    window.scrollTo({ top: stopScroll(i), behavior: smoothScroll && !reduced ? 'smooth' : 'auto' });
    if (reduced || !smoothScroll) { boyX = standX[i]; }
    setTimeout(() => stopEls[i].focus({ preventScroll: true }), reduced ? 50 : 2600);
  }
  document.querySelector('.skip')?.addEventListener('click', (e) => {
    e.preventDefault();
    if (stopEls.length) goToStop(0, false);
    else { window.scrollTo(0, points[1].s); boyX = standX[0]; }   // no posts yet: straight to the lamp
  });

  resize();
  layoutTrack(true);
  // Web fonts change line heights; re-measure the pages once they arrive.
  document.fonts?.ready.then(() => { paginate(); layoutTrack(true); showPages(); });
  if (location.hash === '#writing') goToStop(0, false);
  // If the page loads part-way down (reload, back button), start him where the scroll is.
  boyX = scrollToX(window.scrollY);
  cam = boyX - boyFrac() * aspect;
  showPages();
  // ?debug exposes the walker's state for testing
  if (/[?&]debug\b/.test(location.search)) window.__walk = () => ({ boyX, vel, turn, facing, gait, phase });
  requestAnimationFrame(frame);
})();
