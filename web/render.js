/* Mars Colony Sim — canvas renderer (terrain, sky, modules, Starships, effects). */
(function (root) {
  'use strict';
  const E = root.MarsEngine;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  function hexToRgb(h) {
    if (h[0] !== '#') return h.replace(/[^\d,.]/g, '').split(',').slice(0, 3).map(Number);
    const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mix(a, b, t) {
    const A = hexToRgb(a), B = hexToRgb(b);
    return 'rgb(' + A.map((v, i) => Math.round(lerp(v, B[i], t))).join(',') + ')';
  }
  function h2(x, y, s) {
    let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function vnoise(x, y, s) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = h2(xi, yi, s), b = h2(xi + 1, yi, s), c = h2(xi, yi + 1, s), d = h2(xi + 1, yi + 1, s);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }
  function fbm(x, y, s) { return vnoise(x, y, s) * 0.55 + vnoise(x * 2.1, y * 2.1, s + 7) * 0.3 + vnoise(x * 4.3, y * 4.3, s + 13) * 0.15; }

  function layout(w, h) {
    const sky = Math.round(clamp(h * 0.17, 70, 150));
    const t = Math.floor(Math.min((w - 16) / E.W, (h - sky - 14) / E.H));
    const gw = t * E.W, gh = t * E.H;
    return { w, h, sky, t, gw, gh, ox: Math.round((w - gw) / 2), oy: sky + Math.round((h - sky - gh) / 2) };
  }
  function tileFromPx(L, px, py) {
    const x = Math.floor((px - L.ox) / L.t), y = Math.floor((py - L.oy) / L.t);
    return (x < 0 || y < 0 || x >= E.W || y >= E.H) ? null : { x, y };
  }
  function center(L, x, y) { return { cx: L.ox + (x + 0.5) * L.t, cy: L.oy + (y + 0.5) * L.t }; }

  // ---------- Terrain (cached) ----------
  let terrainCache = null;
  function terrain(s, L) {
    const key = s.seed + ':' + L.w + 'x' + L.h + ':' + L.t;
    if (terrainCache && terrainCache.key === key) return terrainCache.cv;
    const cv = document.createElement('canvas');
    cv.width = L.w; cv.height = L.h - L.sky;
    const g = cv.getContext('2d');
    const img = g.createImageData(cv.width, cv.height);
    const A = hexToRgb('#8f3a1e'), B = hexToRgb('#c96a3c'), C = hexToRgb('#d98c55');
    const sd = s.seed % 997;
    for (let y = 0; y < cv.height; y++) {
      for (let x = 0; x < cv.width; x++) {
        const n = fbm(x / 90, y / 90, sd);
        const m = fbm(x / 22 + 50, y / 22, sd + 3);
        const grain = (h2(x, y, sd) - 0.5) * 18;
        let r, gg, b;
        if (n < 0.5) { const t = n / 0.5; r = lerp(A[0], B[0], t); gg = lerp(A[1], B[1], t); b = lerp(A[2], B[2], t); }
        else { const t = (n - 0.5) / 0.5; r = lerp(B[0], C[0], t); gg = lerp(B[1], C[1], t); b = lerp(B[2], C[2], t); }
        const k = 0.9 + m * 0.2;
        const i = (y * cv.width + x) * 4;
        img.data[i] = clamp(r * k + grain, 0, 255); img.data[i + 1] = clamp(gg * k + grain * 0.7, 0, 255);
        img.data[i + 2] = clamp(b * k + grain * 0.5, 0, 255); img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    const oy = L.oy - L.sky, t = L.t;
    // distant small rocks / pebbles everywhere
    for (let i = 0; i < 260; i++) {
      const x = h2(i, 1, sd) * cv.width, y = h2(i, 2, sd) * cv.height, r = 1 + h2(i, 3, sd) * 2.4;
      g.fillStyle = 'rgba(60,20,8,0.35)'; g.beginPath(); g.ellipse(x + 1, y + 1, r, r * 0.6, 0, 0, TAU); g.fill();
      g.fillStyle = 'rgba(230,150,100,0.35)'; g.beginPath(); g.ellipse(x, y, r * 0.8, r * 0.5, 0, 0, TAU); g.fill();
    }
    // survey zone
    g.save();
    g.strokeStyle = 'rgba(255,220,180,0.10)'; g.lineWidth = 1;
    for (let x = 0; x <= E.W; x++) { g.beginPath(); g.moveTo(L.ox + x * t + 0.5, oy); g.lineTo(L.ox + x * t + 0.5, oy + L.gh); g.stroke(); }
    for (let y = 0; y <= E.H; y++) { g.beginPath(); g.moveTo(L.ox, oy + y * t + 0.5); g.lineTo(L.ox + L.gw, oy + y * t + 0.5); g.stroke(); }
    g.strokeStyle = 'rgba(255,200,150,0.22)'; g.setLineDash([6, 6]); g.strokeRect(L.ox + 0.5, oy + 0.5, L.gw, L.gh);
    g.restore();
    // tile features
    for (let y = 0; y < E.H; y++) for (let x = 0; x < E.W; x++) {
      const tl = s.map[y * E.W + x];
      const cx = L.ox + (x + 0.5) * t, cy = oy + (y + 0.5) * t;
      if (tl.t === 'crater' && tl.big) drawCrater(g, cx + t / 2, cy + t / 2, t * 0.95, sd + x);
      else if (tl.t === 'crater' && !isBigPart(s, x, y)) drawCrater(g, cx, cy, t * 0.42, sd + x * 3 + y);
      else if (tl.t === 'rock') drawRocks(g, cx, cy, t, sd + x * 17 + y * 31);
      else if (tl.t === 'ice') drawIce(g, cx, cy, t, sd + x * 7 + y * 13);
    }
    // vignette
    const vg = g.createRadialGradient(cv.width / 2, cv.height / 2, cv.height * 0.35, cv.width / 2, cv.height / 2, cv.width * 0.7);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(30,5,0,0.45)');
    g.fillStyle = vg; g.fillRect(0, 0, cv.width, cv.height);
    terrainCache = { key, cv };
    return cv;
  }
  function isBigPart(s, x, y) {
    for (const [dx, dy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
      const t = E.tileAt(s, x + dx, y + dy);
      if (t && t.big) return true;
    }
    return false;
  }
  function drawCrater(g, cx, cy, r, sd) {
    const gr = g.createRadialGradient(cx - r * 0.2, cy - r * 0.25, r * 0.1, cx, cy, r);
    gr.addColorStop(0, 'rgba(70,22,8,0.75)'); gr.addColorStop(0.65, 'rgba(110,40,18,0.6)'); gr.addColorStop(0.85, 'rgba(230,150,95,0.55)'); gr.addColorStop(1, 'rgba(160,70,35,0)');
    g.fillStyle = gr; g.beginPath(); g.ellipse(cx, cy, r, r * 0.82, 0, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(245,175,120,0.45)'; g.lineWidth = Math.max(1, r * 0.06);
    g.beginPath(); g.ellipse(cx, cy, r * 0.86, r * 0.7, 0, Math.PI * 0.05, Math.PI * 0.95); g.stroke();
    for (let i = 0; i < 4; i++) {
      const a = h2(i, 9, sd) * TAU, d = h2(i, 8, sd) * r * 0.5;
      g.fillStyle = 'rgba(60,18,6,0.5)'; g.beginPath(); g.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.8, r * 0.06, 0, TAU); g.fill();
    }
  }
  function drawRocks(g, cx, cy, t, sd) {
    const n = 3 + Math.floor(h2(1, 1, sd) * 3);
    for (let i = 0; i < n; i++) {
      const x = cx + (h2(i, 2, sd) - 0.5) * t * 0.7, y = cy + (h2(i, 3, sd) - 0.5) * t * 0.6, r = t * (0.1 + h2(i, 4, sd) * 0.14);
      g.fillStyle = 'rgba(40,12,4,0.45)'; g.beginPath(); g.ellipse(x + r * 0.3, y + r * 0.45, r * 1.1, r * 0.55, 0, 0, TAU); g.fill();
      g.beginPath();
      for (let k = 0; k < 7; k++) { const a = k / 7 * TAU, rr = r * (0.75 + h2(i, k + 10, sd) * 0.4); g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.8); }
      g.closePath();
      const gr = g.createLinearGradient(x - r, y - r, x + r, y + r);
      gr.addColorStop(0, '#9c5a3d'); gr.addColorStop(1, '#4d2214');
      g.fillStyle = gr; g.fill();
    }
  }
  function drawIce(g, cx, cy, t, sd) {
    // frosty patch
    const fr = g.createRadialGradient(cx, cy, 0, cx, cy, t * 0.5);
    fr.addColorStop(0, 'rgba(200,225,240,0.45)'); fr.addColorStop(1, 'rgba(200,225,240,0)');
    g.fillStyle = fr; g.beginPath(); g.ellipse(cx, cy, t * 0.5, t * 0.42, 0, 0, TAU); g.fill();
    // angular ice shards
    const n = 4 + Math.floor(h2(0, 0, sd) * 3);
    for (let i = 0; i < n; i++) {
      const x = cx + (h2(i, 2, sd) - 0.5) * t * 0.62, y = cy + (h2(i, 3, sd) - 0.5) * t * 0.5, r = t * (0.07 + h2(i, 4, sd) * 0.09);
      g.beginPath();
      for (let k = 0; k < 5; k++) { const a = k / 5 * TAU + h2(i, k, sd); const rr2 = r * (0.6 + h2(i, k + 20, sd) * 0.6); g.lineTo(x + Math.cos(a) * rr2, y + Math.sin(a) * rr2 * 0.7); }
      g.closePath();
      g.fillStyle = lin(g, x - r, y - r, x + r, y + r, [[0, '#f4fbff'], [0.5, '#bfe3f5'], [1, '#7fb3d1']]);
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 0.8; g.stroke();
    }
    g.fillStyle = 'rgba(255,255,255,0.9)';
    for (let i = 0; i < 3; i++) { const x = cx + (h2(i, 7, sd) - 0.5) * t * 0.6, y = cy + (h2(i, 8, sd) - 0.5) * t * 0.5; g.fillRect(x - 2, y, 4, 1); g.fillRect(x, y - 2, 1, 4); }
  }

  // ---------- Sky ----------
  function daylight(phase) { const e = -Math.cos(TAU * phase); return clamp(e * 1.6 + 0.55, 0, 1); }
  function drawSky(g, s, L, phase, time, stormK) {
    const dl = daylight(phase);
    const e = -Math.cos(TAU * phase);
    const dusk = clamp(1 - Math.abs(e) * 3, 0, 1);
    const top = mix(mix('#07060f', '#c98d5c', dl), '#3b4d6e', dusk * 0.55);
    const bot = mix(mix('#1a1022', '#f0c48e', dl), '#7d9ec4', dusk * 0.6);
    const gr = g.createLinearGradient(0, 0, 0, L.sky);
    gr.addColorStop(0, top); gr.addColorStop(1, bot);
    g.fillStyle = gr; g.fillRect(0, 0, L.w, L.sky);
    // stars
    if (dl < 0.6) {
      for (let i = 0; i < 90; i++) {
        const x = h2(i, 1, 5) * L.w, y = h2(i, 2, 5) * L.sky * 0.85;
        const tw = 0.6 + 0.4 * Math.sin(time * 0.002 + i);
        g.fillStyle = 'rgba(255,255,255,' + ((1 - dl / 0.6) * 0.8 * tw * (1 - stormK * 0.8)).toFixed(3) + ')';
        g.fillRect(x, y, h2(i, 3, 5) > 0.9 ? 2 : 1, 1);
      }
      // two little moons
      const mp = (time * 0.00004) % 1, mp2 = (time * 0.000013 + 0.4) % 1;
      g.fillStyle = 'rgba(200,180,160,' + (0.9 * (1 - dl)).toFixed(2) + ')';
      g.beginPath(); g.ellipse(L.w * mp, L.sky * 0.28, 4, 3, 0.3, 0, TAU); g.fill();
      g.beginPath(); g.arc(L.w * mp2, L.sky * 0.18, 1.6, 0, TAU); g.fill();
    }
    // sun (small and pale, as seen from far away)
    const sx = L.w * (0.05 + 0.9 * ((phase - 0.25 + 1) % 1) / 0.5);
    const sy = L.sky * (1.05 - 0.9 * clamp(e, -0.2, 1));
    if (e > -0.15 && sx < L.w * 1.05) {
      const sr = 9;
      const halo = g.createRadialGradient(sx, sy, 0, sx, sy, sr * 7);
      halo.addColorStop(0, 'rgba(255,250,235,' + (0.9 * (1 - stormK * 0.7)).toFixed(2) + ')');
      halo.addColorStop(0.15, 'rgba(255,235,200,' + (0.45 * (1 - stormK * 0.7)).toFixed(2) + ')');
      halo.addColorStop(0.5, dusk > 0.2 ? 'rgba(140,180,230,0.25)' : 'rgba(255,220,170,0.12)');
      halo.addColorStop(1, 'rgba(255,220,170,0)');
      g.fillStyle = halo; g.beginPath(); g.arc(sx, sy, sr * 7, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,253,245,' + (1 - stormK * 0.6).toFixed(2) + ')'; g.beginPath(); g.arc(sx, sy, sr * 0.6, 0, TAU); g.fill();
    }
    // horizon hills (3 layers)
    const layers = [['#7a3a24', '#2a1018', 0.55, 0.42], ['#93462a', '#3a1418', 0.7, 0.3], ['#a9542f', '#4a1a16', 0.85, 0.2]];
    layers.forEach(([day, night, base, amp], li) => {
      g.fillStyle = mix(night, day, dl * (1 - stormK * 0.3));
      g.beginPath(); g.moveTo(0, L.sky);
      for (let x = 0; x <= L.w; x += 8) {
        const n = fbm(x / (170 - li * 40) + li * 10, li * 3.3, s.seed % 89 + li);
        const big = li === 0 ? Math.max(0, 1 - Math.abs(x - L.w * 0.72) / (L.w * 0.22)) * 0.5 : 0;
        g.lineTo(x, L.sky * (base - amp * n - big * 0.5 + 0.12));
      }
      g.lineTo(L.w, L.sky); g.closePath(); g.fill();
    });
    // ground blend
    const bl = g.createLinearGradient(0, L.sky - 8, 0, L.sky + 10);
    bl.addColorStop(0, 'rgba(0,0,0,0)'); bl.addColorStop(1, 'rgba(60,20,10,0.35)');
    g.fillStyle = bl; g.fillRect(0, L.sky - 8, L.w, 18);
  }

  // ---------- Module art (3/4 view) ----------
  function shadow(g, cx, cy, rw, rh) { g.fillStyle = 'rgba(35,8,0,0.38)'; g.beginPath(); g.ellipse(cx + rw * 0.12, cy, rw, rh, 0, 0, TAU); g.fill(); }
  function lin(g, x0, y0, x1, y1, stops) { const gr = g.createLinearGradient(x0, y0, x1, y1); stops.forEach(([o, c]) => gr.addColorStop(o, c)); return gr; }
  function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); }
  function glow(g, x, y, r, col, a) {
    if (a <= 0.02) return;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, col.replace('A', a.toFixed(2))); gr.addColorStop(1, col.replace('A', '0'));
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  }
  function dome(g, cx, by, rw, rh, fill, stroke) {
    g.beginPath(); g.ellipse(cx, by, rw, rh, 0, Math.PI, TAU); g.closePath();
    g.fillStyle = fill; g.fill(); if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1; g.stroke(); }
  }

  const ART = {
    hub(g, cx, cy, t, o) {
      const by = cy + t * 0.25;
      shadow(g, cx, by + t * 0.04, t * 0.5, t * 0.16);
      g.fillStyle = '#8d8a88'; g.beginPath(); g.ellipse(cx, by, t * 0.5, t * 0.17, 0, 0, TAU); g.fill();
      dome(g, cx, by, t * 0.44, t * 0.5, lin(g, cx - t * 0.4, by - t * 0.5, cx + t * 0.4, by, [[0, '#ffffff'], [0.55, '#d9d4cf'], [1, '#8f8781']]), 'rgba(80,60,50,0.5)');
      g.strokeStyle = '#ff7a3d'; g.lineWidth = Math.max(2, t * 0.05);
      g.beginPath(); g.ellipse(cx, by - t * 0.12, t * 0.42, t * 0.12, 0, Math.PI * 1.02, Math.PI * 1.98); g.stroke();
      for (let i = -2; i <= 2; i++) {
        const x = cx + i * t * 0.13;
        g.fillStyle = mix('#3b5f7a', '#ffe3a0', o.night); g.fillRect(x - t * 0.035, by - t * 0.27, t * 0.07, t * 0.05);
        glow(g, x, by - t * 0.25, t * 0.12, 'rgba(255,220,150,A)', o.night * 0.5);
      }
      g.strokeStyle = '#ccc'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(cx + t * 0.18, by - t * 0.44); g.lineTo(cx + t * 0.26, by - t * 0.72); g.stroke();
      g.fillStyle = '#ddd'; g.beginPath(); g.ellipse(cx + t * 0.26, by - t * 0.72, t * 0.09, t * 0.04, -0.5, 0, TAU); g.fill();
      if (Math.sin(o.time * 0.006) > 0) { glow(g, cx + t * 0.26, by - t * 0.74, t * 0.1, 'rgba(255,60,40,A)', 0.9); }
    },
    hab(g, cx, cy, t, o) {
      const by = cy + t * 0.22, w = t * 0.78, h = t * 0.34;
      shadow(g, cx, by + t * 0.02, w * 0.56, t * 0.12);
      rr(g, cx - w / 2, by - h, w, h, h / 2);
      g.fillStyle = lin(g, 0, by - h, 0, by, [[0, '#ffffff'], [0.6, '#dcd6d0'], [1, '#9c938c']]); g.fill();
      g.fillStyle = '#ff7a3d'; g.fillRect(cx - w / 2 + h * 0.4, by - h * 0.42, w - h * 0.8, h * 0.14);
      for (let i = -1; i <= 1; i++) {
        const x = cx + i * w * 0.24;
        g.fillStyle = mix('#41637d', '#ffe39a', o.night); rr(g, x - t * 0.05, by - h * 0.82, t * 0.1, h * 0.28, 3); g.fill();
        glow(g, x, by - h * 0.7, t * 0.16, 'rgba(255,215,140,A)', o.night * 0.45);
      }
      g.fillStyle = '#b8b0aa'; rr(g, cx + w / 2 - t * 0.06, by - h * 0.7, t * 0.1, h * 0.5, 2); g.fill();
    },
    solar(g, cx, cy, t, o) {
      const by = cy + t * 0.28;
      shadow(g, cx, by, t * 0.42, t * 0.1);
      g.strokeStyle = '#6d6662'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx - t * 0.2, by); g.lineTo(cx - t * 0.2, by - t * 0.2); g.moveTo(cx + t * 0.2, by); g.lineTo(cx + t * 0.2, by - t * 0.2); g.stroke();
      const x0 = cx - t * 0.42, x1 = cx + t * 0.42, yT = by - t * 0.58, yB = by - t * 0.16, sk = t * 0.1;
      g.beginPath(); g.moveTo(x0 + sk, yT); g.lineTo(x1 + sk, yT); g.lineTo(x1, yB); g.lineTo(x0, yB); g.closePath();
      g.fillStyle = lin(g, x0, yT, x1, yB, [[0, '#2b4f8f'], [0.5, '#1b2f5e'], [1, '#13204a']]); g.fill();
      g.strokeStyle = '#c7c3bf'; g.lineWidth = 1.5; g.stroke();
      g.strokeStyle = 'rgba(160,200,255,0.35)'; g.lineWidth = 1;
      for (let i = 1; i < 4; i++) { const f = i / 4; g.beginPath(); g.moveTo(lerp(x0 + sk, x0, f), lerp(yT, yB, f)); g.lineTo(lerp(x1 + sk, x1, f), lerp(yT, yB, f)); g.stroke(); }
      for (let i = 1; i < 5; i++) { const f = i / 5; g.beginPath(); g.moveTo(lerp(x0 + sk, x1 + sk, f), yT); g.lineTo(lerp(x0, x1, f), yB); g.stroke(); }
      if (o.dust > 0.2) { g.fillStyle = 'rgba(190,110,60,' + (o.dust * 0.45).toFixed(2) + ')'; g.beginPath(); g.moveTo(x0 + sk, yT); g.lineTo(x1 + sk, yT); g.lineTo(x1, yB); g.lineTo(x0, yB); g.closePath(); g.fill(); }
      const gl = (o.time * 0.0003 + cx * 0.01) % 1.6;
      if (o.day > 0.5 && gl < 1) { g.fillStyle = 'rgba(255,255,255,0.18)'; g.beginPath(); const gx = lerp(x0, x1, gl); g.moveTo(gx + sk, yT); g.lineTo(gx + sk + t * 0.08, yT); g.lineTo(gx + t * 0.08, yB); g.lineTo(gx, yB); g.closePath(); g.fill(); }
    },
    battery(g, cx, cy, t, o) {
      const by = cy + t * 0.26, w = t * 0.56, h = t * 0.34, d = t * 0.14;
      shadow(g, cx, by, w * 0.6, t * 0.1);
      g.fillStyle = '#5d6168'; g.fillRect(cx - w / 2, by - h, w, h);
      g.fillStyle = '#8b9098'; g.beginPath(); g.moveTo(cx - w / 2, by - h); g.lineTo(cx - w / 2 + d, by - h - d * 0.8); g.lineTo(cx + w / 2 + d, by - h - d * 0.8); g.lineTo(cx + w / 2, by - h); g.closePath(); g.fill();
      g.fillStyle = '#41454b'; g.beginPath(); g.moveTo(cx + w / 2, by - h); g.lineTo(cx + w / 2 + d, by - h - d * 0.8); g.lineTo(cx + w / 2 + d, by - d * 0.8); g.lineTo(cx + w / 2, by); g.closePath(); g.fill();
      const lvl = o.charge;
      for (let i = 0; i < 4; i++) {
        const on = lvl > (i + 0.5) / 4;
        g.fillStyle = on ? (lvl < 0.3 ? '#ff6b4a' : '#7CFC8A') : '#2a2d31';
        g.fillRect(cx - w / 2 + w * 0.12 + i * w * 0.2, by - h * 0.6, w * 0.14, h * 0.32);
        if (on) glow(g, cx - w / 2 + w * 0.19 + i * w * 0.2, by - h * 0.45, t * 0.08, 'rgba(124,252,138,A)', 0.25 + o.night * 0.3);
      }
      const bx = cx + d * 0.5, bt = by - h - d * 0.4, k = t * 0.07;
      g.fillStyle = '#ffd23f'; g.beginPath(); g.moveTo(bx + k * 0.2, bt - k); g.lineTo(bx - k * 0.6, bt + k * 0.1); g.lineTo(bx, bt + k * 0.1); g.lineTo(bx - k * 0.2, bt + k); g.lineTo(bx + k * 0.6, bt - k * 0.1); g.lineTo(bx, bt - k * 0.1); g.closePath(); g.fill();
    },
    electrolyzer(g, cx, cy, t, o) {
      const by = cy + t * 0.28;
      shadow(g, cx, by, t * 0.42, t * 0.1);
      const tank = (x, w, h, col) => {
        g.fillStyle = lin(g, x - w / 2, 0, x + w / 2, 0, [[0, '#9fb7c2'], [0.4, '#f4fbff'], [1, '#7c929c']]);
        g.fillRect(x - w / 2, by - h, w, h);
        g.beginPath(); g.ellipse(x, by - h, w / 2, w * 0.2, 0, 0, TAU); g.fillStyle = '#e8f3f7'; g.fill();
        g.beginPath(); g.ellipse(x, by, w / 2, w * 0.2, 0, 0, Math.PI); g.fillStyle = '#7c929c'; g.fill();
        g.fillStyle = col; g.fillRect(x - w / 2, by - h * 0.55, w, h * 0.1);
      };
      g.strokeStyle = '#b9c2c7'; g.lineWidth = Math.max(2, t * 0.04); g.beginPath(); g.moveTo(cx - t * 0.2, by - t * 0.3); g.lineTo(cx + t * 0.18, by - t * 0.3); g.stroke();
      tank(cx - t * 0.2, t * 0.26, t * 0.55, '#4fd1c5');
      tank(cx + t * 0.18, t * 0.22, t * 0.42, '#5aa9ff');
      g.fillStyle = '#0f3b3a'; g.font = 'bold ' + Math.round(t * 0.15) + 'px system-ui,sans-serif'; g.textAlign = 'center'; g.fillText('O\u2082', cx - t * 0.2, by - t * 0.18);
      if (o.active) for (let i = 0; i < 3; i++) { const p = ((o.time * 0.0012 + i / 3) % 1); g.fillStyle = 'rgba(180,255,245,' + (0.6 * (1 - p)).toFixed(2) + ')'; g.beginPath(); g.arc(cx - t * 0.2 + Math.sin(p * 9 + i) * 3, by - t * 0.58 - p * t * 0.3, 2, 0, TAU); g.fill(); }
    },
    drill(g, cx, cy, t, o) {
      const by = cy + t * 0.3;
      shadow(g, cx, by, t * 0.4, t * 0.1);
      g.fillStyle = '#6f6a66'; g.beginPath(); g.ellipse(cx, by - t * 0.04, t * 0.36, t * 0.11, 0, 0, TAU); g.fill();
      g.fillStyle = 'rgba(225,240,255,0.9)'; g.beginPath(); g.ellipse(cx + t * 0.24, by - t * 0.04, t * 0.12, t * 0.06, 0, 0, TAU); g.fill();
      g.strokeStyle = '#e7b93a'; g.lineWidth = Math.max(1.5, t * 0.035);
      const top = by - t * 0.8;
      g.beginPath(); g.moveTo(cx - t * 0.2, by - t * 0.05); g.lineTo(cx, top); g.lineTo(cx + t * 0.2, by - t * 0.05); g.stroke();
      g.lineWidth = 1;
      for (let i = 1; i < 5; i++) { const f = i / 5, y = lerp(by - t * 0.05, top, f), hw = t * 0.2 * (1 - f); g.beginPath(); g.moveTo(cx - hw, y); g.lineTo(cx + hw * 0.9, y - t * 0.08); g.stroke(); }
      const sp = o.active ? o.time * 0.02 : 0;
      g.fillStyle = '#c7c2be'; g.fillRect(cx - t * 0.04, by - t * 0.42, t * 0.08, t * 0.36);
      g.strokeStyle = '#555'; for (let i = 0; i < 3; i++) { const y = by - t * 0.4 + ((sp * 3 + i * 10) % (t * 0.34)); g.beginPath(); g.moveTo(cx - t * 0.04, y); g.lineTo(cx + t * 0.04, y + 3); g.stroke(); }
      if (Math.sin(o.time * 0.005 + cx) > 0.3) glow(g, cx, top, t * 0.08, 'rgba(255,90,60,A)', 0.8);
    },
    greenhouse(g, cx, cy, t, o) {
      const by = cy + t * 0.26;
      shadow(g, cx, by, t * 0.46, t * 0.13);
      g.fillStyle = '#8e8984'; g.beginPath(); g.ellipse(cx, by, t * 0.45, t * 0.14, 0, 0, TAU); g.fill();
      g.fillStyle = '#3d2a1c'; g.beginPath(); g.ellipse(cx, by - 2, t * 0.4, t * 0.11, 0, 0, TAU); g.fill();
      for (let i = 0; i < 9; i++) {
        const x = cx + (h2(i, 1, 3) - 0.5) * t * 0.62, y = by - t * 0.04 - h2(i, 2, 3) * t * 0.18, r = t * (0.05 + h2(i, 3, 3) * 0.05);
        g.fillStyle = o.blight ? (i % 2 ? '#8a7d3a' : '#6f6a30') : (i % 2 ? '#5fbf4a' : '#8bd450');
        g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
      }
      dome(g, cx, by, t * 0.42, t * 0.42, 'rgba(200,240,255,' + (0.22 + o.night * 0.1).toFixed(2) + ')', 'rgba(230,250,255,0.7)');
      g.strokeStyle = 'rgba(230,250,255,0.35)'; g.lineWidth = 1;
      for (let i = 1; i < 4; i++) { g.beginPath(); g.ellipse(cx, by, t * 0.42 * i / 4, t * 0.42, 0, Math.PI, TAU); g.stroke(); }
      g.beginPath(); g.ellipse(cx, by - t * 0.2, t * 0.37, t * 0.1, 0, Math.PI, TAU); g.stroke();
      glow(g, cx, by - t * 0.15, t * 0.5, 'rgba(255,120,220,A)', o.night * 0.35 * (o.active ? 1 : 0));
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.ellipse(cx - t * 0.16, by - t * 0.3, t * 0.05, t * 0.1, 0.5, 0, TAU); g.fill();
    },
    foundry(g, cx, cy, t, o) {
      const by = cy + t * 0.26, w = t * 0.62, h = t * 0.36, d = t * 0.14;
      shadow(g, cx, by, w * 0.6, t * 0.12);
      g.fillStyle = '#7d5a48'; g.fillRect(cx - w / 2, by - h, w, h);
      g.fillStyle = '#a07760'; g.beginPath(); g.moveTo(cx - w / 2, by - h); g.lineTo(cx - w / 2 + d, by - h - d * 0.8); g.lineTo(cx + w / 2 + d, by - h - d * 0.8); g.lineTo(cx + w / 2, by - h); g.closePath(); g.fill();
      g.fillStyle = '#5a3e31'; g.beginPath(); g.moveTo(cx + w / 2, by - h); g.lineTo(cx + w / 2 + d, by - h - d * 0.8); g.lineTo(cx + w / 2 + d, by - d * 0.8); g.lineTo(cx + w / 2, by); g.closePath(); g.fill();
      g.fillStyle = '#4b4f55'; g.fillRect(cx + w * 0.12, by - h - t * 0.38, t * 0.1, t * 0.38);
      const heat = o.active ? 0.8 + 0.2 * Math.sin(o.time * 0.01) : 0.15;
      g.fillStyle = 'rgb(255,' + Math.round(120 + 60 * heat) + ',40)'; rr(g, cx - w * 0.32, by - h * 0.62, w * 0.3, h * 0.62, 3); g.fill();
      glow(g, cx - w * 0.17, by - h * 0.3, t * 0.3, 'rgba(255,140,40,A)', heat * (0.35 + o.night * 0.4));
      if (o.active) for (let i = 0; i < 3; i++) { const p = (o.time * 0.0006 + i / 3) % 1; g.fillStyle = 'rgba(210,200,195,' + (0.45 * (1 - p)).toFixed(2) + ')'; g.beginPath(); g.arc(cx + w * 0.17 + p * t * 0.2, by - h - t * 0.42 - p * t * 0.35, t * 0.05 + p * t * 0.08, 0, TAU); g.fill(); }
    },
    rec(g, cx, cy, t, o) {
      const by = cy + t * 0.26;
      shadow(g, cx, by, t * 0.46, t * 0.13);
      dome(g, cx, by, t * 0.43, t * 0.46, lin(g, cx - t * 0.4, by - t * 0.4, cx + t * 0.4, by, [[0, '#f4e9ff'], [0.6, '#c9b6e6'], [1, '#7f6aa3']]), 'rgba(90,60,130,0.6)');
      g.strokeStyle = 'rgba(90,60,130,0.45)'; g.lineWidth = 1;
      for (let r = 1; r <= 3; r++) { g.beginPath(); g.ellipse(cx, by, t * 0.43, t * 0.46 * r / 3.2, 0, Math.PI, TAU); g.stroke(); }
      for (let i = -3; i <= 3; i++) { g.beginPath(); g.moveTo(cx, by - t * 0.46); g.lineTo(cx + i * t * 0.14, by); g.stroke(); }
      const cols = ['#ff7ad9', '#7af0ff', '#ffe066'];
      for (let i = 0; i < 3; i++) { const on = Math.sin(o.time * 0.004 + i * 2) > -0.2; if (on) glow(g, cx + (i - 1) * t * 0.2, by - t * 0.08, t * 0.12, 'rgba(' + hexToRgb(cols[i]).join(',') + ',A)', 0.5 + o.night * 0.4); }
    },
    med(g, cx, cy, t, o) {
      const by = cy + t * 0.24, w = t * 0.6, h = t * 0.38;
      shadow(g, cx, by, w * 0.6, t * 0.12);
      rr(g, cx - w / 2, by - h, w, h, t * 0.08);
      g.fillStyle = lin(g, 0, by - h, 0, by, [[0, '#ffffff'], [1, '#c9d2d4']]); g.fill();
      const c = t * 0.07;
      g.fillStyle = '#2cc5a8'; g.fillRect(cx - c / 2, by - h * 0.85, c, h * 0.6); g.fillRect(cx - h * 0.3, by - h * 0.55 - c / 2, h * 0.6, c);
      glow(g, cx, by - h * 0.55, t * 0.3, 'rgba(44,197,168,A)', 0.15 + o.night * 0.35);
    },
    pad(g, cx, cy, t, o) {
      g.fillStyle = 'rgba(40,10,0,0.3)'; g.beginPath(); g.ellipse(cx, cy + t * 0.06, t * 0.48, t * 0.32, 0, 0, TAU); g.fill();
      g.fillStyle = '#9b9692'; g.beginPath(); g.ellipse(cx, cy + t * 0.02, t * 0.46, t * 0.3, 0, 0, TAU); g.fill();
      g.strokeStyle = '#f2c14e'; g.lineWidth = Math.max(1.5, t * 0.035); g.beginPath(); g.ellipse(cx, cy + t * 0.02, t * 0.34, t * 0.22, 0, 0, TAU); g.stroke();
      g.strokeStyle = 'rgba(60,60,60,0.5)'; g.lineWidth = 1; g.beginPath(); g.ellipse(cx, cy + t * 0.02, t * 0.16, t * 0.1, 0, 0, TAU); g.stroke();
      for (let i = 0; i < 4; i++) {
        const a = i / 4 * TAU + 0.4, x = cx + Math.cos(a) * t * 0.42, y = cy + t * 0.02 + Math.sin(a) * t * 0.27;
        const on = Math.sin(o.time * 0.008 + i * 1.5) > 0;
        g.fillStyle = on ? '#ff5a3c' : '#5a2a20'; g.beginPath(); g.arc(x, y, 2, 0, TAU); g.fill();
        if (on) glow(g, x, y, 7, 'rgba(255,90,60,A)', 0.6);
      }
    },
    reactor(g, cx, cy, t, o) {
      const by = cy + t * 0.28;
      shadow(g, cx, by, t * 0.46, t * 0.12);
      g.fillStyle = '#e9edf0';
      for (const sgn of [-1, 1]) {
        g.beginPath(); g.moveTo(cx + sgn * t * 0.12, by - t * 0.5); g.lineTo(cx + sgn * t * 0.46, by - t * 0.62); g.lineTo(cx + sgn * t * 0.46, by - t * 0.3); g.lineTo(cx + sgn * t * 0.12, by - t * 0.2); g.closePath(); g.fill();
        g.strokeStyle = '#a6adb3'; g.lineWidth = 1; g.stroke();
      }
      g.fillStyle = lin(g, cx - t * 0.14, 0, cx + t * 0.14, 0, [[0, '#7f878d'], [0.45, '#e6eaec'], [1, '#6c747a']]);
      g.fillRect(cx - t * 0.14, by - t * 0.62, t * 0.28, t * 0.62);
      g.beginPath(); g.ellipse(cx, by - t * 0.62, t * 0.14, t * 0.05, 0, 0, TAU); g.fillStyle = '#4fd1c5'; g.fill();
      glow(g, cx, by - t * 0.62, t * 0.25, 'rgba(79,209,197,A)', 0.4 + 0.2 * Math.sin(o.time * 0.004));
      g.fillStyle = '#ffd23f'; g.fillRect(cx - t * 0.14, by - t * 0.3, t * 0.28, t * 0.05);
    },
  };

  function drawStarship(g, x, by, h, opts) {
    opts = opts || {};
    const w = h * 0.2;
    g.save();
    if (opts.flame) {
      const fl = h * 0.75 * opts.flame * (0.9 + 0.2 * Math.random());
      g.save(); g.globalCompositeOperation = 'lighter';
      const gl = g.createRadialGradient(x, by + fl * 0.35, 0, x, by + fl * 0.35, fl);
      gl.addColorStop(0, 'rgba(255,190,120,0.75)'); gl.addColorStop(0.5, 'rgba(255,130,60,0.25)'); gl.addColorStop(1, 'rgba(255,120,60,0)');
      g.fillStyle = gl; g.beginPath(); g.arc(x, by + fl * 0.35, fl, 0, TAU); g.fill();
      const gr = g.createLinearGradient(0, by, 0, by + fl);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(170,210,255,0.95)'); gr.addColorStop(0.55, 'rgba(255,170,80,0.8)'); gr.addColorStop(1, 'rgba(255,120,40,0)');
      g.fillStyle = gr; g.beginPath(); g.moveTo(x - w * 0.42, by); g.lineTo(x + w * 0.42, by); g.lineTo(x + w * 0.2, by + fl); g.lineTo(x - w * 0.2, by + fl); g.closePath(); g.fill();
      g.restore();
    }
    // legs
    g.strokeStyle = '#8c8c8c'; g.lineWidth = Math.max(1, w * 0.08);
    g.beginPath(); g.moveTo(x - w * 0.35, by - h * 0.05); g.lineTo(x - w * 0.62, by); g.moveTo(x + w * 0.35, by - h * 0.05); g.lineTo(x + w * 0.62, by); g.stroke();
    // body
    const body = lin(g, x - w / 2, 0, x + w / 2, 0, [[0, '#8f9499'], [0.35, '#f2f4f5'], [0.6, '#cfd3d6'], [1, '#7a7f84']]);
    g.fillStyle = body;
    g.beginPath();
    g.moveTo(x - w / 2, by - h * 0.04);
    g.lineTo(x - w / 2, by - h * 0.78);
    g.bezierCurveTo(x - w / 2, by - h * 0.93, x - w * 0.18, by - h, x, by - h);
    g.bezierCurveTo(x + w * 0.18, by - h, x + w / 2, by - h * 0.93, x + w / 2, by - h * 0.78);
    g.lineTo(x + w / 2, by - h * 0.04);
    g.closePath(); g.fill();
    // heat-shield tiles on one side
    g.fillStyle = '#2b2b2f';
    g.beginPath(); g.moveTo(x - w / 2, by - h * 0.04); g.lineTo(x - w / 2, by - h * 0.78); g.bezierCurveTo(x - w / 2, by - h * 0.9, x - w * 0.3, by - h * 0.96, x - w * 0.16, by - h * 0.98); g.lineTo(x - w * 0.16, by - h * 0.04); g.closePath(); g.fill();
    // flaps
    g.fillStyle = '#3a3a3e';
    g.beginPath(); g.moveTo(x - w / 2, by - h * 0.12); g.lineTo(x - w * 0.95, by - h * 0.08); g.lineTo(x - w * 0.95, by - h * 0.24); g.lineTo(x - w / 2, by - h * 0.3); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(x + w / 2, by - h * 0.12); g.lineTo(x + w * 0.95, by - h * 0.08); g.lineTo(x + w * 0.95, by - h * 0.24); g.lineTo(x + w / 2, by - h * 0.3); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(x - w / 2, by - h * 0.76); g.lineTo(x - w * 0.8, by - h * 0.74); g.lineTo(x - w * 0.8, by - h * 0.84); g.lineTo(x - w * 0.46, by - h * 0.88); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(x + w / 2, by - h * 0.76); g.lineTo(x + w * 0.8, by - h * 0.74); g.lineTo(x + w * 0.8, by - h * 0.84); g.lineTo(x + w * 0.46, by - h * 0.88); g.closePath(); g.fill();
    // windows
    g.fillStyle = opts.night ? '#ffe39a' : '#3d566b';
    for (let i = 0; i < 3; i++) g.fillRect(x + w * 0.02 + i * w * 0.12, by - h * 0.82, w * 0.07, h * 0.025);
    g.restore();
  }

  function drawAstronaut(g, x, y, t, phase) {
    const s = Math.max(2.2, t * 0.06);
    const bob = Math.abs(Math.sin(phase)) * s * 0.3;
    g.fillStyle = 'rgba(30,8,0,0.35)'; g.beginPath(); g.ellipse(x, y + s * 1.6, s * 0.9, s * 0.35, 0, 0, TAU); g.fill();
    g.fillStyle = '#f4f1ec'; rr(g, x - s * 0.6, y - bob, s * 1.2, s * 1.5, s * 0.4); g.fill();
    g.beginPath(); g.arc(x, y - s * 0.55 - bob, s * 0.7, 0, TAU); g.fill();
    g.fillStyle = '#e8a33a'; g.beginPath(); g.arc(x + s * 0.18, y - s * 0.6 - bob, s * 0.42, 0, TAU); g.fill();
    g.fillStyle = '#ff7a3d'; g.fillRect(x - s * 0.6, y + s * 0.3 - bob, s * 1.2, s * 0.22);
  }
  function drawRover(g, x, y, t, dir) {
    const s = t * 0.13;
    g.save(); g.translate(x, y); g.scale(dir, 1);
    g.fillStyle = 'rgba(30,8,0,0.35)'; g.beginPath(); g.ellipse(0, s * 0.9, s * 1.5, s * 0.35, 0, 0, TAU); g.fill();
    g.fillStyle = '#e9e4de'; rr(g, -s * 1.3, -s * 0.6, s * 2.6, s * 1.0, s * 0.3); g.fill();
    g.fillStyle = '#3d566b'; rr(g, s * 0.3, -s * 0.45, s * 0.8, s * 0.45, s * 0.15); g.fill();
    g.fillStyle = '#ff7a3d'; g.fillRect(-s * 1.3, -s * 0.05, s * 2.6, s * 0.15);
    g.fillStyle = '#2a2420'; for (const wx of [-0.9, 0, 0.9]) { g.beginPath(); g.arc(wx * s, s * 0.5, s * 0.33, 0, TAU); g.fill(); }
    g.restore();
  }

  function drawModule(g, type, cx, cy, t, o) {
    const fn = ART[type];
    if (fn) fn(g, cx, cy, t, o);
  }

  function drawIcon(cv, type) {
    const g = cv.getContext('2d');
    const t = Math.min(cv.width, cv.height);
    g.clearRect(0, 0, cv.width, cv.height);
    drawModule(g, type, cv.width / 2, cv.height / 2 + t * 0.06, t * 0.92, { time: 0, night: 0, day: 1, active: true, charge: 0.75, dust: 0 });
  }

  const api = { layout, tileFromPx, center, terrain, drawSky, drawModule, drawIcon, drawStarship, drawAstronaut, drawRover, daylight, glow, mix, h2, fbm, ART };
  root.MarsRender = api;
})(typeof window !== 'undefined' ? window : globalThis);
