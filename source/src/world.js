// ============================================================================
// world layout + procedural content generation (load-time only)
// ============================================================================

// designed rock masses: ax, az, bx, bz, radius, top, overhang, waist
const MESAS = [
  [-37, -42, -33, -22, 9, -7, 3.5, 2], [-29, -15, -33, 5, 12, -14, 3, 2], [-36, 11, -30, 27, 9, -5, 4, 2],   // west wall of the main canyon
  [30, -45, 35, -27, 9, -9, 4, 2], [37, -20, 31, -3, 11, -16, 3, 2], [32, 5, 35, 9, 7, -8, 4, 2],          // east wall
  [19, -15, 19, -15, 4.4, -6, 2, 1.5],   // pillar with a window
  [6, -88, 6, -88, 10, -34, 0, 0],       // low butte in the far basin
  [44, 6, 47, -8, 7, -17, 3, 1],
  [33, 29, 37, 12, 9, -19, -6.5, 0],     // sloped wall
  [74, 14, 74, 14, 8, -15, 3, 1],
  [-84, -34, -80, -12, 10, -7, 6, 2], [-78, -6, -83, 12, 12, -13, 5, 2], [-82, 18, -79, 32, 9, -8, 6, 2],   // west side canyon wall
  [-17, 62, -19, 78, 10, -6, 9, 3], [-21, 84, -18, 100, 11, -9, 8, 3],     // overhang cliff
  [22, 67, 24, 80, 7, -11, 6, 2],
  [-16, 122, 34, 122, 9, -27, 3, 2],
];
// vertical ring arches: cx, cy, cz, yaw, major radius, minor radius, y squash
const ARCHES = [
  [-23, -9.5, -16, 0.3, 4.2, 1.4, 1.2],
  [0, -45, -34, 0, 16.5, 2.8, 1.2],        // spans the main canyon west of camp: the moon sets through it
  [-40, -45, 44, 1.57, 10, 2.2, 1.3],
];
// carved tunnels: ax, ay, az, radius, bx, by, bz
const HOLES = [
  [19, -21, -23, 2.5, 19, -21, -7],
  [9, -37, 108, 4.2, 9, -34, 136],
];
// regions kept free of random mesas: ax, az, bx, bz, radius, softness
const CLEARS = [
  [0, -45, 0, 35, 22, 10], [0, -86, 0, -86, 46, 12], [42, 24, 74, 6, 22, 10], [72, -26, 72, -26, 26, 10],
  [-60, -36, -60, 36, 13, 8], [-60, 42, -18, 46, 12, 8], [4, 58, 8, 100, 24, 10], [-34, -74, -56, -46, 11, 8],
];
function primBuffer() {
  const a = [];
  for (const m of MESAS) a.push(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7]);
  for (const m of ARCHES) a.push(m[0], m[1], m[2], m[3], m[4], m[5], m[6], 0);
  for (const m of HOLES) a.push(m[0], m[1], m[2], m[3], m[4], m[5], m[6], 0);
  for (const m of CLEARS) a.push(m[0], m[1], m[2], m[3], m[4], m[5], 0, 0);
  return new Float32Array(a);
}

// ---------------------------------------------------------------- terrain mesh from the density grid
function buildTerrain(D) {
  const sn = surfaceNets(D, NX, NY, NZ), nv = sn.nv, gp = sn.pos;
  const smp = sampler3(D, NX, NY, NZ);
  const vb = new ArrayBuffer(nv * 16), vf = new Float32Array(vb), v8 = new Int8Array(vb);
  const wp = new Float32Array(nv * 3), wn = new Float32Array(nv * 3);
  for (let k = 0; k < nv; k++) {
    const x = gp[k * 3], y = gp[k * 3 + 1], z = gp[k * 3 + 2], e = 0.8;
    let nx = smp(x - e, y, z) - smp(x + e, y, z), ny = smp(x, y - e, z) - smp(x, y + e, z), nz = smp(x, y, z - e) - smp(x, y, z + e);
    const l = hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const X = OX + x * VS, Y = OY + y * VS, Z = OZ + z * VS;
    wp[k * 3] = vf[k * 4] = X; wp[k * 3 + 1] = vf[k * 4 + 1] = Y; wp[k * 3 + 2] = vf[k * 4 + 2] = Z;
    wn[k * 3] = nx; wn[k * 3 + 1] = ny; wn[k * 3 + 2] = nz;
    v8[k * 16 + 12] = round(nx * 127); v8[k * 16 + 13] = round(ny * 127); v8[k * 16 + 14] = round(nz * 127); v8[k * 16 + 15] = 127;
  }
  // bucket quads into the XZ culling grid
  const nq = sn.ni / 6, key = new Uint8Array(nq), cnt = new Uint32Array(CELLS * CELLS + 1);
  const lo = new Float32Array(CELLS * CELLS).fill(1e9), hi = new Float32Array(CELLS * CELLS).fill(-1e9);
  for (let q = 0; q < nq; q++) {
    const a = sn.idx[q * 6] * 3;
    const c = clamp(floor((wp[a] - OX) / CELLW), 0, CELLS - 1) + CELLS * clamp(floor((wp[a + 2] - OZ) / CELLW), 0, CELLS - 1);
    key[q] = c; cnt[c + 1]++;
    for (let j = 0; j < 6; j++) { const y = wp[sn.idx[q * 6 + j] * 3 + 1]; if (y < lo[c]) lo[c] = y; if (y > hi[c]) hi[c] = y; }
  }
  for (let c = 0; c < CELLS * CELLS; c++) cnt[c + 1] += cnt[c];
  const ib = new Uint32Array(sn.ni), fill = cnt.slice();
  for (let q = 0; q < nq; q++) { const o = fill[key[q]]++ * 6; for (let j = 0; j < 6; j++) ib[o + j] = sn.idx[q * 6 + j]; }
  return { vb, ib, nv, wp, wn, smp, start: cnt, lo, hi };
}


