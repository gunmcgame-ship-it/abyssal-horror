// ============================================================================
// The paper atlas: every sheet in PAPERS drawn once at load with Canvas 2D (real type, generated photographs,
// the park map from the canyon's own layout, the star chart, the observer's handwriting), then uploaded with mipmaps.
// Drawing units are millimetres, the origin each sheet's top-left corner.
// ============================================================================
const PFONT = {
  black: '"Old English Text MT", "Engravers Old English", "UnifrakturMaguntia", "Times New Roman", serif',
  head: '"Franklin Gothic Heavy", "Franklin Gothic Medium", Impact, "Arial Narrow", sans-serif',
  serif: '"Times New Roman", Times, Georgia, serif',
  hand: '"Segoe Script", "Ink Free", "Bradley Hand ITC", "Bradley Hand", "Brush Script MT", cursive',
  type: '"Courier New", Courier, monospace',
};
// period-plausible body copy: sentences from a word list (it reads as English type at a glance)
const PWORDS = ('the of and to a in that was for on with as by at said from his it an were which this be has had have but not been they their after who ' +
  'would one all there two more when out up into than over new last other some could also about them time only first years may report reported officials ' +
  'night object light lights sky seen county miles north west south east observers residents witnesses airport base air force disk flying strange glowing ' +
  'moved slowly rapidly minutes hours later sheriff deputy ranch rancher highway motorists engine cars stalled radio static signal satellite soviet moon ' +
  'launched orbit scientists observatory weather balloon officers investigation statement spokesman wednesday thursday morning evening near town canyon ' +
  'desert mountains valley state government army navy reports bright red white green silent low high across ground wire debris field week').split(' ');
const pSentence = (n) => { let s = ''; for (let i = 0; i < n; i++) { let w = PWORDS[rnd() * PWORDS.length | 0]; if (!i) w = w[0].toUpperCase() + w.slice(1); s += (i ? ' ' : '') + w + (i < n - 1 && rnd() < 0.08 ? ',' : ''); } return s + '.'; };
const pText = (sent) => { const out = []; for (let i = 0; i < sent; i++) out.push(pSentence(6 + (rnd() * 14 | 0))); return out.join(' '); };

// justified columns of body type, paragraphs indented; returns the y it ended at
function pColumn(c, x, y, w, yMax, size, text, lead = 1.18, justify = true) {
  c.font = size + 'px ' + PFONT.serif; c.textBaseline = 'alphabetic';
  const sp = c.measureText(' ').width, lh = size * lead;
  const paras = text.split('\n');
  for (const para of paras) {
    const words = para.split(' '); let line = [], lw = 0, first = true;
    const flush = (last) => {
      if (y + lh > yMax) return false;
      const ind = first ? size * 1.2 : 0; let xx = x + ind;
      const gap = justify && !last && line.length > 1 ? (w - ind - lw) / (line.length - 1) : sp;
      for (const [t, tw] of line) { c.fillText(t, xx, y + size); xx += tw + gap; }
      y += lh; line = []; lw = 0; first = false; return true;
    };
    for (const t of words) {
      const tw = c.measureText(t).width, ind = first ? size * 1.2 : 0;
      if (line.length && lw + sp * line.length + tw > w - ind) { lw += 0; if (!flush(false)) return y; }
      line.push([t, tw]); lw += tw;
    }
    if (line.length && !flush(true)) return y;
  }
  return y;
}
// a line of type fitted to a width (condensed or stretched a little, as compositors did)
function pFit(c, t, x, y, w, size, font, align = 'center') {
  c.font = size + 'px ' + font; const tw = c.measureText(t).width, k = Math.min(w / tw, 1);
  c.save(); c.translate(align === 'center' ? x + w / 2 : x, y); c.scale(k, 1); c.textAlign = align; c.fillText(t, 0, 0); c.restore();
}
// paper aging: browned edges, foxing, fibres, sometimes a coffee ring
function pAge(c, W, H, amt, ring = false) {
  const e = Math.min(W, H) * 0.08;
  for (const [x0, y0, x1, y1] of [[0, 0, e, 0], [W, 0, W - e, 0], [0, 0, 0, e], [0, H, 0, H - e]]) {
    const g = c.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, `rgba(120,85,40,${0.35 * amt})`); g.addColorStop(1, 'rgba(120,85,40,0)'); c.fillStyle = g; c.fillRect(0, 0, W, H);
  }
  for (let i = 0; i < 60 * amt; i++) { const x = rnd() * W, y = rnd() * H, r = rr(0.3, 2.2); const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(130,90,40,${rr(0.1, 0.35) * amt})`); g.addColorStop(1, 'rgba(130,90,40,0)'); c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2); }
  c.strokeStyle = 'rgba(90,80,60,0.05)'; c.lineWidth = 0.08;
  for (let i = 0; i < W * H * 0.02; i++) { const x = rnd() * W, y = rnd() * H, a = rnd() * TAU, l = rr(0.5, 2.5); c.beginPath(); c.moveTo(x, y); c.lineTo(x + cos(a) * l, y + sin(a) * l); c.stroke(); }
  if (ring) { const x = rr(W * 0.55, W * 0.85), y = rr(H * 0.5, H * 0.8), r = rr(30, 40); c.strokeStyle = 'rgba(110,70,30,0.28)'; c.lineWidth = 1.6; c.beginPath(); c.arc(x, y, r, 0.3, TAU - 0.5); c.stroke(); c.lineWidth = 0.4; c.beginPath(); c.arc(x + 1, y, r - 1.2, 0, TAU); c.stroke(); }
}
// a photograph, computed pixel by pixel (brightness 0..1, full tonal range), then film grain, lens softness and a
// vignette. 0 moonlit desert with a smeared light, 1 star trails over a ridge, 2 a daylight mesa with a dark disc,
// 3 a row of lights over a ridge, 4 debris on a floor (1947), 6 the canyon by day: walls, junipers, the wash
function pPhoto(type, w, h, sd) {
  rseed(800 + sd);
  const cv = new OffscreenCanvas(w, h), c = cv.getContext('2d'), id = c.createImageData(w, h), d = id.data;
  const o = rr(0, 50), lx = rr(0.3, 0.6), ly = rr(0.22, 0.38);
  const ridge = (u, base, amp, mesa = 0) => base + amp * (fbm(u * 2.5 + o, o, 0, 5) - 0.5) - mesa * sstep(0.42, 0.5, u + 0.02 * fbm(u * 30, 1, 0, 2)) * sstep(0.9, 0.8, u);
  const glow = (u, v, x, y, r) => Math.exp(-((u - x) ** 2 + ((v - y) * 1.5) ** 2) / (r * r));
  const trailR = [], trailA = [], trailB = [];
  if (type === 1) for (let i = 0; i < 220; i++) { trailR.push(rr(0.02, 1.4)); trailA.push(rnd() * TAU); trailB.push(pow(rnd(), 1.5)); }
  const flecks = []; if (type === 4) for (let i = 0; i < 70; i++) flecks.push([rr(0.08, 0.92), rr(0.35, 0.95), rr(0.008, 0.03), rnd() * PI, rr(0.6, 1)]);
  const trees = []; if (type === 6) for (let i = 0; i < 9; i++) trees.push([rr(0.05, 0.95), rr(0.68, 0.9), rr(0.025, 0.06)]);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const u = i / w, v = j / h; let L;
    if (type === 0) {            // moonlight: a grey sky, the mesa line, pale sand, the light smeared by a long exposure
      const hz = ridge(u, 0.6, 0.1, 0.12);
      if (v < hz) L = 0.42 + 0.18 * v + 0.75 * glow(u, v, lx, ly, 0.035) + 0.25 * glow(u, v, lx, ly, 0.12) + 0.4 * glow(u, v * 6, lx + 0.03, ly * 6, 0.03);
      else L = 0.2 + 0.08 * (v - hz) * 3 + 0.08 * (fbm(u * 25 + o, v * 40, 1, 4) - 0.5) + (v - hz < 0.06 ? -0.05 : 0);
    } else if (type === 1) {     // the observer's star trails: concentric arcs round the pole, a dark ridge
      const px = 0.72, py = 0.05, du = (u - px) * w / h, dv = v - py, r = hypot(du, dv), a = atan2(dv, du);
      L = 0.1 + 0.12 * (1 - v);
      for (let k = 0; k < trailR.length; k++) { const dr = abs(r - trailR[k]); if (dr > 0.0035) continue; let da = a - trailA[k]; da = ((da % TAU) + TAU) % TAU; if (da < 0.55) L += trailB[k] * (1 - dr / 0.0035) * 0.95; }
      const hz = ridge(u, 0.78, 0.1); if (v > hz) L = 0.03 + 0.03 * fbm(u * 40, v * 40, 2, 3);
    } else if (type === 2) {     // daylight: a pale sky with high cloud, the mesa with banded cliffs and talus, brush on the flat
      const hz = ridge(u, 0.6, 0.12, 0.2), cl = fbm(u * 3 + o, v * 7, 3, 5);
      if (v < hz) { L = 0.66 + 0.2 * v + 0.12 * sstep(0.5, 0.8, cl); const e = ((u - 0.3) / 0.045) ** 2 + ((v - 0.2) / 0.014) ** 2, dome = ((u - 0.3) / 0.018) ** 2 + ((v - 0.188) / 0.014) ** 2; if (e < 1 || (dome < 1 && v < 0.19)) L = 0.2 + 0.06 * (u - 0.3) * 10; }
      else if (v < 0.74) { const depth = (v - hz) / max(0.74 - hz, 0.01); L = (0.36 + 0.14 * sin(v * 140 + fbm(u * 6, v * 20, 2, 3) * 5) + 0.1 * (fbm(u * 30, v * 80, 5, 3) - 0.5)) * (0.75 + 0.35 * fbm(u * 5, 2, 9, 2)) * (1 - 0.25 * depth) + 0.2 * sstep(0.6, 1, depth) * fbm(u * 50, v * 50, 1, 3); }
      else { L = 0.56 + 0.14 * (fbm(u * 18 + o, v * 30, 4, 4) - 0.5) + 0.1 * (v - 0.74); if (fbm(u * 70, v * 110, 7, 3) > 0.62) L *= 0.42; }
    } else if (type === 3) {     // a row of lights over a ridge, the sky faintly lit
      const hz = ridge(u, 0.68, 0.1);
      L = v < hz ? 0.3 + 0.14 * (1 - v) : 0.1 + 0.06 * fbm(u * 30, v * 30, 3, 3);
      for (let k = 0; k < 4; k++) { const gx = 0.25 + k * 0.15, gy = 0.34 - k * 0.035; L += 0.9 * glow(u, v, gx, gy, 0.016) + 0.25 * glow(u, v, gx, gy, 0.06); }
    } else if (type === 4) {     // debris laid out on an office floor (1947): foil, sticks, a pair of boots at the edge
      L = 0.44 + 0.08 * (fbm(u * 4, v * 40, 1, 3) - 0.5) - 0.06 * (((v * 14) % 1) < 0.04 ? 1 : 0);
      for (const [x, y, s, a, b] of flecks) { const du = (u - x) * cos(a) + (v - y) * sin(a), dv = -(u - x) * sin(a) + (v - y) * cos(a); if (abs(du) < s && abs(dv) < s * (0.3 + 0.3 * fbm(du * 200, dv * 200, 0, 1))) L = 0.5 + 0.48 * b * (0.5 + 0.5 * fbm(u * 300, v * 300, 0, 2)); }
      if (u > 0.8 && u < 0.95 && v < 0.42) L = 0.1 + 0.08 * fbm(u * 50, v * 50, 2, 3);
    } else {                     // the canyon by day: dark walls either side with bedding, a pale sky slot, junipers, the sandy wash
      const wl = 0.22 + 0.08 * fbm(v * 3 + o, 1, 0, 4) - 0.1 * v, wr = 0.75 - 0.08 * fbm(v * 3, o, 2, 4) + 0.12 * v;
      if (v < 0.55 && u > wl && u < wr) L = 0.72 + 0.15 * v + 0.08 * fbm(u * 4, v * 8, 3, 3);
      else if (v < 0.72 || u < wl || u > wr) { const bed = sin(v * 90 + fbm(u * 5, v * 9, 4, 3) * 4); L = (0.3 + 0.1 * bed + 0.12 * (fbm(u * 25, v * 60, 6, 4) - 0.5)) * (u < wl ? 0.8 : 1.05); }
      else L = 0.6 + 0.1 * (fbm(u * 20, v * 40, 8, 4) - 0.5) - 0.12 * sstep(0.72, 0.8, v) * (1 - sstep(0.8, 0.9, v));
      for (const [x, y, s] of trees) { const dx = (u - x) / s, dy = (v - y) / (s * 1.2); if (dx * dx + dy * dy * 1.3 < 1 + 0.4 * (fbm(u * 120, v * 120, 1, 2) - 0.5)) L = 0.12 + 0.08 * fbm(u * 200, v * 200, 1, 2); }
    }
    const g = (rnd() - 0.5) * 0.08, k = (j * w + i) * 4, val = clamp((L + g) * 255, 0, 255);
    d[k] = d[k + 1] = d[k + 2] = val; d[k + 3] = 255;
  }
  c.putImageData(id, 0, 0);
  const out = new OffscreenCanvas(w, h), oc = out.getContext('2d'); oc.filter = `blur(${max(w / 600, 0.45)}px)`; oc.drawImage(cv, 0, 0); oc.filter = 'none';
  const vg = oc.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.38)'); oc.fillStyle = vg; oc.fillRect(0, 0, w, h);
  return out;
}
// a halftone of a picture onto newsprint: black dots on a 45 degree screen (cell in mm), into rect x, y, w, h (mm)
function pHalftone(c, img, x, y, w, h, cell) {
  const ic = img.getContext('2d').getImageData(0, 0, img.width, img.height).data;
  c.fillStyle = 'rgba(20,18,16,0.92)';
  const s2 = Math.SQRT1_2, n = Math.ceil((w + h) / cell) + 2;
  c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
  for (let i = -n; i < n; i++) for (let j = -n; j < n; j++) {
    const cx = x + w / 2 + (i - j) * cell * s2, cy = y + h / 2 + (i + j) * cell * s2;
    if (cx < x - cell || cx > x + w + cell || cy < y - cell || cy > y + h + cell) continue;
    const px = clamp(((cx - x) / w * img.width) | 0, 0, img.width - 1), py = clamp(((cy - y) / h * img.height) | 0, 0, img.height - 1);
    const L = ic[(py * img.width + px) * 4] / 255, r = Math.sqrt(1 - L) * cell * 0.62;
    if (r > 0.03) { c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.fill(); }
  }
  c.restore();
}
const pRule = (c, x0, y, x1, wd) => { c.fillRect(x0, y, x1 - x0, wd); };

// ---------------------------------------------------------------- the sheets
const CLIPS = [
  ['STRANGE LIGHT SEEN OVER DESERT CANYON', 'Rancher Says Object Hung Silent For Ten Minutes'],
  ['EGG-SHAPED OBJECT STALLS CARS NEAR LEVELLAND', 'Motorists Tell Sheriff Of Glowing Craft On Highway'],
  ['AIR FORCE CALLS DISK REPORTS MISTAKES', 'Balloons And Bright Planets Blamed, Spokesman Says'],
  ['LOCAL RADIO MAN HEARS RED MOON SIGNAL', 'Beeping Comes In On Short Wave Before Dawn'],
  ['WHITE SANDS PATROL SEES BRIGHT OBJECT', 'Army Men Report Light Near Old Bunker'],
  ['LIGHTS OVER MONUMENT STILL UNEXPLAINED', 'Park Ranger Logs Third Report This Month'],
];
const PDRAW = [];
// 0, 1: front pages, folded in half (the top half shows); 1957 (today's) and 1947 (the Roswell paper, kept)
PDRAW[0] = PDRAW[1] = (c, W, H, S) => {
  const old = S.kind === 1;
  c.fillStyle = old ? '#d6c59c' : '#d9d3c0'; c.fillRect(0, 0, W, H);
  const m = 9; c.fillStyle = '#1b1a18';
  pFit(c, old ? 'Roswell Daily Record' : 'The Desert Sentinel', m + 40, m + 21, W - 2 * m - 80, 24, PFONT.black);
  c.font = '3px ' + PFONT.serif; c.textAlign = 'left';
  for (const [x, t] of [[m, old ? 'WEATHER' : 'WEATHER'], [W - m - 34, old ? 'HOME EDITION' : 'FINAL']]) { c.strokeStyle = '#1b1a18'; c.lineWidth = 0.3; c.strokeRect(x, m, 34, 16); c.font = 'bold 3.2px ' + PFONT.head; c.fillText(t, x + 3, m + 5); c.font = '2.4px ' + PFONT.serif; c.fillText(old ? 'Fair and warm' : 'Clear, colder', x + 3, m + 9); c.fillText(old ? 'tonight.' : 'tonight. Low 28.', x + 3, m + 12.5); }
  pRule(c, m, m + 26, W - m, 0.9); pRule(c, m, m + 27.6, W - m, 0.25);
  c.font = '2.8px ' + PFONT.serif; c.textAlign = 'center';
  c.fillText(old ? 'ROSWELL, NEW MEXICO, TUESDAY, JULY 8, 1947      FIVE CENTS' : 'INYO COUNTY, CALIFORNIA, THURSDAY, NOVEMBER 7, 1957      FIVE CENTS', W / 2, m + 31);
  c.textAlign = 'left'; pRule(c, m, m + 32.5, W - m, 0.25);
  let y = m + 35;
  if (old) { pFit(c, 'RAAF Captures Flying Saucer', m, y + 17, W - 2 * m, 22, PFONT.head); pFit(c, 'On Ranch in Roswell Region', m, y + 36, W - 2 * m, 22, PFONT.head); y += 40; }
  else { pFit(c, 'SECOND RED MOON CIRCLES EARTH', m, y + 15, W - 2 * m, 18, PFONT.head); pFit(c, 'WITH DOG ABOARD', m + 40, y + 31, W - 2 * m - 80, 17, PFONT.head); y += 35; }
  c.font = 'italic 5px ' + PFONT.serif; c.textAlign = 'center'; c.fillText(old ? 'No Details of Flying Disk Are Revealed' : 'Mystery Lights Reported Over Texas Plains; Cars Stalled', W / 2, y + 4); c.textAlign = 'left'; y += 8;
  pRule(c, m, y, W - m, 0.25); y += 2.5;
  const nc = 6, gw = 2.4, cw = (W - 2 * m - gw * (nc - 1)) / nc;
  for (let i = 1; i < nc; i++) pRule(c, m + i * (cw + gw) - gw / 2, y, m + i * (cw + gw) - gw / 2 + 0.2, H - m - y);
  // the picture over two columns, its caption
  const px = m + 2 * (cw + gw), pw = cw * 2 + gw, ph = old ? 70 : 62;
  pHalftone(c, pPhoto(old ? 4 : 3, 360, Math.round(360 * ph / pw), S.seed), px, y, pw, ph, 0.55);
  c.font = 'bold 2.5px ' + PFONT.head; c.fillText(old ? 'DEBRIS FROM THE RANCH' : 'LIGHTS OVER THE PLAINS', px, y + ph + 3.5);
  pColumn(c, px, y + ph + 4.5, pw, y + ph + 13, 2.2, pText(3), 1.15);
  for (let i = 0; i < nc; i++) {
    const x = m + i * (cw + gw); let yy = i >= 2 && i < 4 ? y + ph + 14 : y;
    c.font = 'bold 3.6px ' + PFONT.head; const sub = CLIPS[(i + S.seed) % CLIPS.length][1].toUpperCase().split(' ');
    let l1 = '', l2 = ''; for (const wd of sub) { if (c.measureText(l1 + ' ' + wd).width < cw) l1 += (l1 ? ' ' : '') + wd; else l2 += (l2 ? ' ' : '') + wd; }
    c.fillText(l1, x, yy + 4); c.font = 'bold 3px ' + PFONT.head; c.fillText(l2.slice(0, 26), x, yy + 7.8); yy += 10;
    pColumn(c, x, yy, cw, H - m, 2.5, pText(60), 1.2);
  }
  pAge(c, W, H, old ? 1 : 0.35, old);
};
// 2: a clipping: a headline in two decks, then two columns, sometimes a picture
PDRAW[2] = (c, W, H, S) => {
  const ix = PAPERS.indexOf(S), [hd, sub] = CLIPS[ix % CLIPS.length];
  c.fillStyle = '#d5c6a1'; c.fillRect(0, 0, W, H); c.fillStyle = '#1d1b18';
  const m = 4; let y = m;
  const words = hd.split(' '), half = Math.ceil(words.length / 2);
  pFit(c, words.slice(0, half).join(' '), m, y + 7.5, W - 2 * m, 8, PFONT.head); pFit(c, words.slice(half).join(' '), m, y + 16, W - 2 * m, 8, PFONT.head); y += 19;
  c.font = 'italic 3.4px ' + PFONT.serif; c.textAlign = 'center'; c.fillText(sub, W / 2, y + 2.5, W - 2 * m); c.textAlign = 'left'; y += 5;
  if (ix % 3 !== 1 && H > 90) { const ph = H * 0.32; pHalftone(c, pPhoto([2, 4, 2, 2][ix % 4], 240, Math.round(240 * ph / (W - 2 * m)), ix * 7), m, y, W - 2 * m, ph, 0.6); y += ph + 2; }
  const cw = (W - 2 * m - 2.5) / 2;
  c.font = 'bold 2.4px ' + PFONT.serif; c.fillText('(AP) —', m, y + 2.4);
  pColumn(c, m, y + 0.2, cw, H - m, 2.3, pText(120));
  pRule(c, m + cw + 1.15, y, m + cw + 1.35, H - m - y);
  pColumn(c, m + cw + 2.5, y + 0.2, cw, H - m, 2.3, pText(120));
  pAge(c, W, H, 0.9);
};
// 3: a photographic print: a white border with a slight deckle, the picture in silver greys, a warm cast
PDRAW[3] = (c, W, H, S) => {
  c.fillStyle = '#e6e1d4'; c.fillRect(0, 0, W, H);
  const b = Math.min(W, H) * 0.07, pw = W - 2 * b, ph = H - 2 * b;
  const ix = PAPERS.indexOf(S), kinds = [2, 4, 2, 2, 4, 2, 2], k = kinds[ix % kinds.length];
  const land = pw > ph, img = pPhoto(k, land ? 480 : 360, land ? 360 : 480, ix * 13 + 5);
  c.save(); c.beginPath();
  for (let i = 0; i <= 40; i++) { const t = i / 40; c.lineTo(b + pw * t, b + 0.25 * sin(t * 90)); } for (let i = 0; i <= 40; i++) { const t = i / 40; c.lineTo(W - b + 0.25 * sin(t * 80), b + ph * t); }
  for (let i = 0; i <= 40; i++) { const t = i / 40; c.lineTo(W - b - pw * t, H - b + 0.25 * sin(t * 85)); } for (let i = 0; i <= 40; i++) { const t = i / 40; c.lineTo(b + 0.25 * sin(t * 95), H - b - ph * t); }
  c.clip(); c.drawImage(img, b, b, pw, ph); c.fillStyle = 'rgba(140,110,60,0.08)'; c.fillRect(b, b, pw, ph); c.restore();
  pAge(c, W, H, 0.25);
};
// 4: the park map (a 1950s monument folder map), the canyon drawn from its own layout; the observer's pencil marks
PDRAW[4] = (c, W, H, S) => {
  c.fillStyle = '#dcd0aa'; c.fillRect(0, 0, W, H);
  const Sx = (W - 24) / 320, wx = (x, z) => [W / 2 + z * Sx, H / 2 - (x + 15) * Sx];
  const path = (pts) => { c.beginPath(); pts.forEach(([x, z], i) => { const [u, v] = wx(x, z); i ? c.lineTo(u, v) : c.moveTo(u, v); }); };
  const segs = []; for (let i = 0; i < CANYON.length - 1; i++) segs.push([CANYON[i], CANYON[i + 1]]); for (const q of POCKETS) segs.push([[q[0], q[1], q[4]], [q[2], q[3], q[5]]]);
  const band = (extra, col) => { c.strokeStyle = col; c.lineCap = c.lineJoin = 'round'; for (const [a, b] of segs) { c.lineWidth = ((a[2] + b[2]) / 2 + extra) * 2 * Sx; path([a, b]); c.stroke(); } };
  // the land: a height field over the canyon (cliffs rising off the rim, the plateau rolling beyond), drawn with
  // hypsometric tints, hill shading from the north-west and contour lines every 20 feet (every fifth heavier)
  {
    const pxm = S.rect[2] / W, PW = Math.round(W * pxm), PH = Math.round(H * pxm), g = 4, GW = Math.ceil(PW / g) + 3, GH = Math.ceil(PH / g) + 3, hg = new Float32Array(GW * GH);
    const cd = (x, z) => { let dd = 1e9; for (const [a, b] of segs) { const dx = b[0] - a[0], dz = b[1] - a[1], t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz), 0, 1); dd = min(dd, hypot(x - a[0] - dx * t, z - a[1] - dz * t) - (a[2] + (b[2] - a[2]) * t)); } return dd; };
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
      const mmx = i * g / pxm, mmy = j * g / pxm, wz = (mmx - W / 2) / Sx, wxw = -(mmy - H / 2) / Sx - 15, dd = cd(wxw, wz);
      hg[i + GW * j] = dd < 0 ? dd * 0.2 : 10 * (1 - Math.exp(-dd / 4)) + dd * 0.5 + 26 * (fbm(wxw * 0.011 + 3, wz * 0.011, 1, 5) - 0.5) * sstep(0, 30, dd);
    }
    const hAt = (x, y) => { const fx = x / g, fy = y / g, i = fx | 0, j = fy | 0, u = fx - i, v = fy - j, k = i + GW * j; return (hg[k] * (1 - u) + hg[k + 1] * u) * (1 - v) + (hg[k + GW] * (1 - u) + hg[k + GW + 1] * u) * v; };
    const img = new ImageData(PW, PH), D = img.data;
    for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
      const hh = hAt(x, y), gx = hAt(x + 1, y) - hh, gy2 = hAt(x, y + 1) - hh, gl = Math.hypot(gx, gy2) + 1e-4;
      const f = hh / 6, nl = Math.round(f), dl = Math.abs(f - nl) * 6 / gl, idx = nl % 5 === 0;
      const line = hh > 0.3 ? clamp(1 - dl / (idx ? 1.5 : 0.85), 0, 1) * (idx ? 0.9 : 0.55) : 0;
      const t = clamp(hh / 55, 0, 1), sh = clamp(0.5 - (gx + gy2) * 0.35, 0.15, 1);
      let r = 238 - 34 * t, gg = 228 - 40 * t, b = 198 - 56 * t;
      if (hh < 0.3) { r = 242; gg = 234; b = 210; }
      const lit = 0.82 + 0.36 * sh; r *= lit; gg *= lit; b *= lit;
      const k = (x + PW * y) * 4; D[k] = r * (1 - line) + 128 * line; D[k + 1] = gg * (1 - line) + 82 * line; D[k + 2] = b * (1 - line) + 46 * line; D[k + 3] = 255;
    }
    const oc = new OffscreenCanvas(PW, PH); oc.getContext('2d').putImageData(img, 0, 0); c.drawImage(oc, 0, 0, W, H);
    // desert washes: dashed blue lines running down off the plateau to the rim
    c.strokeStyle = 'rgba(60,95,130,0.75)'; c.lineWidth = 0.35; c.setLineDash([1.6, 0.7]);
    for (let n = 0; n < 16; n++) {
      let x = rr(0.05, 0.95) * PW, y = rr(0.05, 0.95) * PH; if (hAt(x, y) < 12) continue;
      c.beginPath(); c.moveTo(x / pxm, y / pxm);
      for (let s = 0; s < 120; s++) { const hh = hAt(x, y), gx = hAt(x + 2, y) - hAt(x - 2, y), gy2 = hAt(x, y + 2) - hAt(x, y - 2), gl = Math.hypot(gx, gy2) + 1e-5; x -= gx / gl * 5; y -= gy2 / gl * 5; if (x < 2 || y < 2 || x > PW - 3 || y > PH - 3 || hh < 0.5) break; c.lineTo(x / pxm, y / pxm); }
      c.stroke();
    }
    c.setLineDash([]);
    // the land-survey grid (quarter sections), faint red
    c.strokeStyle = 'rgba(170,60,40,0.22)'; c.lineWidth = 0.25; const q = 402 * Sx;
    for (let x = W / 2 % q; x < W; x += q) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
    for (let y = H / 2 % q; y < H; y += q) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
  }
  band(0.9, '#5e3a1e'); band(0, '#f2ead2');
  // the road up out of the canyon, the old track down to the ruins, the campground, the ruins, the arch
  c.strokeStyle = '#a3291c'; c.lineWidth = 1.1; path(RAMP.map((r) => [CAMP[0] + r[0], CAMP[2] + r[1]])); c.stroke(); c.strokeStyle = '#f0e8cf'; c.lineWidth = 0.5; c.setLineDash([1.2, 0.8]); c.stroke(); c.setLineDash([]);
  c.strokeStyle = '#2a2420'; c.lineWidth = 0.35; c.setLineDash([0.6, 0.9]); path(TRACKS); c.stroke(); c.setLineDash([]);
  { const [u, v] = wx(CAMP[0], CAMP[2]); c.fillStyle = '#2a2420'; c.beginPath(); c.moveTo(u - 2, v + 1.5); c.lineTo(u, v - 2); c.lineTo(u + 2, v + 1.5); c.fill(); }
  c.fillStyle = '#2a2420'; for (const [x, z] of RUINS) { const [u, v] = wx(x, z); c.fillRect(u - 0.7, v - 0.7, 1.4, 1.4); }
  // names
  c.fillStyle = '#3a2a1c'; c.font = 'italic 5.5px ' + PFONT.serif; c.textAlign = 'center';
  { const [u, v] = wx(-10, 20); c.save(); c.translate(u, v); c.rotate(-0.02); c.fillText('C O L D S U P P E R     C A N Y O N', 0, 0); c.restore(); }
  c.font = '2.6px ' + PFONT.serif;
  { const [u, v] = wx(-62, -86); c.fillText('Old Settlement', u, v + 9); c.font = 'italic 2.2px ' + PFONT.serif; c.fillText('(ruins)', u, v + 11.6); }
  { const [u, v] = wx(CAMP[0], CAMP[2]); c.font = '2.6px ' + PFONT.serif; c.fillText('Campground', u, v + 6); }
  { const [u, v] = wx(30, 70); c.fillText('East Reach', u, v); const [a, b] = wx(70, 40); c.save(); c.translate(a, b); c.rotate(-0.4); c.fillText('To State Highway 190', 0, 0); c.restore(); }
  // title block, legend, scale, north arrow, neat line
  c.textAlign = 'left'; c.fillStyle = '#efe7cc'; c.fillRect(10, 10, 112, 34); c.strokeStyle = '#2a2420'; c.lineWidth = 0.6; c.strokeRect(10, 10, 112, 34); c.lineWidth = 0.2; c.strokeRect(11.2, 11.2, 109.6, 31.6);
  c.fillStyle = '#2a2420'; c.font = '2.4px ' + PFONT.serif; c.fillText('UNITED STATES DEPARTMENT OF THE INTERIOR · NATIONAL PARK SERVICE', 14, 16);
  pFit(c, 'COLDSUPPER CANYON', 14, 26, 104, 9, PFONT.serif, 'left'); c.font = 'bold 4px ' + PFONT.serif; c.fillText('NATIONAL MONUMENT · CALIFORNIA', 14, 32.5);
  c.font = 'italic 2.3px ' + PFONT.serif; c.fillText('Established by Proclamation, 1938. Visitors are asked not to disturb the ruins.', 14, 38.5);
  c.save(); c.translate(W, H); c.scale(1.45, 1.45); c.translate(-W, -H);
  c.fillStyle = '#efe7cc'; c.fillRect(W - 66, H - 34, 56, 24); c.strokeRect(W - 66, H - 34, 56, 24); c.fillStyle = '#2a2420'; c.font = 'bold 2.6px ' + PFONT.serif; c.fillText('LEGEND', W - 63, H - 29.5);
  c.font = '2.3px ' + PFONT.serif; c.strokeStyle = '#a3291c'; c.lineWidth = 1; c.beginPath(); c.moveTo(W - 63, H - 25.5); c.lineTo(W - 55, H - 25.5); c.stroke(); c.fillText('Graded road', W - 52, H - 24.7);
  c.strokeStyle = '#2a2420'; c.lineWidth = 0.35; c.setLineDash([0.6, 0.9]); c.beginPath(); c.moveTo(W - 63, H - 21); c.lineTo(W - 55, H - 21); c.stroke(); c.setLineDash([]); c.fillText('Old wagon track', W - 52, H - 20.2);
  c.fillRect(W - 60, H - 17.6, 1.4, 1.4); c.fillText('Ruins', W - 52, H - 15.9); c.font = '2px ' + PFONT.serif; c.fillText('Contour interval 20 feet', W - 63, H - 12);
  for (let i = 0; i < 4; i++) { c.fillStyle = i % 2 ? '#efe7cc' : '#2a2420'; c.fillRect(14 + i * 10, H - 16, 10, 1.6); } c.strokeRect(14, H - 16, 40, 1.6); c.fillStyle = '#2a2420'; c.font = '2.1px ' + PFONT.serif; c.fillText('0', 13.5, H - 18); c.fillText('500', 32, H - 18); c.fillText('1000 FEET', 50, H - 18);
  { const x = W - 80, y = H - 22; c.beginPath(); c.moveTo(x, y - 10); c.lineTo(x + 3, y); c.lineTo(x, y - 2.5); c.lineTo(x - 3, y); c.closePath(); c.fill(); c.font = 'bold 4px ' + PFONT.serif; c.textAlign = 'center'; c.fillText('N', x, y - 12); c.textAlign = 'left'; }
  c.restore();
  c.lineWidth = 0.7; c.strokeRect(5, 5, W - 10, H - 10);
  // folds (it came folded in eight), the observer's pencil
  c.fillStyle = 'rgba(80,60,30,0.12)'; c.fillRect(W / 2 - 0.3, 0, 0.6, H); c.fillRect(0, H / 2 - 0.3, W, 0.6); c.fillRect(W / 4 - 0.2, 0, 0.4, H); c.fillRect(W * 3 / 4 - 0.2, 0, 0.4, H);
  c.strokeStyle = 'rgba(60,60,66,0.8)'; c.fillStyle = 'rgba(60,60,66,0.85)'; c.lineWidth = 0.45;
  { const [u, v] = wx(14, 72); c.beginPath(); c.ellipse(u, v, 13, 9, 0.2, 0.2, TAU + 0.1); c.stroke(); c.font = '4.2px ' + PFONT.hand; c.fillText('lights here?', u + 10, v - 11); c.fillText('Oct 29, Nov 2', u + 12, v - 6.5);
    const [a, b] = wx(CAMP[0] + 2, CAMP[2] + 4); c.beginPath(); c.moveTo(a + 2, b - 2); c.quadraticCurveTo((a + u) / 2, b - 20, u - 11, v + 3); c.stroke(); c.font = '3.6px ' + PFONT.hand; c.fillText('camp', a - 13, b + 9); }
  { const [u, v] = wx(-50, -85); c.beginPath(); c.arc(u, v, 8, 0, TAU); c.stroke(); c.font = '3.6px ' + PFONT.hand; c.fillText('"Coldsupper" — ask', u - 12, v - 11); }
  pAge(c, W, H, 0.6, true);
};
// 5: the star chart: a planisphere-style chart on navy card, printed in cream; the observer's red pencil
PDRAW[5] = (c, W, H, S) => {
  c.fillStyle = '#e8e0c8'; c.fillRect(0, 0, W, H);
  const cx = W / 2, cy = H * 0.45, R = H * 0.4, cream = '#1e1b17'; // printed in black ink on newsprint
  c.fillStyle = '#efe7cf'; c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.fill();
  // the milky way: a soft band of tiny stars
  c.save(); c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.clip(); c.translate(cx, cy); c.rotate(-0.7);
  const mw = c.createLinearGradient(0, -R * 0.25, 0, R * 0.25); mw.addColorStop(0, 'rgba(200,200,230,0)'); mw.addColorStop(0.5, 'rgba(70,62,52,0.16)'); mw.addColorStop(1, 'rgba(200,200,230,0)'); c.fillStyle = mw; c.fillRect(-R, -R * 0.25, 2 * R, R * 0.5);
  c.fillStyle = 'rgba(40,35,30,0.4)'; for (let i = 0; i < 900; i++) { const x = rr(-R, R), y = (rnd() + rnd() + rnd() - 1.5) * R * 0.18; c.fillRect(x, y, 0.25, 0.25); }
  c.restore();
  c.strokeStyle = 'rgba(60,54,46,0.55)'; c.lineWidth = 0.25; c.setLineDash([1, 1]);
  for (const r of [R / 3, R * 2 / 3]) { c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.stroke(); }
  c.setLineDash([]); for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; c.beginPath(); c.moveTo(cx + cos(a) * R * 0.08, cy + sin(a) * R * 0.08); c.lineTo(cx + cos(a) * R, cy + sin(a) * R); c.stroke(); }
  c.strokeStyle = cream; c.lineWidth = 0.6; c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.stroke(); c.lineWidth = 0.25; c.beginPath(); c.arc(cx, cy, R + 4, 0, TAU); c.stroke();
  c.fillStyle = cream; c.font = '3px ' + PFONT.serif; c.textAlign = 'center';
  for (let i = 0; i < 24; i++) { const a = i / 24 * TAU - PI / 2; c.save(); c.translate(cx + cos(a) * (R + 2.2), cy + sin(a) * (R + 2.2)); c.rotate(a + PI / 2); c.fillText(i + 'h', 0, 1); c.restore(); }
  // stars by magnitude, constellation lines and names
  const stars = []; for (let i = 0; i < 520; i++) { const r = R * Math.sqrt(rnd()) * 0.97, a = rnd() * TAU, mag = pow(rnd(), 3); stars.push([cx + cos(a) * r, cy + sin(a) * r, mag]); }
  const names = ['CASSIOPEIA', 'PERSEUS', 'ANDROMEDA', 'PEGASUS', 'CYGNUS', 'AURIGA', 'TAURUS', 'URSA MAJOR', 'CEPHEUS', 'LYRA', 'ARIES', 'ORION'];
  c.strokeStyle = 'rgba(30,27,23,0.65)'; c.lineWidth = 0.22; c.font = 'italic 2.6px ' + PFONT.serif;
  for (let g = 0; g < names.length; g++) {
    const a = g / names.length * TAU + 0.3, r = R * rr(0.3, 0.8), gx = cx + cos(a) * r, gy = cy + sin(a) * r, pts = [];
    for (let k = 0; k < 5 + (rnd() * 3 | 0); k++) pts.push([gx + rr(-14, 14), gy + rr(-10, 10), rr(0.4, 1)]);
    pts.sort((p, q) => p[0] - q[0]); c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.stroke(); stars.push(...pts);
    c.fillText(names[g], gx, gy + 15);
  }
  for (const [x, y, mag] of stars) { c.beginPath(); c.arc(x, y, 0.25 + mag * 1.3, 0, TAU); c.fill(); }
  c.font = 'bold 6px ' + PFONT.serif; c.fillText('THE NOVEMBER SKY', cx, H - 22); c.font = 'italic 3px ' + PFONT.serif;
  c.fillText('as seen at 10 p.m. early in the month, 9 p.m. at mid-month · for latitude 35° north', cx, H - 16.5);
  c.font = '2.3px ' + PFONT.serif; c.fillText('Hold the chart overhead with the name of the direction you face at the bottom.', cx, H - 12.5);
  c.textAlign = 'left'; c.strokeStyle = cream; c.lineWidth = 0.4; c.strokeRect(4, 4, W - 8, H - 8);
  // red pencil: a ring round a patch of sky, an X, a note
  const rx = cx + R * 0.38, ry = cy - R * 0.32; c.strokeStyle = 'rgba(190,40,30,0.9)'; c.lineWidth = 0.6; c.beginPath(); c.ellipse(rx, ry, 11, 9, 0.3, 0.3, TAU + 0.2); c.stroke();
  c.beginPath(); c.moveTo(rx - 2, ry - 2); c.lineTo(rx + 2, ry + 2); c.moveTo(rx + 2, ry - 2); c.lineTo(rx - 2, ry + 2); c.stroke();
  c.fillStyle = 'rgba(190,40,30,0.95)'; c.font = '4.4px ' + PFONT.hand; c.fillText('stars gone here', rx + 9, ry - 12); c.fillText('3:12 am — 40 sec?', rx + 11, ry - 6.5);
  pAge(c, W, H, 0.2);
};
// the dog, as the wire photo showed her: a light, short-coated mongrel with darker patches over the eyes and ears,
// ears up, in her flight harness against the capsule's quilted padding. A small model (ellipsoids blended with a
// smooth minimum) ray-marched straight on, lit softly from the upper left, then blurred and grained like a wire print
function pDog(w, h, sd) {
  rseed(900 + sd);
  const E = (x, y, z, cx, cy, cz, rx, ry, rz) => { const a = (x - cx) / rx, b = (y - cy) / ry, c = (z - cz) / rz, k0 = hypot(a, b, c), k1 = hypot(a / rx, b / ry, c / rz); return k0 * (k0 - 1) / (k1 || 1e-6); };
  const sm = (a, b, k) => { const t = max(k - abs(a - b), 0) / k; return min(a, b) - t * t * k * 0.25; };
  const dog = (x, y, z) => {
    let d = E(x, y, z, 0, 0.18, 0, 0.3, 0.28, 0.28);                                  // skull
    d = sm(d, E(x, y, z, 0.27, 0.03, 0.17, 0.29, 0.16, 0.17), 0.12);                  // muzzle, toward us and right
    d = sm(d, E(x, y, z, 0.47, 0.06, 0.26, 0.06, 0.05, 0.05), 0.04);                  // nose
    d = sm(d, E(x, y, z, -0.16, 0.5, -0.02, 0.09, 0.22, 0.05), 0.08);                 // ears, up
    d = sm(d, E(x, y, z, 0.15, 0.53, 0.04, 0.09, 0.21, 0.05), 0.08);
    d = sm(d, E(x, y, z, -0.04, -0.33, -0.07, 0.34, 0.32, 0.3), 0.18);                // neck
    d = sm(d, E(x, y, z, -0.05, -0.88, -0.06, 0.78, 0.42, 0.45), 0.22);              // chest and shoulders
    return d;
  };
  const cv = new OffscreenCanvas(w, h), c = cv.getContext('2d'), id = c.createImageData(w, h), D = id.data, asp = h / w;
  const L = [-0.5, 0.62, 0.6], ll = hypot(...L); L[0] /= ll; L[1] /= ll; L[2] /= ll;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const x = (i / w * 2 - 1) * 0.95 + 0.04, y = -(j / h * 2 - 1) * 0.95 * asp + 0.05; let z = 1.2, hit = false;
    for (let s = 0; s < 64; s++) { const d = dog(x, y, z); if (d < 0.002) { hit = true; break; } z -= max(d, 0.004); if (z < -1.2) break; }
    let v;
    if (!hit) { const q = sin((x + y) * 22) * sin((x - y) * 22); v = 0.42 - 0.18 * (y + 0.4) * 0.5 + 0.05 * (q > 0.94 ? -1 : 0) - 0.1 * x; }   // the capsule's quilted wall
    else {
      const e = 0.004, nx = dog(x + e, y, z) - dog(x - e, y, z), ny = dog(x, y + e, z) - dog(x, y - e, z), nz = dog(x, y, z + e) - dog(x, y, z - e), nl = hypot(nx, ny, nz) || 1;
      const dif = max(0, (nx * L[0] + ny * L[1] + nz * L[2]) / nl), rim = (1 - nz / nl) ** 2;
      // coat: light, with darker patches round the left eye and ear and over the right eye; fur grain
      const mk = sstep(0.55, 0.62, fbm(x * 3 + 4, y * 3, z * 3, 3) + 0.35 * Math.exp(-((x + 0.1) ** 2 + (y - 0.3) ** 2) * 12) + 0.25 * Math.exp(-((x - 0.12) ** 2 + (y - 0.42) ** 2) * 30) - 0.2 * Math.exp(-((x - 0.02) ** 2 + (y - 0.18) ** 2) * 60));
      let alb = mix(0.82, 0.3, mk * (y > -0.08 ? 1 : 0.25)) * (0.85 + 0.15 * fbm(x * 60, y * 90, z * 60, 2));
      const eye = (ex, ey) => Math.exp(-((x - ex) ** 2 + (y - ey) ** 2) / 0.0013);
      alb *= 1 - 0.9 * max(eye(-0.02, 0.23), eye(0.21, 0.22));
      if ((abs(y + 0.74 + 0.12 * x) < 0.045 || abs(x + 0.35 + 0.5 * (y + 0.5)) < 0.04 && y < -0.45) && z > -0.5) alb = 0.12;   // the harness: round her chest, over the shoulder
      if (y > 0.02 && y < 0.1 && x > 0.42) alb *= 0.25;                                    // the nose leather
      v = alb * (0.18 + 0.82 * dif) + 0.1 * rim * alb + 0.35 * max(eye(-0.008, 0.238), eye(0.222, 0.232)) * 0.6;
    }
    const k = (j * w + i) * 4, g = clamp((v + (rnd() - 0.5) * 0.06) * 255, 0, 255); D[k] = D[k + 1] = D[k + 2] = g; D[k + 3] = 255;
  }
  c.putImageData(id, 0, 0);
  const out = new OffscreenCanvas(w, h), oc = out.getContext('2d'); oc.filter = 'blur(' + max(w / 300, 0.7) + 'px)'; oc.drawImage(cv, 0, 0); oc.filter = 'none';
  return out;
}
// 8: a whole front page pinned up in the tent: the Los Angeles Times of Monday, November 4, 1957, the morning after
// Sputnik II went up with the dog. The banner and the deck are the paper's own; the stories under them are written
// for the game.
PDRAW[8] = (c, W, H, S) => {
  c.fillStyle = '#dcd5c1'; c.fillRect(0, 0, W, H);
  const m = 10, ink = '#1b1a18'; c.fillStyle = ink; c.strokeStyle = ink;
  // ears and masthead
  for (const [x, t, l2, l3] of [[m, 'WEATHER', 'Fair today and', 'tomorrow. Cooler.'], [W - m - 48, 'FINAL', 'Complete Stock', 'Market Closing']]) {
    c.lineWidth = 0.35; c.strokeRect(x, m, 48, 22); c.font = 'bold 4.2px ' + PFONT.head; c.fillText(t, x + 3, m + 6.5); c.font = '3px ' + PFONT.serif; c.fillText(l2, x + 3, m + 12); c.fillText(l3, x + 3, m + 16);
  }
  pFit(c, 'Los Angeles Times', m + 56, m + 27, W - 2 * m - 112, 32, PFONT.black);
  pRule(c, m, m + 33, W - m, 1.1); pRule(c, m, m + 35, W - m, 0.3);
  c.font = '3.4px ' + PFONT.serif; c.textAlign = 'center';
  c.fillText('VOL. LXXVI          MONDAY MORNING, NOVEMBER 4, 1957          IN FOUR PARTS          DAILY, 10c', W / 2, m + 39.5);
  c.textAlign = 'left'; pRule(c, m, m + 41.3, W - m, 0.3);
  let y = m + 44;
  // the banner, the width of the page
  pFit(c, 'RUSS EXPECT TO GET DOG DOWN BY CHUTE', m, y + 30, W - 2 * m, 34, PFONT.head); y += 35;
  pRule(c, m, y, W - m, 0.3); y += 3;
  const nc = 8, gw = 2.4, cw = (W - 2 * m - gw * (nc - 1)) / nc, cx = (i) => m + i * (cw + gw), span = (a, b) => cx(b) + cw - cx(a);
  // left: the deck over her picture, three columns wide
  const pw = span(0, 2), ph = 128;
  c.font = 'bold italic 9px ' + PFONT.serif; c.textAlign = 'center'; c.fillText('Curly Still Lives in Space', cx(0) + pw / 2, y + 8); c.textAlign = 'left';
  pHalftone(c, pDog(300, Math.round(300 * ph / pw), S.seed), cx(0), y + 11, pw, ph, 0.6);
  c.lineWidth = 0.3; c.strokeRect(cx(0), y + 11, pw, ph);
  const yc = y + 11 + ph + 4;
  c.font = 'bold 2.9px ' + PFONT.head; c.fillText('SPACE PASSENGER — ', cx(0), yc + 2.6);
  pColumn(c, cx(0) + 26, yc + 0.3, pw - 26, yc + 3, 2.5, 'This is the dog Moscow says is riding', 1.2);
  pColumn(c, cx(0), yc + 3.4, pw, yc + 13, 2.5, 'inside the second Soviet satellite, from a picture sent out by the Russian news agency. She is said to weigh about 13 pounds and to be wired so that doctors on the ground can follow her heart and breathing by radio as she circles the earth.', 1.2);
  // right: the main story under its own heads, five columns
  const rx = cx(3), rw = span(3, 7);
  pFit(c, 'MOSCOW SAYS ANIMAL FARES WELL IN ORBIT', rx, y + 13, rw, 14, PFONT.head);
  c.font = 'italic 5.6px ' + PFONT.serif; c.textAlign = 'center';
  c.fillText('Half-Ton Sphere Circles Globe Every 103 Minutes; Rocket Seen as Step Toward Moon', rx + rw / 2, y + 21); c.textAlign = 'left';
  pRule(c, rx, y + 24, rx + rw, 0.25);
  for (let i = 4; i < nc; i++) pRule(c, cx(i) - gw / 2, y + 26, cx(i) - gw / 2 + 0.2, 300);
  c.font = 'bold 2.8px ' + PFONT.serif; c.fillText('MOSCOW, Nov. 3 (AP) —', rx, y + 29.5);
  // the orbit, drawn for readers: the earth, the long ellipse, the apogee marked
  const bx = cx(6), by = y + 120, bw = span(6, 7), bh = 74;
  for (let i = 3; i < nc; i++) { const top = i >= 6 ? [y + 31.5, by - 3] : [y + 31.5, y + 300]; pColumn(c, cx(i), top[0], cw, top[1], 2.45, pText(80), 1.2); if (i >= 6) pColumn(c, cx(i), by + bh + 3, cw, y + 300, 2.45, pText(40), 1.2); }
  c.fillStyle = '#e7e0cc'; c.fillRect(bx, by, bw, bh); c.fillStyle = ink; c.lineWidth = 0.35; c.strokeRect(bx, by, bw, bh);
  c.font = 'bold 3.4px ' + PFONT.head; c.textAlign = 'center'; c.fillText('HOW SECOND MOON CIRCLES', bx + bw / 2, by + 6);
  const ex = bx + bw / 2 + 6, ey = by + 40; c.beginPath(); c.arc(ex - 16, ey, 13, 0, TAU); c.stroke(); c.globalAlpha = 0.25; c.fill(); c.globalAlpha = 1;
  c.setLineDash([1.2, 0.8]); c.beginPath(); c.ellipse(ex, ey, 34, 18, 0, 0, TAU); c.stroke(); c.setLineDash([]);
  c.beginPath(); c.arc(ex + 34, ey, 1.6, 0, TAU); c.fill();
  c.font = '2.6px ' + PFONT.serif; c.fillText('EARTH', ex - 16, ey + 1); c.fillText('1,056 mi. high', ex + 30, ey - 4); c.fillText('140 mi.', ex - 30, ey + 22);
  c.font = 'italic 2.6px ' + PFONT.serif; c.fillText('Times diagram', bx + bw / 2, by + bh - 3); c.textAlign = 'left';
  // the lower deck of stories: Washington, and the local items
  y = yc + 16; pRule(c, m, y, cx(3) - gw / 2, 0.6); y += 2;
  pFit(c, 'IKE CALM OVER NEW FEAT', cx(0), y + 8, pw, 9, PFONT.head);
  c.font = 'italic 4px ' + PFONT.serif; c.fillText('Capital Asks: How Far Ahead Are Russians?', cx(0), y + 13.5);
  for (let i = 0; i < 3; i++) pColumn(c, cx(i), y + 17, cw, y + 120, 2.45, pText(60), 1.2);
  y += 122; pRule(c, m, y, W - m, 0.6); y += 2;
  pFit(c, 'SKY WATCHERS HERE TOLD WHERE TO LOOK', cx(0), y + 9, span(0, 4), 10, PFONT.head);
  c.font = 'italic 4.2px ' + PFONT.serif; c.fillText('Moonwatch Teams Will Scan Southland Sky Before Dawn', cx(0), y + 15);
  for (let i = 0; i < 5; i++) pColumn(c, cx(i), y + 19, cw, H - m - 20, 2.45, pText(60), 1.2);
  pFit(c, 'LIGHTS OVER INYO DESERT', cx(5), y + 7, span(5, 7), 7, PFONT.head);
  c.font = 'italic 3.6px ' + PFONT.serif; c.fillText('Ranger Says Glow Hung Over Canyon Rim', cx(5), y + 12);
  for (let i = 5; i < nc; i++) pColumn(c, cx(i), y + 16, cw, H - m - 20, 2.45, pText(50), 1.2);
  pRule(c, m, H - m - 17, W - m, 0.3);
  c.font = 'bold 3px ' + PFONT.head; c.fillText('INDEX TO FEATURES', m, H - m - 12.5);
  c.font = '2.6px ' + PFONT.serif; c.fillText('Amusements III 6-9 · Comics III 12 · Editorials II 4 · Financial III 8-10 · Radio-TV IV 10 · Sports IV 1-6 · Weather I 30', m, H - m - 8.5);
  pAge(c, W, H, 0.4);
};
// 6, 7: the notebook open at its last written pages: ruled, a red margin, pencil notes; the right page has a sketch
const NOTES_L = ['Nov. 6, 1957 — Coldsupper Cyn.', 'Camp at the landing 6:40 pm. Clear, cold,', 'light W wind. Truck across the road.', 'Radio: Sputnik II 9:52 pm, faint, 20 mc.',
  '11:15 — moon up over W rim, very bright', '1:30 am — nothing. Coyotes up canyon.', '2:47 — LIGHT over E reach, low, white-amber', '    no sound. steady. moved N against wind', '2:51 — went dark. not a plane. not a star.',
  '3:05 — crickets stopped, all at once', '3:12 — stars gone in the NE for 40 sec?', '    (camera open, 2 min — check neg.)', 'eclipse first contact 4:00? almanac'];
const NOTES_R = ['Sketch — as seen 2:47 am', 'bearing 75°   elev. abt. 12°', 'size: thumbnail at arm\'s length'];
PDRAW[6] = PDRAW[7] = (c, W, H, S) => {
  const right = S.kind === 7;
  c.fillStyle = '#ebe4cc'; c.fillRect(0, 0, W, H);
  c.strokeStyle = 'rgba(95,140,190,0.6)'; c.lineWidth = 0.22; for (let y = 24; y < H - 4; y += 7) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
  c.strokeStyle = 'rgba(200,80,80,0.7)'; c.lineWidth = 0.3; c.beginPath(); c.moveTo(22, 0); c.lineTo(22, H); c.stroke();
  c.fillStyle = 'rgba(38,38,44,0.95)'; c.font = '5px ' + PFONT.hand;
  const lines = right ? NOTES_R : NOTES_L;
  lines.forEach((t, i) => { c.save(); c.translate(24 + rr(-0.5, 0.5), 22.4 + i * 7 + rr(-0.3, 0.3)); c.rotate(rr(-0.012, 0.008)); c.fillText(t, 0, 0); c.restore(); });
  if (!right) { c.strokeStyle = 'rgba(55,55,62,0.8)'; c.lineWidth = 0.35; c.beginPath(); c.moveTo(24, 22.4 + 6 * 7 - 1.8); c.lineTo(24 + 52, 22.4 + 6 * 7 - 1.8); c.stroke(); }
  else {
    // the sketch: the rim line, the disc seen nearly edge-on with a low dome, rays, an arrow north, a scale note
    c.strokeStyle = 'rgba(50,50,58,0.85)'; c.lineWidth = 0.45; c.lineCap = 'round';
    const sx = W * 0.52, sy = H * 0.52;
    c.beginPath(); c.ellipse(sx, sy, 26, 6.5, -0.06, 0, TAU); c.stroke(); c.beginPath(); c.ellipse(sx, sy - 3.5, 10, 7, -0.06, PI, TAU); c.stroke();
    for (let i = 0; i < 9; i++) { const a = -0.3 + i * 0.08; c.beginPath(); c.moveTo(sx - 24 + i * 6, sy + 5.5); c.lineTo(sx - 26 + i * 6.4, sy + 12 + rr(0, 2)); c.stroke(); }
    c.beginPath(); c.moveTo(sx + 30, sy - 2); c.lineTo(sx + 48, sy - 6); c.moveTo(sx + 44, sy - 8.5); c.lineTo(sx + 48, sy - 6); c.lineTo(sx + 44, sy - 3); c.stroke();
    c.font = '4px ' + PFONT.hand; c.fillStyle = 'rgba(55,55,62,0.85)'; c.fillText('N', sx + 50, sy - 5);
    c.beginPath(); c.moveTo(10, sy + 38); for (let x = 10; x < W - 8; x += 3) c.lineTo(x, sy + 36 - 7 * pow(max(0, sin(x * 0.045 + 1)), 2) - 3 * sin(x * 0.2)); c.stroke();
    c.fillText('E rim', 14, sy + 45); c.fillText('no sound. no wind on it.', 26, sy + 60); c.fillText('ask Ranger about the old', 26, sy + 74); c.fillText('settlement — why "Coldsupper"?', 26, sy + 81);
  }
  const g = c.createLinearGradient(right ? 0 : W, 0, right ? 14 : W - 14, 0); g.addColorStop(0, 'rgba(60,50,30,0.35)'); g.addColorStop(1, 'rgba(60,50,30,0)'); c.fillStyle = g; c.fillRect(0, 0, W, H);
  pAge(c, W, H, 0.2);
};

// draw every sheet, then the texture and its mip chain (each level drawn down from the one above)
function drawPaperAtlas() {
  const A = PAPER_ATLAS, cv = new OffscreenCanvas(A, A), c = cv.getContext('2d');
  c.fillStyle = '#7a7366'; c.fillRect(0, 0, A, A);
  PAPERS.forEach((S, i) => {
    const [x, y, w, h] = S.rect, Wmm = S.h[0] * 2000, Hmm = S.h[1] * 2000;
    c.save(); c.beginPath(); c.rect(x - 3, y - 3, w + 6, h + 6); c.clip(); c.translate(x, y); c.scale(w / Wmm, h / Hmm);
    rseed(1000 + i * 13 + S.seed); PDRAW[S.kind](c, Wmm, Hmm, S);
    c.restore();
  });
  return cv;
}
function makePaperAtlas() {
  const A = PAPER_ATLAS, cv = drawPaperAtlas();
  const n = Math.log2(A) + 1, tex = device.createTexture({ size: [A, A], format: 'rgba8unorm', mipLevelCount: n, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
  let src = cv;
  for (let l = 0; l < n; l++) {
    const s = A >> l;
    if (l) { const d = new OffscreenCanvas(s, s), dc = d.getContext('2d'); dc.imageSmoothingQuality = 'high'; dc.drawImage(src, 0, 0, s, s); src = d; }
    device.queue.copyExternalImageToTexture({ source: src }, { texture: tex, mipLevel: l }, [s, s]);
  }
  return tex;
}