// ---------------------------------------------------------------- instance stores
// Camp layout, in metres from the fire (x north, z east): see meshCamp() for what stands where.
const CHAIR = [-1.6, 1.1, -0.97]; // folding chair: x, z, yaw (it faces the fire)
function makeWorld(D, T, flyPts, POSES) {
  const gi = (x, y, z) => x + NX * (y + NY * z);
  const smp = T.smp;
  const Dw = (x, y, z) => smp((x - OX) / VS, (y - OY) / VS, (z - OZ) / VS);
  const nCells = CELLS * CELLS;
  const cellOf = (x, z) => clamp(floor((x - OX) / CELLW), 0, CELLS - 1) + CELLS * clamp(floor((z - OZ) / CELLW), 0, CELLS - 1);
  const big = Array.from({ length: nCells }, () => []), small = Array.from({ length: nCells }, () => []);
  // Medium and Low keep every 2nd / 4th leaf (but every yucca stalk), made wider; the random stream is the same
  let nth = 0;
  const leaf = (L, x, y, z, len, yaw, tilt, wid, hA, type, s1, s2, bend) => { if (type === 1 || !(nth++ % THIN)) L[cellOf(x, z)].push(x, y, z, len, yaw, tilt, type === 1 ? wid : wid * (1 + LV / 2), hA, type, s1, s2, bend); };
  const solids = []; // per mesh id: arrays of 12 floats
  const props = Array.from({ length: 6 }, () => Array.from({ length: nCells }, () => []));
  const solid = (mesh, x, y, z, sc, q, mat, seed, ts = 1, bob = 0) => { (mesh > 3 && mesh < 10 ? props[mesh - 4][cellOf(x, z)] : (solids[mesh] ||= [])).push(x, y, z, sc, q[0], q[1], q[2], q[3], mat, seed, ts, bob); };
  const chunks = Array.from({ length: NCHUNK }, () => Array.from({ length: nCells }, () => []));

  // --- surface queries
  const fl = [];
  const floorsAt = (x, z) => {
    const ix = clamp(round((x - OX) / VS), 1, NX - 2), iz = clamp(round((z - OZ) / VS), 1, NZ - 2);
    fl.length = 0; let ceil = 3;
    for (let gy = NY - 2; gy >= 0; gy--) {
      const d = D[gi(ix, gy, iz)], da = D[gi(ix, gy + 1, iz)];
      if (da <= 0 && d > 0) { const y = OY + (gy + d / (d - da)) * VS; fl.push(y, min(ceil, 0) - y); } else if (da > 0 && d <= 0) ceil = OY + (gy + 0.5) * VS;
    }
    return fl;
  };
  const gy = (x, z) => { const f = floorsAt(x, z); return f.length ? f[f.length - 2] : -45; };
  const pickV = () => ((rnd() * T.nv) | 0) * 3;
  const nearFly = (x, y, z, r) => { for (const p of flyPts) if (hypot(x - p[0], z - p[2]) < r && y < p[1] + 3 && y > p[1] - 13) return true; return false; };
  const nearPose = (x, z, r = 3) => { for (const p of POSES) if (hypot(x - p[0], z - p[2]) < r) return true; return false; };
  const nearCamp = (x, z, r) => hypot(x - CAMP[0], z - CAMP[2]) < r;
  // a flat-ish ground point picked from the terrain mesh, or null
  const ground = (ny0, rCamp, rFly) => {
    const k = pickV(); if (T.wn[k + 1] < ny0) return null;
    const x = T.wp[k] + rr(-0.35, 0.35), z = T.wp[k + 2] + rr(-0.35, 0.35), y = T.wp[k + 1];
    if (hypot(x, z) > 168 || nearCamp(x, z, rCamp) || nearPose(x, z, 3) || nearFly(x, y, z, rFly)) return null;
    return [x, y, z];
  };

  // --- shrubs: sagebrush and rabbitbrush (leaf bushes), dry bunch grass
  const bush = (x, y, z, s, type) => {
    for (let j = (26 + rnd() * 26) * s | 0; j > 0; j--) {
      const a = rnd() * TAU, r = sqrt(rnd()) * 0.3 * s;
      leaf(big, x + cos(a) * r, y - 0.05, z + sin(a) * r, rr(0.3, 0.6) * s, a + rr(-0.4, 0.4), rr(0.05, 1.15), rr(0.06, 0.1) * s, 0, type, rnd(), rnd(), rr(0.38, 0.55));
    }
  };
  const tuft = (x, y, z) => {
    for (let j = 8 + rnd() * 10 | 0; j > 0; j--) leaf(small, x + rr(-0.05, 0.05), y - 0.03, z + rr(-0.05, 0.05), rr(0.15, 0.42), rnd() * TAU, rr(0.05, 0.75), rr(0.015, 0.03), 0, 5, rnd(), rnd(), rr(0.4, 0.7));
  };
  rseed(3);
  for (let i = 0; i < 170000; i++) {
    const p = ground(0.78, 11, 1.5); if (!p) continue;
    const pat = fbm(p[0] * 0.045, 3, p[2] * 0.045, 3), u = rnd();
    if (u < 0.012 + 0.03 * sstep(0.4, 0.65, pat)) bush(p[0], p[1], p[2], rr(0.6, 1.25), rnd() < 0.8 ? 2 : 7);
    else if (u < 0.05 + 0.04 * sstep(0.55, 0.3, pat)) tuft(p[0], p[1], p[2]);
  }

  // --- trees: juniper and pinyon, a trunk mesh with foliage sprays (leaves) clustered round its branch tips
  const trunks = [treeTrunk(0), treeTrunk(1)];
  const tree = (x, y, z, kind, sc = rr(0.75, 1.35)) => {
    const a = rnd() * TAU, ca = cos(a), sa = sin(a);
    solid(8 + kind, x, y - 0.1, z, sc, qAxis(0, 1, 0, a), 2, rnd(), 1, 0);
    for (const t of trunks[kind].tips) {
      const tx = (t[0] * ca + t[2] * sa) * sc, tz = (-t[0] * sa + t[2] * ca) * sc, ty = t[1] * sc, rc = t[3] * sc;
      for (let j = rc * rc * 200 + 20 | 0; j > 0; j--) {
        let dx = rr(-1, 1), dy = rr(-0.6, 1), dz = rr(-1, 1); const l = hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
        const r = rc * pow(rnd(), 0.4), py = y + ty + dy * r * 0.75;
        leaf(big, x + tx + dx * r, py, z + tz + dz * r, rr(0.16, 0.32) * (0.8 + 0.3 * rc), atan2(dz, dx) + rr(-0.5, 0.5), rr(0.2, 1.7), rr(0.055, 0.09), py - y, kind ? 4 : 0, rnd(), rnd(), rr(0.4, 0.6));
      }
    }
  };
  rseed(4);
  // a few by camp, so it does not stand in the open
  for (const t of [[-11, 7, 0, 1.2], [10, 14, 1, 1.1], [-8, -13, 0, 1.3], [-14, -4, 0, 0.9], [14, 11, 0, 0.8]]) { const x = CAMP[0] + t[0], z = CAMP[2] + t[1]; tree(x, gy(x, z), z, t[2], t[3]); }
  const tocc = new Set();
  for (let i = 0, made = 0; i < 80000 && made < 340; i++) {
    const p = ground(0.75, 13, 3.5); if (!p) continue;
    if (rnd() > 0.12 + 0.6 * sstep(0.45, 0.65, fbm(p[0] * 0.03, 8, p[2] * 0.03, 3))) continue;
    const key = floor(p[0] / 5) * 4096 + floor(p[2] / 5); if (tocc.has(key)) continue;
    tocc.add(key); tree(p[0], p[1], p[2], rnd() < 0.65 ? 0 : 1); made++;
  }

  // --- yucca (a rosette of stiff blades, often with last summer's dry flower stalk) and cacti
  const yucca = (x, y, z) => {
    const s = rr(0.7, 1.2);
    for (let j = 26 + rnd() * 20 | 0; j > 0; j--) leaf(big, x + rr(-0.06, 0.06), y - 0.02, z + rr(-0.06, 0.06), rr(0.4, 0.8) * s, rnd() * TAU, pow(rnd(), 0.7) * 1.35, rr(0.035, 0.05) * s, 0, 3, rnd(), rnd(), rr(0.3, 0.36));
    if (rnd() < 0.55) {
      const h = rr(1.4, 2.4) * s, ya = rnd() * TAU, ln = rr(0, 0.12);
      leaf(big, x, y + 0.1, z, h, ya, ln, 0.03, 0, 1, rnd(), rnd(), 0.3);
      const tx = x + cos(ya) * sin(ln) * h, tz = z + sin(ya) * sin(ln) * h;
      for (let j = 0; j < 7; j++) { const f = rr(0.7, 0.97); leaf(big, x + (tx - x) * f, y + 0.1 + h * f, z + (tz - z) * f, rr(0.08, 0.2), rnd() * TAU, rr(0.6, 1.4), 0.025, h, 1, rnd(), rnd(), 0.45); }
    }
  };
  rseed(5);
  for (let i = 0; i < 90000; i++) {
    const p = ground(0.7, 9, 2); if (!p) continue;
    const u = rnd(), pat = fbm(p[0] * 0.06, 5, p[2] * 0.06, 2), q = qAxis(0, 1, 0, rnd() * TAU);
    if (u < 0.006) yucca(p[0], p[1], p[2]);
    else if (u < 0.006 + 0.012 * pat) solid(6 + (rnd() < 0.5), p[0], p[1] - 0.04, p[2], rr(0.7, 1.3), q, 2, rnd(), 1, 0);
    else if (u < 0.008 + 0.017 * pat) solid(rnd() < 0.5 ? 4 : 5, p[0], p[1] - 0.04, p[2], rr(0.6, 1.4), q, 2, rnd(), 1, 0);
  }

  // --- rocks: scattered ground rocks, talus and boulders on the slopes, pebbles
  rseed(9);
  for (let i = 0; i < 2600; i++) {
    const k = pickV(); if (T.wn[k + 1] < 0.7 || hypot(T.wp[k], T.wp[k + 2]) > 170 || nearCamp(T.wp[k], T.wp[k + 2], 12) || nearFly(T.wp[k], T.wp[k + 1], T.wp[k + 2], 6)) continue;
    const sc = rr(0.25, 1.3) * (rnd() < 0.1 ? 2 : 1);
    solid(rnd() * 4 | 0, T.wp[k], T.wp[k + 1] + sc * 0.2, T.wp[k + 2], sc, qRand(), 1, rnd(), 1, 0);
  }
  rseed(10);
  for (let i = 0; i < 60000; i++) {
    const k = pickV(), x = T.wp[k], y = T.wp[k + 1], z = T.wp[k + 2], ny = T.wn[k + 1];
    if (hypot(x, z) > 172 || y > -3 || (ny > 0.8 && rnd() < 0.6) || nearFly(x, y, z, 3.5) || nearCamp(x, z, 13)) continue;
    const sc = (0.35 + 2.1 * pow(rnd(), 2.6)) * (ny > 0.8 ? 0.5 : 1), q = qRand();
    chunks[(sc > 1.15 ? 3 : 0) + (rnd() * 3 | 0)][cellOf(x, z)].push(x - T.wn[k] * sc * 0.3, y - ny * sc * 0.3, z - T.wn[k + 2] * sc * 0.3, sc, q[0], q[1], q[2], q[3], 1, rnd(), sc > 1.15 ? 0 : 96, 0);
  }
  rseed(11);
  for (let i = 0; i < 170000; i++) {
    const k = pickV(), x = T.wp[k] + rr(-0.4, 0.4), z = T.wp[k + 2] + rr(-0.4, 0.4), y = T.wp[k + 1];
    if (T.wn[k + 1] < 0.8 || hypot(x, z) > 170 || nearFly(x, y, z, 1.3) || nearCamp(x, z, 7)) continue;
    const sc = 0.05 + 0.3 * pow(rnd(), 2), q = qRand();
    nth++ % THIN || chunks[6][cellOf(x, z)].push(x, y - sc * 0.25, z, sc, q[0], q[1], q[2], q[3], 1, rnd(), 44, 0);
  }

  // --- the camp (one mesh) and the folding chair (its own instance, so it can be moved later)
  solid(10, CAMP[0], CAMP[1], CAMP[2], 1, [0, 0, 0, 1], 2, 0, 1, 0);
  solid(12, CAMP[0] + CHAIR[0], CAMP[1], CAMP[2] + CHAIR[1], 1, qAxis(0, 1, 0, CHAIR[2]), 2, 0, 1, 0);
  // campfire: flame cards (x, y, z, half width | seed, 0, height) and embers (seed, 1)
  const fire = [];
  rseed(12);
  for (let i = 0; i < 7; i++) { const a = rnd() * TAU, r = rr(0, 0.22); fire.push(CAMP[0] + cos(a) * r, CAMP[1] + 0.04, CAMP[2] + sin(a) * r, rr(0.16, 0.26), rnd(), 0, rr(0.4, 0.75), 0); }
  for (let i = 0; i < 36; i++) fire.push(CAMP[0] + rr(-0.2, 0.2), CAMP[1] + 0.15, CAMP[2] + rr(-0.2, 0.2), 0, rnd(), 1, 0, 0);

  // --- pack leaves (36 bytes: 8 floats + 4 unorm8), sorted by culling cell
  const pack = (L, step = 1, wm = 1) => {
    let n = 0; const start = new Uint32Array(nCells + 1);
    for (let c = 0; c < nCells; c++) { start[c] = n; n += Math.ceil(L[c].length / 12 / step); }
    start[nCells] = n;
    const buf = new ArrayBuffer(n * 36), f = new Float32Array(buf), u8 = new Uint8Array(buf), lo = new Float32Array(nCells).fill(1e9), hi = new Float32Array(nCells).fill(-1e9);
    let k = 0;
    for (let c = 0; c < nCells; c++) { const a = L[c]; for (let i = 0; i < a.length; i += 12 * step, k++) {
      for (let j = 0; j < 8; j++) f[k * 9 + j] = a[i + j];
      f[k * 9 + 6] *= wm;
      u8[k * 36 + 32] = a[i + 8]; u8[k * 36 + 33] = a[i + 9] * 255; u8[k * 36 + 34] = a[i + 10] * 255; u8[k * 36 + 35] = a[i + 11] * 255;
      const y = a[i + 1], l = a[i + 3]; if (y - l < lo[c]) lo[c] = y - l; if (y + l > hi[c]) hi[c] = y + l;
    } }
    return { buf, n, start, lo, hi };
  };

  // --- half-res volume: r = openness, g = how much of the sky a point sees (blurred top-down light)
  const hx = NX / 2, hy = NY / 2, hz = NZ / 2, volD = new Uint8Array(hx * hy * hz * 2);
  let Lp = new Float32Array(hx * hz).fill(1), Ln = new Float32Array(hx * hz), tmp = new Float32Array(hx * hz);
  for (let y = hy - 1; y >= 0; y--) {
    for (let z = 0; z < hz; z++) for (let x = 0; x < hx; x++) { const i = x + hx * z; tmp[i] = (Lp[x > 0 ? i - 1 : i] + 2 * Lp[i] + Lp[x < hx - 1 ? i + 1 : i]) * 0.25; }
    for (let z = 0; z < hz; z++) for (let x = 0; x < hx; x++) {
      const i = x + hx * z, b = (tmp[z > 0 ? i - hx : i] + 2 * tmp[i] + tmp[z < hz - 1 ? i + hx : i]) * 0.25;
      const g0 = gi(x * 2, y * 2, z * 2);
      const d = (D[g0] + D[g0 + 1] + D[g0 + NX] + D[g0 + NX + 1] + D[g0 + NX * NY] + D[g0 + NX * NY + 1] + D[g0 + NX * NY + NX] + D[g0 + NX * NY + NX + 1]) * 0.125;
      const o = x + hx * (y + hy * z);
      Ln[i] = b * clamp(0.5 - d / 1.5, 0, 1);
      volD[o * 2] = clamp(0.5 - d / 12, 0, 1) * 255; volD[o * 2 + 1] = min(1, b) * 255;
    }
    const t = Lp; Lp = Ln; Ln = t;
  }

  // --- ground map: a = sand (vs. bare rock) on the flats
  const gm = new Uint8Array(512 * 512 * 4);
  for (let j = 0; j < 512; j++) for (let i = 0; i < 512; i++) {
    const x = (i + 0.5) / 512 * 384 - 192, z = (j + 0.5) / 512 * 384 - 192;
    gm[(i + 512 * j) * 4 + 3] = sstep(0.38, 0.6, fbm(x * 0.04, 3, z * 0.04, 3)) * 255;
  }

  const sol = { data: [], ranges: [] }; let si = 0;
  for (let m = 0; m < 14; m++) { const a = solids[m] || []; sol.ranges.push([si, a.length / 12]); si += a.length / 12; for (let i = 0; i < a.length; i++) sol.data.push(a[i]); }
  const packC = (L) => {
    let n = 0; const start = new Uint32Array(nCells + 1);
    for (let c = 0; c < nCells; c++) { start[c] = n; n += L[c].length / 12; }
    start[nCells] = n;
    const data = new Float32Array(n * 12), lo = new Float32Array(nCells).fill(1e9), hi = new Float32Array(nCells).fill(-1e9);
    let k = 0;
    for (let c = 0; c < nCells; c++) { const a = L[c]; for (let i = 0; i < a.length; i += 12) { for (let j = 0; j < 12; j++) data[k++] = a[i + j]; lo[c] = min(lo[c], a[i + 1] - 3); hi[c] = max(hi[c], a[i + 1] + 5); } }
    return { data, n, start, lo, hi };
  };
  return { gy, trunks, chunks: chunks.map(packC), props: props.map(packC), big: pack(big), bigF: pack(big, 2, 1.5), small: pack(small), solids: { data: new Float32Array(sol.data), ranges: sol.ranges }, volD, gm, fire: new Float32Array(fire) };
}
const fract = (x) => x - floor(x);

// ---------------------------------------------------------------- procedural meshes
function meshChunk(sd, sub = 2, det = sub > 2) {
  if (LV > 1 && sub > 1) sub--; // Low: a quarter of the triangles
  rseed(100 + sd);
  const pl = []; for (let i = 0; i < 4; i++) { const q = qRand(); pl.push([q[0], q[1], q[2], rr(0.8, 0.98)]); const l = hypot(q[0], q[1], q[2]) || 1; pl[i][0] /= l; pl[i][1] /= l; pl[i][2] /= l; }
  return icosphere(sub, (x, y, z) => {
    let r = 1 + (fbm(x * 1.6 + sd, y * 1.6, z * 1.6, 2) - 0.5) * 0.9 + (det ? (fbm(x * 4 + sd, y * 4, z * 4, 2) - 0.5) * 0.25 : 0);
    let px = x * r, py = y * r * 0.8, pz = z * r;
    for (const p of pl) { const d = px * p[0] + py * p[1] + pz * p[2] - p[3]; if (d > 0) { px -= p[0] * d; py -= p[1] * d; pz -= p[2] * d; } }
    return [px, py, pz];
  });
}

// ---------------------------------------------------------------- shape helpers for the hand-built objects
// Every helper adds to mesh m with the current part id (m.part, which picks the material: see prop() in shaders.js).
const P = (m, id) => { m.part = id; return m; };
// give every vertex already in m the part id (for meshes made by icosphere())
const tag = (m, id) => { m.aux.fill(id / 127); return m; };
const box = (m, x0, y0, z0, x1, y1, z1) => {
  const f = (...c) => { const i = c.map((p) => m.v(...p)); m.quad(i[0], i[1], i[2], i[3]); };
  f([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]); f([x0, y0, z1], [x0, y1, z1], [x1, y1, z1], [x1, y0, z1]);
  f([x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]); f([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]);
  f([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]); f([x0, y0, z0], [x0, y0, z1], [x1, y0, z1], [x1, y0, z0]);
};
// flat disc facing along n
const disc = (m, c, n, r, sides = 12) => {
  const l = hypot(...n), nx = n[0] / l, ny = n[1] / l, nz = n[2] / l, h = abs(ny) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let ux = h[1] * nz - h[2] * ny, uy = h[2] * nx - h[0] * nz, uz = h[0] * ny - h[1] * nx; const ul = hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
  const wx = ny * uz - nz * uy, wy = nz * ux - nx * uz, wz = nx * uy - ny * ux;
  const o = m.v(...c), ring = [];
  for (let s = 0; s < sides; s++) { const a = s / sides * TAU; ring.push(m.v(c[0] + (ux * cos(a) + wx * sin(a)) * r, c[1] + (uy * cos(a) + wy * sin(a)) * r, c[2] + (uz * cos(a) + wz * sin(a)) * r)); }
  for (let s = 0; s < sides; s++) m.tri(o, ring[s], ring[(s + 1) % sides]);
};
// cylinder from a to b, with flat caps
const cyl = (m, a, b, r, sides = 12, caps = true) => {
  m.tube([a, b], r, sides, false);
  if (caps) { const n = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; disc(m, a, n, r, sides); disc(m, b, n, r, sides); }
};
// loft along z through rounded-rectangle sections [z, cx, cy, half width, half height, roundness (2 ellipse .. 8 boxy)]
const loft = (m, secs, n = 20) => {
  const rings = secs.map(([z, cx, cy, w, h, e]) => {
    const r = [];
    for (let k = 0; k < n; k++) { const a = k / n * TAU, c = cos(a), s = sin(a); r.push(m.v(cx + w * Math.sign(c) * pow(abs(c), 2 / e), cy + h * Math.sign(s) * pow(abs(s), 2 / e), z)); }
    return r;
  });
  for (let j = 0; j < rings.length - 1; j++) for (let k = 0; k < n; k++) { const k2 = (k + 1) % n; m.quad(rings[j][k], rings[j + 1][k], rings[j + 1][k2], rings[j][k2]); }
  for (const j of [0, rings.length - 1]) { const [z, cx, cy] = secs[j], o = m.v(cx, cy, z); for (let k = 0; k < n; k++) m.tri(o, rings[j][k], rings[j][(k + 1) % n]); }
};
// lathe round the y axis through [radius, height] points, optionally ribbed
const lathe = (m, prof, seg, ox = 0, oy = 0, oz = 0, ribs = 0, ra = 0) => {
  const rings = prof.map(([r, h]) => { const ring = []; for (let s = 0; s < seg; s++) { const a = s / seg * TAU, rl = r * (1 + ra * cos(ribs * a)); ring.push(m.v(ox + cos(a) * rl, oy + h, oz + sin(a) * rl)); } return ring; });
  for (let k = 0; k < rings.length - 1; k++) for (let s = 0; s < seg; s++) { const s2 = (s + 1) % seg; m.quad(rings[k][s], rings[k + 1][s], rings[k + 1][s2], rings[k][s2]); }
};
// copy mesh b into a: scaled by s (number or [x, y, z]), turned by yaw round y, then moved to x, y, z; b's part ids stay
const put = (a, b, x, y, z, yaw = 0, s = 1) => {
  const n0 = a.p.length / 3, c = cos(yaw), sn = sin(yaw), [sx, sy, sz] = typeof s === 'number' ? [s, s, s] : s;
  for (let k = 0; k < b.p.length; k += 3) { const px = b.p[k] * sx, pz = b.p[k + 2] * sz; a.p.push(x + px * c + pz * sn, y + b.p[k + 1] * sy, z - px * sn + pz * c); }
  for (const v of b.aux) a.aux.push(v);
  for (const i of b.i) a.i.push(i + n0);
};
// a lumpy stone of radius ~1
const stone = (seed) => { rseed(300 + seed); const k = rr(0.6, 0.85); return tag(icosphere(1, (x, y, z) => { const r = 0.8 + 0.35 * fbm(x * 2 + seed, y * 2, z * 2, 2); return [x * r, y * r * k, z * r]; }), 13); };

// ---------------------------------------------------------------- plants
// juniper (0: low, twisted, several stems, a dead silver branch) or pinyon (1: one straighter trunk, rounded crown)
// returns the trunk mesh and the foliage clumps [x, y, z, radius] it carries
function treeTrunk(kind) {
  rseed(400 + kind);
  const m = P(new Mesh(), kind ? 66 : 61), tips = [];
  const branch = (p, d, r, len, depth) => {
    const pts = [p]; let q = p;
    for (let i = 0; i < 4; i++) {
      d = [d[0] + rr(-0.35, 0.35), d[1] + rr(-0.1, 0.25), d[2] + rr(-0.35, 0.35)]; const l = hypot(...d); d = d.map((v) => v / l);
      q = [q[0] + d[0] * len / 4, q[1] + d[1] * len / 4, q[2] + d[2] * len / 4]; pts.push(q);
    }
    m.tube(pts, (k) => r * (1 - 0.17 * k), 7, true);
    if (depth) for (let i = depth > 1 ? 3 : 2; i > 0; i--) branch(pts[2 + (rnd() * 2 | 0)], [d[0] + rr(-0.9, 0.9), d[1] + rr(-0.2, 0.4), d[2] + rr(-0.9, 0.9)], r * 0.55, len * rr(0.45, 0.7), depth - 1);
    else tips.push([q[0], q[1], q[2], rr(0.6, 0.95) * (kind ? 1.15 : 1)], [pts[2][0], pts[2][1], pts[2][2], rr(0.45, 0.7)]);
    return pts;
  };
  if (kind) {
    const t = branch([0, 0, 0], [rr(-0.1, 0.1), 1, rr(-0.1, 0.1)], 0.13, 2.0, 2);
    tips.push([t[4][0], t[4][1] + 0.3, t[4][2], 0.9], [t[3][0], t[3][1], t[3][2], 0.85]);
  } else {
    for (let s = 0; s < 3; s++) { const a = s * 2.1 + rr(-0.4, 0.4); branch([cos(a) * 0.08, 0, sin(a) * 0.08], [cos(a) * 0.45, 1, sin(a) * 0.45], 0.1, rr(1.2, 1.8), 1); }
    P(m, 62); branch([0.05, 0.3, 0], [0.9, 0.5, 0.2], 0.04, 1.1, 0); tips.pop(); tips.pop(); // the dead branch carries no foliage
  }
  return { m, tips };
}
// barrel cactus
function meshBarrel() { const m = P(new Mesh(), 60); lathe(m, [[0, 0], [0.16, 0], [0.2, 0.1], [0.21, 0.3], [0.19, 0.45], [0.13, 0.55], [0.05, 0.6], [0, 0.61]], 36, 0, 0, 0, 18, 0.09); return m; }
// hedgehog cactus: a clump of small ribbed stems
function meshHedgehog() {
  rseed(410); const m = P(new Mesh(), 60);
  for (let i = 0; i < 7; i++) { const a = rnd() * TAU, r = rr(0, 0.12), h = rr(0.12, 0.3), w = rr(0.045, 0.07); lathe(m, [[0, -0.02], [w, 0], [w * 1.05, h * 0.6], [w * 0.7, h * 0.95], [0, h]], 16, cos(a) * r, 0, sin(a) * r, 8, 0.12); }
  return m;
}
// prickly pear: flat pads growing from the edges of older pads, a few red-purple fruits on top
function meshPear(seed) {
  rseed(420 + seed); const m = new Mesh(), pad = tag(icosphere(2), 63), fruit = tag(icosphere(1), 65);
  const grow = (x, y, z, yaw, lean, depth) => {
    const s = rr(0.8, 1.1), h = 0.17 * s;
    const n0 = m.p.length / 3; put(m, pad, 0, 0, 0, 0, [0.13 * s, h, 0.035]);
    // tip the pad (round its own x axis), then turn and move it so its base sits at x, y, z
    for (let k = n0 * 3; k < m.p.length; k += 3) {
      const px = m.p[k], py = m.p[k + 1] + h, pz = m.p[k + 2], c = cos(lean), sn = sin(lean);
      const qy = py * c - pz * sn, qz = py * sn + pz * c, cy = cos(yaw), sy = sin(yaw);
      m.p[k] = x + px * cy + qz * sy; m.p[k + 1] = y + qy; m.p[k + 2] = z - px * sy + qz * cy;
    }
    const tx = x + sin(lean) * 2 * h * sin(yaw), ty = y + cos(lean) * 2 * h, tz = z + sin(lean) * 2 * h * cos(yaw);
    if (depth) for (let i = 1 + (rnd() < 0.6); i > 0; i--) grow(tx + rr(-0.06, 0.06), ty - 0.04, tz + rr(-0.06, 0.06), yaw + rr(-1, 1), lean + rr(-0.5, 0.5), depth - 1);
    else if (rnd() < 0.7) for (let i = 1 + rnd() * 3 | 0; i > 0; i--) put(m, fruit, tx + rr(-0.06, 0.06), ty - 0.01, tz + rr(-0.03, 0.03), 0, 0.025);
  };
  for (let i = 0; i < 3; i++) grow(rr(-0.15, 0.15), -0.03, rr(-0.15, 0.15), rnd() * TAU, rr(-0.5, 0.5), 2);
  return m;
}

// ---------------------------------------------------------------- the camp
// 1950s pickup, nose to -z, ground at y = 0: rounded fenders, two-tone cream over turquoise, whitewall tyres
function meshTruck() {
  const m = new Mesh();
  P(m, 21); box(m, -0.55, 0.3, -2.2, 0.55, 0.52, 2.2);
  P(m, 2);
  for (const s of [-1, 1]) {
    loft(m, [[-2.42, s * 0.7, 0.66, 0.06, 0.06, 2.4], [-2.36, s * 0.7, 0.7, 0.17, 0.2, 2.4], [-2.15, s * 0.71, 0.73, 0.21, 0.3, 2.4], [-1.75, s * 0.72, 0.74, 0.22, 0.34, 2.4],
      [-1.35, s * 0.72, 0.72, 0.22, 0.33, 2.4], [-1.0, s * 0.73, 0.66, 0.21, 0.26, 2.4], [-0.75, s * 0.74, 0.58, 0.18, 0.16, 2.4], [-0.62, s * 0.74, 0.53, 0.1, 0.07, 2.4]], 18);
    loft(m, [[0.72, s * 0.8, 0.62, 0.06, 0.06, 2.4], [0.82, s * 0.8, 0.64, 0.16, 0.22, 2.4], [1.1, s * 0.8, 0.66, 0.17, 0.32, 2.4], [1.6, s * 0.8, 0.66, 0.17, 0.32, 2.4],
      [1.9, s * 0.8, 0.64, 0.16, 0.24, 2.4], [2.05, s * 0.8, 0.6, 0.08, 0.08, 2.4]], 16);
    P(m, 21); box(m, s * 0.66, 0.48, -0.66, s * 0.95, 0.52, 0.74); P(m, 2); // running board
    P(m, 12); box(m, s * 0.74, 0.78, 2.05, s * 0.86, 0.92, 2.09); P(m, 2); // tail light
  }
  loft(m, [[-2.38, 0, 0.92, 0.48, 0.1, 3], [-2.2, 0, 0.98, 0.52, 0.15, 3], [-1.6, 0, 1.02, 0.55, 0.18, 3], [-0.86, 0, 1.06, 0.56, 0.2, 3]], 20); // hood
  box(m, -0.5, 0.42, -2.38, 0.5, 0.88, -0.85);
  loft(m, [[-0.9, 0, 1.06, 0.87, 0.45, 6], [-0.6, 0, 1.06, 0.88, 0.46, 6], [0.3, 0, 1.06, 0.88, 0.46, 6], [0.56, 0, 1.06, 0.86, 0.45, 6]], 24); // cab, lower
  P(m, 1);
  loft(m, [[-0.78, 0, 1.6, 0.78, 0.12, 4], [-0.68, 0, 1.66, 0.8, 0.22, 4.5], [0.3, 0, 1.66, 0.8, 0.22, 4.5], [0.5, 0, 1.62, 0.78, 0.17, 4.5], [0.55, 0, 1.6, 0.7, 0.08, 4]], 24); // cab, upper
  P(m, 6);
  const glass = (pts) => { const i = pts.map((p) => m.v(...p)); m.quad(i[0], i[1], i[2], i[3]); };
  glass([[-0.7, 1.5, -0.73], [0.7, 1.5, -0.73], [0.66, 1.79, -0.69], [-0.66, 1.79, -0.69]]);
  for (const s of [-1, 1]) glass([[s * 0.805, 1.48, -0.62], [s * 0.805, 1.48, 0.32], [s * 0.805, 1.78, 0.28], [s * 0.805, 1.78, -0.56]]);
  glass([[-0.45, 1.5, 0.565], [0.45, 1.5, 0.565], [0.45, 1.74, 0.565], [-0.45, 1.74, 0.565]]);
  P(m, 9); box(m, -0.62, 0.78, 0.62, 0.62, 0.84, 2.36); // bed floor
  P(m, 2);
  box(m, -0.68, 0.84, 0.62, -0.62, 1.3, 2.36); box(m, 0.62, 0.84, 0.62, 0.68, 1.3, 2.36); box(m, -0.68, 0.84, 0.6, 0.68, 1.3, 0.66); box(m, -0.68, 0.82, 2.32, 0.68, 1.3, 2.38);
  P(m, 3);
  for (let y = 0.5; y < 0.86; y += 0.09) box(m, -0.46, y, -2.45, 0.46, y + 0.045, -2.38); // grille bars
  box(m, -0.98, 0.36, -2.62, 0.98, 0.5, -2.5); box(m, -0.98, 0.38, 2.38, 0.98, 0.5, 2.48); // bumpers
  cyl(m, [0, 0.48, 2.5], [0, 0.48, 2.64], 0.035, 8); // hitch
  for (const s of [-1, 1]) {
    P(m, 3); cyl(m, [s * 0.71, 0.84, -2.36], [s * 0.71, 0.84, -2.45], 0.115, 16); P(m, 22); disc(m, [s * 0.71, 0.84, -2.452], [0, 0, -1], 0.095, 16);
    P(m, 3); cyl(m, [s * 0.88, 1.5, -0.7], [s * 1.05, 1.62, -0.72], 0.012, 4); box(m, s * 1.02, 1.56, -0.74, s * 1.1, 1.68, -0.72); // mirror
    for (const z of [-1.62, 1.38]) {
      P(m, 4); cyl(m, [s * 0.64, 0.38, z], [s * 0.88, 0.38, z], 0.38, 22);
      P(m, 5); disc(m, [s * 0.885, 0.38, z], [s, 0, 0], 0.29, 22);
      P(m, 3); cyl(m, [s * 0.885, 0.38, z], [s * 0.91, 0.38, z], 0.17, 16);
    }
  }
  // canvas water bag hanging from the front bumper
  P(m, 17); loft(m, [[-2.67, 0.42, 0.3, 0.02, 0.03, 2], [-2.66, 0.42, 0.22, 0.13, 0.17, 3], [-2.6, 0.42, 0.22, 0.14, 0.18, 3], [-2.585, 0.42, 0.3, 0.02, 0.03, 2]], 14);
  P(m, 18); cyl(m, [0.36, 0.5, -2.63], [0.42, 0.42, -2.63], 0.008, 4, false); cyl(m, [0.48, 0.5, -2.63], [0.42, 0.42, -2.63], 0.008, 4, false);
  return m;
}
// 1950s travel trailer: rounded polished aluminium body, wraparound front window, nose (and hitch) to -z
function meshTrailer() {
  const m = new Mesh(), L = 6.4, N = 30;
  const sec = (t) => { const f = pow(max(1 - pow(abs(t), 5), 0), 0.22), h = pow(max(1 - pow(abs(t), 4), 0), 0.3); return [(t * 0.5 + 0.5) * L, 1.15 * f, 1.05 * h]; };
  const secs = []; for (let k = 0; k <= N; k++) { const [z, w, h] = sec(k / N * 2 - 1); secs.push([z, 0, 1.52, max(w, 0.01), max(h, 0.01), 2.7]); }
  P(m, 7); loft(m, secs, 32);
  // a point on the skin at (t along the body, angle round it), pushed out by off
  const sp = (t, a, off) => { const [z, w, h] = sec(t), c = cos(a), s = sin(a); const x = (w + off) * Math.sign(c) * pow(abs(c), 2 / 2.7), y = 1.52 + (h + off) * Math.sign(s) * pow(abs(s), 2 / 2.7); return [x, y, z]; };
  const patch = (t0, t1, a0, a1, off, nt = 4, na = 4) => {
    const g = []; for (let i = 0; i <= nt; i++) { const r = []; for (let j = 0; j <= na; j++) r.push(m.v(...sp(mix(t0, t1, i / nt), mix(a0, a1, j / na), off))); g.push(r); }
    for (let i = 0; i < nt; i++) for (let j = 0; j < na; j++) m.quad(g[i][j], g[i + 1][j], g[i + 1][j + 1], g[i][j + 1]);
  };
  P(m, 6);
  for (const [t0, t1] of [[-0.6, -0.25], [0.2, 0.55]]) { patch(t0, t1, 0.12, 0.45, 0.012); patch(t0, t1, PI - 0.45, PI - 0.12, 0.012); }
  patch(-0.88, -0.76, 0.15, PI - 0.15, 0.012, 2, 12); // wraparound front window
  patch(0.86, 0.92, 1.2, PI - 1.2, 0.012, 2, 3);
  P(m, 3); patch(-0.97, 0.97, -0.03, 0.03, 0.016, 24, 1); patch(-0.97, 0.97, PI - 0.03, PI + 0.03, 0.016, 24, 1); // chrome belt line
  P(m, 7); patch(-0.12, 0.08, PI - 0.55, PI + 0.95, 0.02, 3, 6); // door (on the camp side)
  P(m, 21); box(m, -0.95, 0.3, 0.5, 0.95, 0.5, L - 0.6);
  for (const s of [-1, 1]) { P(m, 4); cyl(m, [s * 0.8, 0.34, L * 0.55], [s * 1.02, 0.34, L * 0.55], 0.34, 20); P(m, 3); cyl(m, [s * 1.02, 0.34, L * 0.55], [s * 1.04, 0.34, L * 0.55], 0.15, 14); }
  P(m, 21); for (const s of [-1, 1]) m.sweep([[s * 0.7, 0.42, 0.6], [0, 0.48, -1.25]], 0.08, 0.1); // tongue
  cyl(m, [0, 0.48, -1.2], [0, 0.48, -1.32], 0.05, 8); cyl(m, [0, 0.0, -0.8], [0, 0.55, -0.8], 0.035, 8); // coupler and jack
  P(m, 12); for (const s of [-1, 1]) box(m, s * 0.55, 0.75, L - 0.08, s * 0.7, 0.85, L);
  return m;
}
// white canvas wall tent, door to -z, flaps open (one rolled up, one hanging out), ground cloth, poles, guy ropes
function meshTent() {
  rseed(430);
  const m = new Mesh(), W = 1.5, D = 1.8, HW = 1.3, HR = 2.35;
  const roofY = (x) => HW + (HR - HW) * (1 - abs(x) / W);
  const grid = (f, nu, nv, skip) => {
    const g = []; for (let i = 0; i <= nu; i++) { const r = []; for (let j = 0; j <= nv; j++) r.push(m.v(...f(i / nu, j / nv))); g.push(r); }
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) if (!skip || !skip((i + 0.5) / nu, (j + 0.5) / nv)) m.quad(g[i][j], g[i + 1][j], g[i + 1][j + 1], g[i][j + 1]);
  };
  const sag = (u, v) => 0.04 * sin(PI * u) * sin(PI * v);
  P(m, 8);
  for (const s of [-1, 1]) {
    const x = (u) => -W + 2 * W * u;
    if (s > 0) grid((u, v) => [x(u), v * roofY(x(u)), D - sag(u, v) * 0.5], 12, 10); // back wall
    else { // front wall: two panels beside the door and the gable above it
      for (const k of [-1, 1]) grid((u, v) => { const xx = k * mix(0.52, W, u); return [xx, v * roofY(xx), -D + sag(u, v) * 0.3]; }, 4, 10);
      grid((u, v) => { const xx = mix(-0.52, 0.52, u); return [xx, mix(1.86, roofY(xx), v), -D]; }, 4, 2);
    }
    grid((u, v) => [s * (W - sag(u, v)), v * HW, -D + 2 * D * u], 12, 6); // side walls
    grid((u, v) => { const z = -D - 0.12 + (2 * D + 0.24) * u, x = s * mix(W + 0.1, 0, v); return [x, mix(HW - 0.06, HR, v) - 0.06 * sin(PI * v) * (0.5 + 0.5 * sin(PI * 2 * u) ** 2), z]; }, 14, 6); // roof
  }
  // door flaps: the left one rolled up beside the door, the right one hanging open
  m.tube([[-0.62, 0.15, -D - 0.06], [-0.6, 1.0, -D - 0.07], [-0.6, 1.86, -D - 0.06]], 0.065, 8, true);
  grid((u, v) => { const a = 0.55, r = 0.56 * u; return [0.52 + r * cos(a), 0.05 + v * 1.82 + 0.03 * sin(u * 5 + v * 3), -D - r * sin(a) - 0.02 * sin(v * 7)]; }, 4, 8);
  P(m, 24); box(m, -W + 0.05, 0, -D + 0.05, W - 0.05, 0.012, D - 0.05);
  P(m, 10);
  cyl(m, [0, 0, D - 0.06], [0, HR + 0.12, D - 0.06], 0.025, 8); // back pole (the front of the ridge is held by the front rope)
  cyl(m, [0, HR - 0.02, -D + 0.06], [0, HR - 0.02, D - 0.06], 0.025, 8);
  // guy ropes to stakes: three a side from the eaves, one at each end from the ridge
  const rope = (a, b) => { P(m, 18); cyl(m, a, b, 0.007, 4, false); P(m, 9); box(m, b[0] - 0.02, -0.05, b[2] - 0.02, b[0] + 0.02, 0.18, b[2] + 0.02); };
  for (const s of [-1, 1]) { for (const z of [-D, 0, D]) rope([s * (W + 0.1), HW - 0.06, z], [s * (W + 1.0), 0.04, z * 1.1]); if (s > 0) rope([0, HR + 0.1, D + 0.1], [0, 0.04, D + 1.3]); }
  return m;
}
// the campfire: a ring of stones, a bed of embers and ash, low logs burning through, a coffee pot on a stone
function meshFire() {
  rseed(440);
  const m = new Mesh();
  for (let i = 0; i < 12; i++) { const a = i / 12 * TAU + rr(-0.1, 0.1), r = rr(0.58, 0.68); put(m, stone(i), cos(a) * r, 0.04, sin(a) * r, rnd() * TAU, rr(0.13, 0.2)); }
  P(m, 16); lathe(m, [[0, 0.012], [0.55, 0.008], [0.6, 0]], 20);
  P(m, 15); lathe(m, [[0, 0.07], [0.2, 0.06], [0.34, 0.03], [0.4, 0.01]], 20);
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * TAU + rr(-0.3, 0.3), c = cos(a), s = sin(a), r = rr(0.055, 0.075), l = rr(0.55, 0.75), y = 0.06 + i % 2 * 0.07;
    P(m, 15); cyl(m, [c * 0.06, y + 0.03, s * 0.06], [c * 0.3, y, s * 0.3], r, 8);
    P(m, 14); cyl(m, [c * 0.3, y, s * 0.3], [c * (0.3 + l), y - 0.04, s * (0.3 + l)], r, 8);
  }
  P(m, 20);
  const px = 0.62, pz = 0.18, py = 0.16;
  lathe(m, [[0, 0], [0.07, 0], [0.078, 0.05], [0.062, 0.16], [0.035, 0.2], [0.03, 0.21], [0.012, 0.225], [0, 0.23]], 18, px, py, pz);
  cyl(m, [px - 0.06, py + 0.06, pz], [px - 0.13, py + 0.15, pz], 0.012, 6);
  m.sweep([[px + 0.055, py + 0.18, pz], [px + 0.1, py + 0.13, pz], [px + 0.09, py + 0.04, pz], [px + 0.065, py + 0.03, pz]], 0.015, 0.008, null, false);
  return m;
}
// folding camp chair: wooden X legs, arms, khaki canvas seat and back; faces -z
function meshChair() {
  const m = new Mesh();
  P(m, 9);
  for (const s of [-1, 1]) {
    const x = s * 0.27;
    m.sweep([[x, 0, -0.24], [x, 0.45, 0.2]], 0.035, 0.035); m.sweep([[x, 0, 0.2], [x, 0.45, -0.24]], 0.035, 0.035);
    m.sweep([[x, 0.45, -0.26], [x, 0.45, 0.22]], 0.035, 0.035); m.sweep([[x, 0.66, -0.28], [x, 0.66, 0.22]], 0.06, 0.025);
    m.sweep([[x, 0.45, 0.21], [x, 0.9, 0.27]], 0.035, 0.035); m.sweep([[x, 0.45, -0.24], [x, 0.66, -0.24]], 0.03, 0.03);
  }
  P(m, 17); box(m, -0.26, 0.42, -0.23, 0.26, 0.445, 0.2); box(m, -0.26, 0.64, 0.24, 0.26, 0.86, 0.26);
  return m;
}
// green steel cooler with handles
function meshCooler() {
  const m = new Mesh();
  P(m, 11); box(m, -0.32, 0, -0.18, 0.32, 0.33, 0.18); box(m, -0.33, 0.33, -0.19, 0.33, 0.4, 0.19);
  P(m, 23); box(m, -0.325, 0.14, -0.185, 0.325, 0.17, 0.185);
  P(m, 3); for (const s of [-1, 1]) m.sweep([[s * 0.33, 0.28, -0.08], [s * 0.37, 0.27, -0.07], [s * 0.37, 0.27, 0.07], [s * 0.33, 0.28, 0.08]], 0.015, 0.015, null, false);
  box(m, -0.04, 0.3, -0.2, 0.04, 0.37, -0.19);
  return m;
}
function meshCamp() {
  const m = new Mesh();
  put(m, meshFire(), 0, 0, 0);
  put(m, meshTent(), 1, 0, 7.5);
  put(m, meshTruck(), 8, 0, -4.2);
  put(m, meshTrailer(), 8, 0, -4.2 + 2.64 + 1.32);
  put(m, meshCooler(), 2.3, 0, 2.4, 0.4);
  // firewood stacked by the fire
  rseed(450); P(m, 10);
  for (let i = 0; i < 9; i++) { const l = rr(0.6, 0.85), r = rr(0.05, 0.075), y = r + (i / 3 | 0) * 0.12, x0 = -2.4 + i % 3 * 0.17 + (i / 3 | 0) * 0.08; cyl(m, [x0, y, -1.6], [x0 + rr(-0.1, 0.1), y, -1.6 + l], r, 7); }
  // duffel bag and a jerry can
  P(m, 17); m.tube([[2.5, 0.16, 5.0], [2.6, 0.17, 5.2], [2.95, 0.17, 5.5], [3.05, 0.16, 5.62]], (k) => [0.1, 0.17, 0.17, 0.1][k], 12, true);
  P(m, 19); box(m, 5.75, 0, 1.0, 5.92, 0.47, 1.45); P(m, 21); box(m, 5.82, 0.47, 1.12, 5.85, 0.52, 1.33);
  return m;
}
// kerosene hurricane lantern, red paint and tin, origin at the flame
function meshLantern() {
  const m = new Mesh();
  P(m, 40); lathe(m, [[0, -0.165], [0.07, -0.165], [0.085, -0.15], [0.088, -0.11], [0.075, -0.085], [0.04, -0.075], [0.04, -0.07]], 20);
  P(m, 41); lathe(m, [[0.03, -0.07], [0.048, -0.05], [0.062, -0.01], [0.062, 0.02], [0.05, 0.05], [0.035, 0.07]], 20);
  P(m, 40); lathe(m, [[0.036, 0.07], [0.07, 0.085], [0.07, 0.1], [0.04, 0.13], [0.02, 0.14], [0, 0.145]], 20);
  P(m, 42);
  for (let i = 0; i < 4; i++) { const a = i / 4 * TAU + 0.4, c = cos(a), s = sin(a); cyl(m, [c * 0.072, -0.075, s * 0.072], [c * 0.072, 0.06, s * 0.072], 0.0035, 4, false); }
  cyl(m, [0, -0.01, 0], [0, -0.004, 0], 0.075, 16, false);
  P(m, 40);
  for (const s of [-1, 1]) m.tube([[s * 0.08, -0.12, 0], [s * 0.095, -0.03, 0], [s * 0.088, 0.08, 0], [s * 0.05, 0.12, 0]], 0.009, 6, true);
  P(m, 42); const bail = []; for (let i = 0; i <= 10; i++) { const a = i / 10 * PI; bail.push([cos(a) * 0.1, 0.0 + sin(a) * 0.16, 0]); } m.tube(bail, 0.0035, 4, false);
  return m;
}
