// ============================================================================
// world layout + procedural content generation (load-time only)
// ============================================================================

// designed rock masses: ax, az, bx, bz, radius, top, overhang, waist
const MESAS = [
  [4, 96, 4, 96, 4.4, -6, 2, 1.5],      // pillar with a window, in the east reach
  [6, -88, 6, -88, 10, -34, 0, 0],      // low butte splitting the west reach
];
// vertical ring arches: cx, cy, cz, yaw, major radius, minor radius, y squash
const ARCHES = [
  [0, -45, -34, 0, 16.5, 2.8, 1.2],      // spans the main canyon west of camp: the moon sets through it
  [5, -45, 58, -0.53, 15, 2.2, 1.3],     // spans the canyon at the first bend east of camp
];
// carved tunnels: ax, ay, az, radius, bx, by, bz
const HOLES = [
  [4, -21, 90, 2.5, 4, -21, 102],        // the pillar's window
];
// (unused since the canyon layout: regions kept free of random mesas)
const CLEARS = [];
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
  // things you can't walk through, for the walking (x, z, radius): rocks, cacti, tree trunks, fallen blocks
  const obs = [];
  const OBR = [0.55, 0.55, 0.55, 0.55, 0.22, 0.2, 0.32, 0.32, 0.22, 0.24];
  const solid = (mesh, x, y, z, sc, q, mat, seed, ts = 1, bob = 0) => {
    (mesh > 3 && mesh < 10 ? props[mesh - 4][cellOf(x, z)] : (solids[mesh] ||= [])).push(x, y, z, sc, q[0], q[1], q[2], q[3], mat, seed, ts, bob);
    if (mesh < 10 && (mesh > 3 || sc > 0.45)) obs.push(x, z, OBR[mesh] * sc);
  };
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
  // within r of the fire, or under the tent (nothing may poke through its floor)
  const onRamp = (x, z) => { for (let i = 0; i < RAMP.length - 1; i++) { const a = RAMP[i], b = RAMP[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz), 0, 1); if (hypot(x - a[0] - dx * t, z - a[1] - dz * t) < mix(a[3], b[3], t) + 1) return true; } return false; };
  const nearCamp = (x, z, r) => onRamp(x, z) || hypot(x - CAMP[0], z - CAMP[2]) < r || (abs(x - CAMP[0] - 1) < 2.2 && abs(z - CAMP[2] - 7.5) < 2.5);
  // a flat-ish ground point picked from the terrain mesh, or null
  const RH = ruinHouses();
  const inRuin = (x, z, pad) => { for (const h of RH) if (inHouse(h, x, z, pad)) return true; return false; };
  const nearTrace = (x, z) => { for (const t of TRACE) if (hypot(x - t[0], z - t[1]) < t[2]) return true; return false; };
  const ground = (ny0, rCamp, rFly) => {
    const k = pickV(); if (T.wn[k + 1] < ny0) return null;
    const x = T.wp[k] + rr(-0.35, 0.35), z = T.wp[k + 2] + rr(-0.35, 0.35), y = T.wp[k + 1];
    if (hypot(x, z) > 168 || nearCamp(x, z, rCamp) || nearPose(x, z, 3) || nearFly(x, y, z, rFly) || inRuin(x, z, 0.9) || nearTrace(x, z)) return null;
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
      for (let j = (rc * rc * 200 + 20) * 1.3 | 0; j > 0; j--) {
        let dx = rr(-1, 1), dy = rr(-0.6, 1), dz = rr(-1, 1); const l = hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
        const r = rc * (0.55 + 0.35 * rnd()), py = y + ty + dy * r * 0.7;
        leaf(big, x + tx + dx * r, py, z + tz + dz * r, (kind ? rr(0.08, 0.14) : rr(0.1, 0.18)) * (0.8 + 0.3 * rc), atan2(dz, dx) + rr(-0.8, 0.8), rr(0.3, 1.9), kind ? rr(0.03, 0.04) : rr(0.022, 0.032), py - y, kind ? 4 : 0, rnd(), rnd(), rr(0.5, 0.75));
      }
    }
  };
  rseed(4);
  // a few by camp, so it does not stand in the open
  for (const t of [[-11, 7, 0, 1.2], [-12, 18, 1, 1.1], [-8, -13, 0, 1.3], [-14, -4, 0, 0.9], [-6, 20, 0, 0.8]]) { const x = CAMP[0] + t[0], z = CAMP[2] + t[1]; tree(x, gy(x, z), z, t[2], t[3]); }
  for (const [x0, z0, k] of [[-6.5, 5.5, 6], [5.5, -9.5, 7], [-9.5, -6, 6], [-12.5, 3.5, 7], [-4.5, 11.5, 6], [6.5, 12, 5]]) { const x = CAMP[0] + x0, z = CAMP[2] + z0; solid(k, x, gy(x, z) - 0.04, z, k === 5 ? 1.2 : 1.1, qAxis(0, 1, 0, rnd() * TAU), 2, rnd(), 1, 0); }
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
      leaf(big, x, y + 0.1, z, h, ya, ln, 0.06, 0, 1, rnd(), rnd(), 0.3);
      const tx = x + cos(ya) * sin(ln) * h, tz = z + sin(ya) * sin(ln) * h;
      for (let j = 0; j < 7; j++) { const f = rr(0.7, 0.97); leaf(big, x + (tx - x) * f, y + 0.1 + h * f, z + (tz - z) * f, rr(0.08, 0.2), rnd() * TAU, rr(0.6, 1.4), 0.025, h, 1, rnd(), rnd(), 0.45); }
    }
  };
  rseed(5);
  for (let i = 0; i < 90000; i++) {
    const p = ground(0.7, 9, 2); if (!p) continue;
    const u = rnd(), pat = fbm(p[0] * 0.06, 5, p[2] * 0.06, 2), q = qAxis(0, 1, 0, rnd() * TAU);
    if (u < 0.006) yucca(p[0], p[1], p[2]);
    else if (u < 0.006 + 0.02 * pat) solid(6 + (rnd() < 0.5), p[0], p[1] - 0.04, p[2], rr(0.75, 1.25), q, 2, rnd(), 1, 0);
    else if (u < 0.008 + 0.017 * pat) solid(rnd() < 0.5 ? 4 : 5, p[0], p[1] - 0.04, p[2], rr(0.6, 1.4), q, 2, rnd(), 1, 0);
  }

  // --- rocks: scattered ground rocks, talus and boulders on the slopes, pebbles
  rseed(9);
  for (let i = 0; i < 2600; i++) {
    const k = pickV(); if (T.wn[k + 1] < 0.7 || hypot(T.wp[k], T.wp[k + 2]) > 170 || nearCamp(T.wp[k], T.wp[k + 2], 12) || nearFly(T.wp[k], T.wp[k + 1], T.wp[k + 2], 6) || inRuin(T.wp[k], T.wp[k + 2], 1.2) || nearTrace(T.wp[k], T.wp[k + 2])) continue;
    const sc = rr(0.25, 1.3) * (rnd() < 0.1 ? 2 : 1);
    solid(rnd() * 4 | 0, T.wp[k], T.wp[k + 1] + sc * 0.08, T.wp[k + 2], sc, qMul(qAxis(0, 1, 0, rnd() * TAU), qAxis(1, 0, 0, rr(-0.25, 0.25))), 1, rnd(), 1, 0);
  }
  rseed(10);
  const gy0 = (x, z) => { const f = floorsAt(x, z); return f.length ? f[0 + f.length - 2] : -45; }; // lowest floor here
  for (let i = 0; i < 60000; i++) {
    const k = pickV(), x = T.wp[k], y = T.wp[k + 1], z = T.wp[k + 2], ny = T.wn[k + 1];
    // talus: fallen blocks only at the foot of the cliffs and on gentle slopes, never stuck to the cliff faces
    if (hypot(x, z) > 172 || y > gy0(x, z) + 6 || ny < 0.25 || (ny > 0.8 && rnd() < 0.6) || nearFly(x, y, z, 3.5) || nearCamp(x, z, 13) || inRuin(x, z, 1.2) || nearTrace(x, z)) continue;
    if (rnd() < 0.55) continue;
    const sc = (0.35 + 1.7 * pow(rnd(), 3.2)) * (ny > 0.8 ? 0.5 : 1), q = qAxis(0, 1, 0, rnd() * TAU);
    if (sc > 0.5) obs.push(x, z, 0.62 * sc);
    chunks[(sc > 1.15 ? 3 : 0) + (rnd() * 3 | 0)][cellOf(x, z)].push(x - T.wn[k] * sc * 0.3, y - ny * sc * 0.3, z - T.wn[k + 2] * sc * 0.3, sc, q[0], q[1], q[2], q[3], 1, rnd(), sc > 1.15 ? 0 : 96, 0);
  }
  rseed(11);
  for (let i = 0; i < 170000; i++) {
    const k = pickV(), x = T.wp[k] + rr(-0.4, 0.4), z = T.wp[k + 2] + rr(-0.4, 0.4), y = T.wp[k + 1];
    if (T.wn[k + 1] < 0.8 || hypot(x, z) > 170 || nearFly(x, y, z, 1.3) || nearCamp(x, z, 7)) continue;
    const sc = 0.05 + 0.3 * pow(rnd(), 2), q = qRand();
    nth++ % THIN || chunks[6][cellOf(x, z)].push(x, y - sc * 0.25, z, sc, q[0], q[1], q[2], q[3], 1, rnd(), 44, 0);
  }

  // --- the 1870s settlement and the traces of later visitors (ruins.js): world-coordinate meshes, one instance each
  const rbox = [], S = buildSettlement(RH, gy, solid, tuft, rbox), trM = buildTraces(gy, solid, (x, z, r) => obs.push(x, z, r));
  for (const id of [RUIN_MESH, RUIN_STAGE, RUIN_STAGE + 1, RUIN_STAGE + 2, TRACE_MESH]) solid(id, 0, 0, 0, 1, [0, 0, 0, 1], 2, 0, 1, 0);
  for (const m of [S.ruin, ...S.stg, trM]) bakeAO(m, { ground: gy, res: 0.025, maxD: 0.35 });

  // --- the camp (one mesh) and the folding chair (its own instance, so it can be moved later)
  solid(10, CAMP[0], CAMP[1], CAMP[2], 1, [0, 0, 0, 1], 2, 0, 1, 0);
  solid(W_SIGN, CAMP[0] + SIGN[0], CAMP[1], CAMP[2] + SIGN[1], 1, qAxis(0, 1, 0, SIGN[2]), 2, 0, 1, 0);
  solid(12, CAMP[0] + CHAIR[0], CAMP[1], CAMP[2] + CHAIR[1], 1, qAxis(0, 1, 0, CHAIR[2]), 2, 0, 1, 0);
  // campfire: flame cards (x, y, z, half width | seed, 0, height) and embers (seed, 1)
  const fire = [];
  rseed(12);
  for (let i = 0; i < 10; i++) { const a = rnd() * TAU, r = rr(0, 0.26); fire.push(CAMP[0] + cos(a) * r, CAMP[1] + 0.04, CAMP[2] + sin(a) * r, rr(0.22, 0.34), rnd(), 0, rr(0.75, 1.3), 0); }
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
  for (let m = 0; m < SOLN; m++) { const a = solids[m] || []; sol.ranges.push([si, a.length / 12]); si += a.length / 12; for (let i = 0; i < a.length; i++) sol.data.push(a[i]); }
  const packC = (L) => {
    let n = 0; const start = new Uint32Array(nCells + 1);
    for (let c = 0; c < nCells; c++) { start[c] = n; n += L[c].length / 12; }
    start[nCells] = n;
    const data = new Float32Array(n * 12), lo = new Float32Array(nCells).fill(1e9), hi = new Float32Array(nCells).fill(-1e9);
    let k = 0;
    for (let c = 0; c < nCells; c++) { const a = L[c]; for (let i = 0; i < a.length; i += 12) { for (let j = 0; j < 12; j++) data[k++] = a[i + j]; lo[c] = min(lo[c], a[i + 1] - 3); hi[c] = max(hi[c], a[i + 1] + 5); } }
    return { data, n, start, lo, hi };
  };
  return { ruinM: S.ruin, stgM: S.stg, trM, rbox, ruinH: RH, nStone: S.nStone, obs: new Float32Array(obs), gy, trunks, chunks: chunks.map(packC), props: props.map(packC), big: pack(big), bigF: pack(big, 2, 1.5), small: pack(small), solids: { data: new Float32Array(sol.data), ranges: sol.ranges }, volD, gm, fire: new Float32Array(fire) };
}
const fract = (x) => x - floor(x);

// ---------------------------------------------------------------- procedural meshes
function meshChunk(sd, sub = 2, det = sub > 2) {
  if (LV > 1 && sub > 1) sub--; // Low: a quarter of the triangles
  rseed(100 + sd);
  // cut by a level top and bottom (the bedding) and six to eight steep joint faces
  const pl = [[0, 1, 0, rr(0.35, 0.55)], [0, -1, 0, rr(0.3, 0.5)]];
  for (let i = 0, n = 5 + (rnd() * 4 | 0); i < n; i++) { const a = i / n * TAU + rr(-0.5, 0.5), t = rr(-0.45, 0.45); const l = hypot(1, t); pl.push([cos(a) / l, t / l, sin(a) / l, rr(0.55, 0.9)]); }
  return icosphere(sub, (x, y, z) => {
    let r = 1 + (fbm(x * 1.6 + sd, y * 1.6, z * 1.6, 2) - 0.5) * 0.45 + (det ? (fbm(x * 4 + sd, y * 4, z * 4, 2) - 0.5) * 0.12 : 0);
    let px = x * r * 1.1, py = y * r * 0.8, pz = z * r * 0.95;
    for (const p of pl) { const d = px * p[0] + py * p[1] + pz * p[2] - p[3]; if (d > 0) { px -= p[0] * d; py -= p[1] * d; pz -= p[2] * d; } }
    return [px, py, pz];
  });
}

// ---------------------------------------------------------------- shape helpers for the hand-built objects
// Every helper adds to mesh m with the current part id (m.part, which picks the material: see prop() in shaders.js).
const P = (m, id) => { m.part = id; return m; };
// give every vertex already in m the part id (for meshes made by icosphere())
const tag = (m, id) => { m.aux.fill(id / 127); return m; };
const box = (m, x0, y0, z0, x1, y1, z1, bv = 0.004) => {
  const b = min(bv, (x1 - x0) * 0.22, (y1 - y0) * 0.22, (z1 - z0) * 0.22);
  if (b > 0.0006) {
    const L = [[x0, x1], [y0, y1], [z0, z1]], C = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
    const pt = (s, e) => [0, 1, 2].map((k) => (s[k] ? L[k][1] - e[k] * b : L[k][0] + e[k] * b));
    const out = (ps) => { const [a, bb, c] = ps, u = [bb[0] - a[0], bb[1] - a[1], bb[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], g = ps.reduce((q, p) => [q[0] + p[0], q[1] + p[1], q[2] + p[2]], [0, 0, 0]).map((x) => x / ps.length); return n[0] * (g[0] - C[0]) + n[1] * (g[1] - C[1]) + n[2] * (g[2] - C[2]) >= 0 ? ps : ps.slice().reverse(); };
    const poly = (ps) => { const q = out(ps).map((p) => m.v(...p)); if (q.length === 4) m.quad(q[0], q[1], q[2], q[3]); else m.tri(q[0], q[1], q[2]); };
    for (let a = 0; a < 3; a++) {
      const b1 = (a + 1) % 3, c1 = (a + 2) % 3;
      for (const sa of [0, 1]) poly([[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => { const s = [], e = []; s[a] = sa; e[a] = 0; s[b1] = u; e[b1] = 1; s[c1] = v; e[c1] = 1; return pt(s, e); }));
      for (const sb of [0, 1]) for (const sc of [0, 1]) poly([[0, 1, 0], [1, 1, 0], [1, 0, 1], [0, 0, 1]].map(([sa, eb, ec]) => { const s = [], e = []; s[a] = sa; e[a] = 1; s[b1] = sb; e[b1] = eb; s[c1] = sc; e[c1] = ec; return pt(s, e); }));
    }
    for (const sx of [0, 1]) for (const sy of [0, 1]) for (const sz of [0, 1]) poly([[0, 1, 1], [1, 0, 1], [1, 1, 0]].map((e) => pt([sx, sy, sz], e)));
    return;
  }
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
      const tw = kind ? 0.35 : 0.6; d = [d[0] + rr(-tw, tw), d[1] + rr(-0.1, 0.25), d[2] + rr(-tw, tw)]; const l = hypot(...d); d = d.map((v) => v / l);
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
  P(m, kind ? 68 : 67);
  for (const t of tips) { rseed(500 + kind * 50 + (t[0] * 97 | 0)); const sd = rnd() * 9; put(m, tag(icosphere(2, (x, y, z) => { const r = 0.75 + 0.45 * fbm(x * 2.3 + sd, y * 2.3, z * 2.3, 3); return [x * r, y * r * 0.8, z * r]; }), kind ? 68 : 67), t[0], t[1], t[2], rnd() * TAU, t[3] * 0.48); }
  return { m, tips };
}
// an areole: a tuft of brown glochids (69) and a few stiff pale spines (64) fanning out from point p along normal n
function areole(m, p, n, ns, len, spread = 0.55) {
  P(m, 69); put(m, tag(icosphere(0), 69), p[0], p[1], p[2], rnd() * TAU, 0.0035);
  P(m, 64);
  for (let i = 0; i < ns; i++) {
    let dx = n[0] + rr(-spread, spread), dy = n[1] + rr(-spread, spread) - 0.15, dz = n[2] + rr(-spread, spread); const dl = hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
    let sx = dy * 0.3 - dz * 0.9, sy = dz * 0.2 - dx * 0.3, sz = dx * 0.9 - dy * 0.2; const sl = hypot(sx, sy, sz) || 1, w = 0.0011; sx *= w / sl; sy *= w / sl; sz *= w / sl;
    const l = len * rr(0.6, 1.2), a = m.v(p[0] + sx, p[1] + sy, p[2] + sz), b = m.v(p[0] - sx, p[1] - sy, p[2] - sz), c = m.v(p[0] + dx * l, p[1] + dy * l, p[2] + dz * l);
    m.tri(a, b, c); m.tri(b, a, c);
  }
}
// barrel cactus: a ribbed column, areoles along every rib crest with a hooked central spine and radials
function meshBarrel() {
  rseed(400); const m = P(new Mesh(), 60), prof = [[0, 0], [0.16, 0], [0.2, 0.1], [0.21, 0.3], [0.19, 0.45], [0.13, 0.55], [0.05, 0.6], [0, 0.61]], R = 18;
  lathe(m, prof, 72, 0, 0, 0, R, 0.09);
  const rAt = (h) => { for (let k = 0; k < prof.length - 1; k++) if (h <= prof[k + 1][1]) return mix(prof[k][0], prof[k + 1][0], (h - prof[k][1]) / (prof[k + 1][1] - prof[k][1])); return 0; };
  for (let k = 0; k < R; k++) { const a = k / R * TAU; for (let h = 0.06 + (k % 2) * 0.02; h < 0.58; h += 0.045) { const r = rAt(h) * 1.09 + 0.002; if (r < 0.03) continue; const n = [cos(a) * 0.8, 0.35 + h * 0.6, sin(a) * 0.8]; areole(m, [cos(a) * r, h, sin(a) * r], n, 5, 0.035, 0.7); } }
  return m;
}
// hedgehog cactus: a clump of small ribbed stems, areoles along the ribs with straight spines all round
function meshHedgehog() {
  rseed(410); const m = P(new Mesh(), 60);
  for (let i = 0; i < 7; i++) {
    const a0 = rnd() * TAU, r0 = rr(0, 0.12), h = rr(0.12, 0.3), w = rr(0.045, 0.07), ox = cos(a0) * r0, oz = sin(a0) * r0;
    const prof = [[0, -0.02], [w, 0], [w * 1.05, h * 0.6], [w * 0.7, h * 0.95], [0, h]];
    P(m, 60); lathe(m, prof, 32, ox, 0, oz, 8, 0.12);
    for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; for (let y = 0.02 + (k % 2) * 0.012; y < h * 0.95; y += 0.024) { const t = y / h, r = (t < 0.6 ? mix(w, w * 1.05, t / 0.6) : mix(w * 1.05, w * 0.7, (t - 0.6) / 0.35)) * 1.12; areole(m, [ox + cos(a) * r, y, oz + sin(a) * r], [cos(a), 0.4 + t * 0.6, sin(a)], 6, 0.022, 0.8); } }
  }
  return m;
}
// prickly pear: flat obovate pads (wider toward the top, thin rounded rims) growing from the edges of older pads, areoles
// in loose diagonal rows over both faces, a few red-purple fruits on top
function meshPear(seed) {
  rseed(420 + seed); const m = new Mesh(), fruit = tag(icosphere(1), 65);
  const pad = icosphere(3, (x, y, z) => { const wy = 1 + 0.22 * y, th = 0.6 + 0.4 * sqrt(max(0, 1 - x * x - y * y)); return [x * wy, y, z * th]; });
  const grow = (x, y, z, yaw, lean, depth) => {
    const s = rr(0.8, 1.1), h = 0.17 * s, A = 0.13 * s, C = 0.035 * s, c = cos(lean), sn = sin(lean), cy = cos(yaw), sy = sin(yaw);
    // tip a pad-local point (round its own x axis), then turn and move it so the pad's base sits at x, y, z
    const xf = (px, py, pz) => { const qy = py * c - pz * sn, qz = py * sn + pz * c; return [x + px * cy + qz * sy, y + qy, z - px * sy + qz * cy]; };
    const n0 = m.p.length / 3; P(m, 63); put(m, tag(pad, 63), 0, 0, 0, 0, [A, h, C]);
    for (let k = n0 * 3; k < m.p.length; k += 3) { const q = xf(m.p[k], m.p[k + 1] + h, m.p[k + 2]); m.p[k] = q[0]; m.p[k + 1] = q[1]; m.p[k + 2] = q[2]; }
    for (let i = 0; i < 26; i++) {
      const u = rr(-0.85, 0.85), v = rr(-0.85, 0.85); if (u * u + v * v > 0.8) continue;
      const f = rnd() < 0.5 ? 1 : -1, wy = 1 + 0.22 * v, th = 0.6 + 0.4 * sqrt(max(0, 1 - u * u - v * v)), zz = sqrt(max(0, 1 - u * u - v * v)) * th * f;
      const p = xf(u * wy * A, v * h + h, zz * C * 1.02), q = xf(u * wy * A + u * 0.3 * f * 0, v * h + h, zz * C + f * 0.02);
      areole(m, p, [q[0] - p[0], q[1] - p[1], q[2] - p[2]], 1 + (rnd() < 0.6) + (rnd() < 0.3), 0.025);
    }
    const tx = x + sin(lean) * 2 * h * sin(yaw), ty = y + cos(lean) * 2 * h, tz = z + sin(lean) * 2 * h * cos(yaw);
    if (depth) for (let i = 1 + (rnd() < 0.6); i > 0; i--) grow(tx + rr(-0.06, 0.06), ty - 0.04, tz + rr(-0.06, 0.06), yaw + rr(-1, 1), lean + rr(-0.5, 0.5), depth - 1);
    else if (rnd() < 0.7) for (let i = 1 + rnd() * 3 | 0; i > 0; i--) put(m, fruit, tx + rr(-0.06, 0.06), ty - 0.01, tz + rr(-0.03, 0.03), 0, 0.025);
  };
  for (let i = 0; i < 3; i++) grow(rr(-0.15, 0.15), -0.03, rr(-0.15, 0.15), rnd() * TAU, rr(-0.5, 0.5), 2);
  return m;
}
// ---------------------------------------------------------------- distance-field modelling (for the made things)
// signed distances (negative inside) from rounded boxes, tori and capsules, blended with smooth minimum / maximum
// (Inigo Quilez), then meshed with surface nets at res metres; part(x, y, z) paints each vertex
const sdBox = (x, y, z, cx, cy, cz, hx, hy, hz, r) => { const qx = abs(x - cx) - hx + r, qy = abs(y - cy) - hy + r, qz = abs(z - cz) - hz + r; return hypot(max(qx, 0), max(qy, 0), max(qz, 0)) + min(max(qx, max(qy, qz)), 0) - r; };
const sdCap = (x, y, z, ax, ay, az, bx, by, bz, r) => { const px = x - ax, py = y - ay, pz = z - az, dx = bx - ax, dy = by - ay, dz = bz - az, t = clamp((px * dx + py * dy + pz * dz) / (dx * dx + dy * dy + dz * dz), 0, 1); return hypot(px - dx * t, py - dy * t, pz - dz * t) - r; };
const smin = (a, b, k) => { const h = max(k - abs(a - b), 0) / k; return min(a, b) - h * h * k * 0.25; };
const smax = (a, b, k) => -smin(-a, -b, k);
function sdfMesh(f, part, x0, y0, z0, x1, y1, z1, res) {
  const nx = Math.ceil((x1 - x0) / res) + 1, ny = Math.ceil((y1 - y0) / res) + 1, nz = Math.ceil((z1 - z0) / res) + 1, D = new Float32Array(nx * ny * nz);
  for (let k = 0, i = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let h = 0; h < nx; h++, i++) D[i] = -f(x0 + h * res, y0 + j * res, z0 + k * res);
  const sn = surfaceNets(D, nx, ny, nz), m = new Mesh();
  for (let v = 0; v < sn.nv; v++) { const x = x0 + sn.pos[v * 3] * res, y = y0 + sn.pos[v * 3 + 1] * res, z = z0 + sn.pos[v * 3 + 2] * res; m.part = part(x, y, z); m.v(x, y, z); }
  m.part = 0; for (let t = 0; t < sn.ni; t++) m.i.push(sn.idx[t]);
  // wind the triangles outward (compare one face's normal with the field's gradient)
  const P = m.p, I = m.i; let s = 0;
  for (let t = 0; t < min(I.length, 3000); t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3, ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const cx = (P[a] + P[b] + P[c]) / 3, cy = (P[a + 1] + P[b + 1] + P[c + 1]) / 3, cz = (P[a + 2] + P[b + 2] + P[c + 2]) / 3, e = res * 0.5;
    s += (uy * vz - uz * vy) * (f(cx + e, cy, cz) - f(cx - e, cy, cz)) + (uz * vx - ux * vz) * (f(cx, cy + e, cz) - f(cx, cy - e, cz)) + (ux * vy - uy * vx) * (f(cx, cy, cz + e) - f(cx, cy, cz - e));
  }
  if (s < 0) for (let t = 0; t < I.length; t += 3) { const q = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = q; }
  return m;
}
// a lathe (round the y axis) turned to lie along x, centred at cx, cy, cz (s: which way its face looks)
const latheX = (m, prof, seg, cx, cy, cz, s, ribs = 0, ra = 0) => { const n0 = m.p.length / 3; lathe(m, prof, seg, 0, 0, 0, ribs, ra); for (let k = n0 * 3; k < m.p.length; k += 3) { const x = m.p[k], y = m.p[k + 1], z = m.p[k + 2]; m.p[k] = cx + y * s; m.p[k + 1] = cy + x; m.p[k + 2] = cz + z; } };
const latheZ = (m, prof, seg, cx, cy, cz, s) => { const n0 = m.p.length / 3; lathe(m, prof, seg, 0, 0, 0); for (let k = n0 * 3; k < m.p.length; k += 3) { const x = m.p[k], y = m.p[k + 1], z = m.p[k + 2]; m.p[k] = cx + x; m.p[k + 1] = cy + z; m.p[k + 2] = cz + y * s; } };
// a flat quad grid on a plane: corner o, edges u and v, lifted along n by off
const panel = (m, o, u, v, nu = 2, nv = 2) => { const g = []; for (let i = 0; i <= nu; i++) { const r = []; for (let j = 0; j <= nv; j++) r.push(m.v(o[0] + u[0] * i / nu + v[0] * j / nv, o[1] + u[1] * i / nu + v[1] * j / nv, o[2] + u[2] * i / nu + v[2] * j / nv)); g.push(r); } for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { m.quad(g[i][j], g[i + 1][j], g[i + 1][j + 1], g[i][j + 1]); m.quad(g[i][j], g[i][j + 1], g[i + 1][j + 1], g[i + 1][j]); } };

// ---------------------------------------------------------------- the camp
// 1950s half-ton pickup, nose to -z, ground at y = 0, two-tone cream cab roof over turquoise. The body is one distance
// field: a crowned hood over the grille shell, pontoon front fenders blended into it, the cab with its greenhouse cut
// by the sloping windshield, a hollow fleetside bed with rear fender bulges, the wheel arches cut out; then the
// chrome (bumpers, grille bars, headlight rims, hubcaps), glass in black rubber, tyres with tread and whitewalls
const TRUCK_AX = [-1.62, 1.38];
function meshTruck() {
  const zf = (y) => -0.72 + (y - 1.3) * 0.34; // the windshield's slope
  const body = (x, y, z) => {
    const ax = abs(x);
    let d = sdBox(x, y + 0.22 * x * x, z, 0, 0.97, -1.56, 0.54, 0.16, 0.8, 0.14);                // hood, crowned
    d = smin(d, sdBox(x, y, z, 0, 0.74, -2.26, 0.5, 0.28, 0.1, 0.08), 0.12);                     // grille shell
    d = smin(d, sdBox(ax, y, z, 0.71, 0.77, -1.66, 0.2, 0.25, 0.78, 0.19), 0.16);               // front fenders
    d = smin(d, sdBox(x, y, z, 0, 0.99, -0.13, 0.86, 0.36, 0.64, 0.07), 0.08);                  // cab
    d = smin(d, smax(sdBox(x, y, z, 0, 1.52, -0.1, 0.8, 0.26, 0.56, 0.12), zf(y) - z, 0.05), 0.05); // greenhouse
    let bed = sdBox(x, y, z, 0, 1.02, 1.5, 0.8, 0.27, 0.88, 0.04);
    bed = smin(bed, sdBox(ax, y, z, 0.8, 0.73, 1.38, 0.09, 0.22, 0.56, 0.09), 0.12);           // rear fender bulges
    bed = smax(bed, -sdBox(x, y, z, 0, 1.17, 1.5, 0.735, 0.32, 0.815, 0.025), 0.02);            // hollow
    d = min(d, bed);
    d = min(d, sdBox(ax, y, z, 0.79, 0.5, -0.14, 0.13, 0.022, 0.76, 0.015));                    // running boards
    d = min(d, sdBox(x, y, z, 0, 0.44, 0.1, 0.42, 0.07, 2.15, 0.02));                           // frame
    for (const za of TRUCK_AX) d = smax(d, -max(hypot(y - 0.4, z - za) - 0.47, 0.46 - ax), 0.03); // wheel arches
    return d;
  };
  const paint = (x, y, z) => (y < 0.53 && abs(x) < 0.5) || (abs(x) > 0.66 && y < 0.53 && z > -0.92 && z < 0.64) ? 21 : y > 1.33 && z > -0.86 && z < 0.5 ? 1 : 2;
  const m = sdfMesh(body, paint, -1.0, 0.3, -2.5, 1.0, 1.84, 2.42, 0.024);
  // chrome: bumpers with rounded ends and overriders, the grille's three heavy bars in a surround, headlight rims
  const chrome = (x, y, z) => {
    const ax = abs(x);
    let d = sdBox(x, y, z, 0, 0.44, -2.53, 0.96, 0.075, 0.05, 0.04);
    d = min(d, sdBox(ax, y, z, 0.42, 0.5, -2.56, 0.04, 0.12, 0.04, 0.035));
    d = min(d, sdBox(x, y, z, 0, 0.44, 2.44, 0.96, 0.07, 0.04, 0.035));
    let gs = sdBox(x, y, z, 0, 0.72, -2.37, 0.46, 0.22, 0.02, 0.05); gs = max(gs, -sdBox(x, y, z, 0, 0.72, -2.37, 0.41, 0.17, 0.05, 0.03));
    d = min(d, gs);
    for (const gy of [0.62, 0.72, 0.82]) d = min(d, sdCap(x, y, z, -0.42, gy, -2.385, 0.42, gy, -2.385, 0.022));
    for (const s of [-1, 1]) d = min(d, hypot(hypot(x - s * 0.71, y - 0.84) - 0.1, z + 2.43) - 0.018);
    return d;
  };
  put(m, sdfMesh(chrome, () => 3, -1.05, 0.3, -2.68, 1.05, 1.0, -2.28, 0.01), 0, 0, 0);
  put(m, sdfMesh(chrome, () => 3, -1.05, 0.3, 2.36, 1.05, 0.56, 2.52, 0.012), 0, 0, 0);
  P(m, 34); box(m, -0.41, 0.55, -2.37, 0.41, 0.89, -2.33);                                       // dark behind the grille
  for (const s of [-1, 1]) { P(m, 22); put(m, tag(icosphere(2), 22), s * 0.71, 0.84, -2.42, 0, [0.088, 0.088, 0.03]); }
  // glass, each pane in a black rubber surround: the split windshield on its slope, door glass, the back window
  const pane = (o, u, v, n, e) => { P(m, 34); panel(m, [o[0] - u[0] * e / hypot(...u) - v[0] * e / hypot(...v) + n[0] * 0.003, o[1] - u[1] * e / hypot(...u) - v[1] * e / hypot(...v) + n[1] * 0.003, o[2] - u[2] * e / hypot(...u) - v[2] * e / hypot(...v) + n[2] * 0.003], u.map((c, k) => c * (1 + 2 * e / hypot(...u))), v.map((c, k) => c * (1 + 2 * e / hypot(...v)))); P(m, 6); panel(m, [o[0] + n[0] * 0.006, o[1] + n[1] * 0.006, o[2] + n[2] * 0.006], u, v, 2, 2); };
  const wn = [0, 0.34 / hypot(1, 0.34), -1 / hypot(1, 0.34)];
  for (const s of [-1, 1]) pane([s > 0 ? 0.03 : -0.66, 1.37, zf(1.37)], [0.63, 0, 0], [0, 0.32, 0.32 * 0.34], wn, 0.018);
  for (const s of [-1, 1]) pane([s * 0.802, 1.37, -0.5], [0, 0, 0.78], [0, 0.29, 0], [s, 0, 0], 0.02);
  pane([-0.46, 1.4, 0.462], [0.92, 0, 0], [0, 0.25, 0], [0, 0, 1], 0.02);
  // door seams, handles, mirrors, tail lights, licence plates, the hood emblem
  P(m, 34);
  for (const s of [-1, 1]) { box(m, s * 0.858, 0.66, -0.66, s * 0.866, 1.33, -0.652); box(m, s * 0.858, 0.66, 0.36, s * 0.866, 1.33, 0.368); box(m, s * 0.858, 0.655, -0.66, s * 0.866, 0.663, 0.368); }
  P(m, 3);
  for (const s of [-1, 1]) {
    box(m, s * 0.862, 1.24, 0.2, s * 0.885, 1.255, 0.31);
    cyl(m, [s * 0.8, 1.6, -0.6], [s * 1.0, 1.66, -0.64], 0.01, 6); latheZ(m, [[0, -0.01], [0.06, -0.01], [0.065, 0], [0.06, 0.01], [0, 0.01]], 14, s * 1.02, 1.67, -0.64, 1);
    P(m, 12); box(m, s * 0.74, 0.88, 2.39, s * 0.84, 1.02, 2.42); P(m, 3);
  }
  P(m, 73); box(m, -0.155, 0.2, -2.6, 0.155, 0.34, -2.585); box(m, -0.155, 0.56, 2.42, 0.155, 0.72, 2.435); // California plates, 1957: yellow on black
  P(m, 3); latheZ(m, [[0, 0.015], [0.03, 0.01], [0.035, 0]], 12, 0, 1.0, -2.36, -1);
  P(m, 105); box(m, -0.73, 0.85, 0.7, 0.73, 0.86, 2.3);                                                  // bed floor, planks
  P(m, 42); for (const x of [-0.5, -0.17, 0.17, 0.5]) box(m, x - 0.012, 0.86, 0.7, x + 0.012, 0.866, 2.3); // and its steel strips
  // wheels: tyre (tread band round the outside, rounded sidewalls), whitewall ring, painted steel wheel, hubcap
  for (const s of [-1, 1]) for (const za of TRUCK_AX) {
    const cx = s * 0.75;
    P(m, 4); latheX(m, [[0.22, -0.105], [0.3, -0.11], [0.35, -0.104], [0.372, -0.085], [0.382, -0.06]], 40, cx, 0.39, za, s);
    latheX(m, [[0.382, -0.06], [0.386, 0], [0.382, 0.06]], 56, cx, 0.39, za, s, 52, 0.012);
    latheX(m, [[0.382, 0.06], [0.372, 0.085], [0.35, 0.104], [0.3, 0.11], [0.22, 0.105]], 40, cx, 0.39, za, s);
    P(m, 5); latheX(m, [[0.255, 0.112], [0.31, 0.114]], 36, cx, 0.39, za, s);
    P(m, 2); latheX(m, [[0.22, 0.1], [0.2, 0.09], [0.15, 0.085], [0.12, 0.09]], 30, cx, 0.39, za, s);
    P(m, 3); latheX(m, [[0.12, 0.09], [0.11, 0.105], [0.08, 0.125], [0.03, 0.135], [0, 0.136]], 24, cx, 0.39, za, s);
  }
  // in the bed: a tarp tied over gear, the spare tyre, a gas can
  P(m, 37); loft(m, [[0.75, 0, 0.86, 0.5, 0.05, 3], [0.85, 0, 0.98, 0.56, 0.18, 3], [1.2, 0.05, 1.05, 0.56, 0.24, 3], [1.6, -0.03, 1.02, 0.55, 0.2, 3], [1.85, 0, 0.94, 0.5, 0.11, 3], [1.92, 0, 0.86, 0.4, 0.04, 3]], 16);
  P(m, 18); for (const z of [0.95, 1.6]) cyl(m, [-0.6, 1.12, z], [0.6, 1.12, z], 0.009, 4, false);
  P(m, 4); { const n0 = m.p.length / 3; cyl(m, [0.33, 0, 0], [0.47, 0, 0], 0.33, 18); for (let k = n0 * 3; k < m.p.length; k += 3) { const x = m.p[k] - 0.4, y = m.p[k + 1]; m.p[k] = 0.45 + x * 0.94 + y * 0.34; m.p[k + 1] = 1.18 - x * 0.34 + y * 0.94; m.p[k + 2] += 1.72; } } // inside the bed (it ends at z 2.3)
  P(m, 11); box(m, -0.55, 0.86, 2.0, -0.38, 1.3, 2.28);
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
  for (const [t0, t1] of [[-0.6, -0.25], [0.2, 0.55]]) for (const [a0, a1] of [[0.12, 0.45], [PI - 0.45, PI - 0.12]]) { P(m, 3); patch(t0 - 0.015, t1 + 0.015, a0 - 0.03, a1 + 0.03, 0.007); P(m, 72); patch(t0, t1, a0, a1, 0.012); }
  P(m, 72); patch(-0.88, -0.76, 0.15, PI - 0.15, 0.012, 2, 12); // wraparound front window
  patch(0.86, 0.92, 1.2, PI - 1.2, 0.012, 2, 3);
  P(m, 3); patch(-0.97, 0.97, -0.03, 0.03, 0.016, 24, 1); patch(-0.97, 0.97, PI - 0.03, PI + 0.03, 0.016, 24, 1); // chrome belt line
  P(m, 7); patch(-0.12, 0.08, PI - 0.55, PI + 0.95, 0.02, 3, 6); // door (on the camp side)
  P(m, 21); box(m, -0.8, 0.3, 1.2, 0.8, 0.46, L - 1.2);
  for (const s of [-1, 1]) { P(m, 42); lathe(m, [[0, 0.5], [0.15, 0.52], [0.16, 0.6], [0.16, 0.86], [0.12, 0.94], [0.03, 0.97], [0, 0.97]], 16, s * 0.19, 0, -0.75); P(m, 31); cyl(m, [s * 0.19, 0.96, -0.75], [s * 0.19, 1.03, -0.75], 0.018, 8); }
  // wheels: tyres with whitewalls and small hubcaps, half hidden under rounded skirts in the body's side
  for (const s of [-1, 1]) {
    const cz = L * 0.55, cx = s * 0.9;
    P(m, 4); latheX(m, [[0.18, -0.09], [0.26, -0.095], [0.31, -0.085], [0.33, -0.05], [0.335, 0], [0.33, 0.05], [0.31, 0.085], [0.26, 0.095], [0.18, 0.09]], 40, cx, 0.335, cz, s, 44, 0.008);
    P(m, 5); latheX(m, [[0.22, 0.097], [0.27, 0.099]], 32, cx, 0.335, cz, s);
    P(m, 3); latheX(m, [[0.18, 0.09], [0.1, 0.1], [0.04, 0.115], [0, 0.118]], 20, cx, 0.335, cz, s);
    P(m, 7); { const g = []; for (let i = 0; i <= 12; i++) { const a = PI * i / 12, r = []; for (let j = 0; j <= 1; j++) r.push(m.v(s * (1.03 + 0.02 * j), 0.335 + cos(a) * 0.43, cz + sin(a - PI / 2) * 0.47)); g.push(r); } for (let i = 0; i < 12; i++) { m.quad(g[i][0], g[i + 1][0], g[i + 1][1], g[i][1]); m.quad(g[i][0], g[i][1], g[i + 1][1], g[i + 1][0]); } }
  }
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
  const sag = (u, v) => 0.07 * sin(PI * u) * sin(PI * v) * (0.7 + 0.3 * sin(PI * 3 * u));
  P(m, 8);
  for (const s of [-1, 1]) {
    const x = (u) => -W + 2 * W * u;
    if (s > 0) grid((u, v) => [x(u), v * (roofY(x(u)) + 0.06), D - sag(u, v) * 0.5], 12, 10); // back wall
    else { // front wall: two panels beside the door and the gable above it
      for (const k of [-1, 1]) grid((u, v) => { const xx = k * mix(0.52, W, u); return [xx, v * (roofY(xx) + 0.06), -D + sag(u, v) * 0.3]; }, 8, 10);
      grid((u, v) => { const xx = mix(-0.52, 0.52, u); return [xx, mix(1.86, roofY(xx) + 0.06, v), -D]; }, 8, 2);
    }
    grid((u, v) => [s * (W - sag(u, v)), v * HW, -D + 2 * D * u], 12, 6); // side walls
    grid((u, v) => { const z = -D - 0.12 + (2 * D + 0.24) * u, x = s * mix(W + 0.1, 0, v); return [x, mix(HW - 0.06, HR, v) - 0.06 * sin(PI * v) * (0.5 + 0.5 * sin(PI * 2 * u) ** 2) * min(1, sin(PI * u) * 3), z]; }, 14, 6); // roof
  }
  // door flaps: the left one rolled up beside the door, the right one hanging open
  m.tube([[-0.6, 0.15, -D - 0.11], [-0.58, 1.0, -D - 0.12], [-0.58, 1.86, -D - 0.11]], 0.065, 8, true); // clear of the wall, so it never pokes through
  grid((u, v) => { const a = 0.55 + 0.25 * (1 - v) * u, r = 0.56 * u, fo = 0.045 * sin(u * PI * 3.2) * (0.4 + 0.6 * (1 - v)); return [0.52 + r * cos(a) + fo * sin(a), 0.05 + v * 1.82 - 0.07 * u * u * v, -D - r * sin(a) + fo * cos(a) - 0.02 * sin(v * 7)]; }, 10, 14);
  P(m, 24); box(m, -W - 0.04, -0.05, -D - 0.02, W + 0.04, 0.035, D + 0.02); // groundsheet, tucked under the walls
  P(m, 10);
  cyl(m, [0, 0, D - 0.06], [0, HR + 0.12, D - 0.06], 0.025, 8); // back pole (the front of the ridge is held by the front rope)
  cyl(m, [0, HR - 0.02, -D + 0.06], [0, HR - 0.02, D - 0.06], 0.025, 8);
  // guy ropes to stakes: three a side from the eaves, one at each end from the ridge
  const rope = (a, b) => { P(m, 18); cyl(m, a, b, 0.007, 4, false); P(m, 104); box(m, b[0] - 0.02, -0.05, b[2] - 0.02, b[0] + 0.02, 0.18, b[2] + 0.02); };
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
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * TAU + rr(-0.25, 0.25), c = cos(a), s = sin(a), r = rr(0.045, 0.065), l = rr(0.4, 0.58), y = 0.06 + i % 2 * 0.07;
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
  P(m, 105);
  for (const s of [-1, 1]) {
    const x = s * 0.28;
    m.sweep([[x, 0, -0.25], [x, 0.46, 0.21]], 0.045, 0.045); m.sweep([[x, 0, 0.21], [x, 0.46, -0.25]], 0.045, 0.045);
    m.sweep([[x, 0.46, -0.27], [x, 0.46, 0.23]], 0.045, 0.045); m.sweep([[x, 0.67, -0.29], [x, 0.67, 0.23]], 0.07, 0.03);
    m.sweep([[x, 0.46, 0.22], [x, 0.95, 0.29]], 0.045, 0.045); m.sweep([[x, 0.46, -0.25], [x, 0.67, -0.25]], 0.04, 0.04);
  }
  P(m, 38);
  const g = []; for (let i = 0; i <= 6; i++) { const r = []; for (let j = 0; j <= 4; j++) { const u = i / 6, v = j / 4; r.push(m.v(-0.26 + 0.52 * u, 0.455 - 0.05 * sin(PI * u) * sin(PI * v), -0.24 + 0.45 * v)); } g.push(r); }
  for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) { m.quad(g[i][j], g[i + 1][j], g[i + 1][j + 1], g[i][j + 1]); m.quad(g[i][j], g[i][j + 1], g[i + 1][j + 1], g[i + 1][j]); }
  box(m, -0.27, 0.66, 0.25, 0.27, 0.9, 0.27);
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
// folding wooden camp table with a portable shortwave radio and a two-burner camp stove (front toward -x)
function meshTable() {
  const m = new Mesh();
  P(m, 105); box(m, -0.3, 0.69, -0.62, 0.3, 0.73, 0.62);
  for (const s of [-1, 1]) { m.sweep([[-0.26, 0, s * 0.55], [0.26, 0.69, s * 0.55]], 0.03, 0.03); m.sweep([[0.26, 0, s * 0.55], [-0.26, 0.69, s * 0.55]], 0.03, 0.03); }
  // the newspaper (in PAPERS) is held down by a flat stone
  put(m, stone(7), 0.05, 0.752, 0.04, 0.5, [0.07, 0.035, 0.06]);
  // radio: black leatherette case, brass trim, a dial and a speaker grille on the front (toward the fire), aerial up
  P(m, 30); box(m, -0.1, 0.73, 0.18, 0.1, 0.99, 0.6);
  P(m, 31); box(m, -0.106, 0.75, 0.2, -0.1, 0.97, 0.58); box(m, -0.02, 0.99, 0.34, 0.02, 1.01, 0.44);
  P(m, 32); box(m, -0.111, 0.89, 0.23, -0.106, 0.95, 0.55);
  P(m, 34); for (let y = 0.77; y < 0.87; y += 0.018) box(m, -0.112, y, 0.24, -0.106, y + 0.008, 0.54);
  P(m, 42); cyl(m, [0.06, 0.99, 0.54], [0.044, 1.27, 0.556], 0.0045, 8, false); cyl(m, [0.044, 1.27, 0.556], [0.02, 1.7, 0.58], 0.003, 8, false); // telescoping aerial, dull steel (chrome strobed as a glowing hairline)
  P(m, 3); for (const z of [0.28, 0.48]) cyl(m, [-0.111, 0.92, z], [-0.135, 0.92, z], 0.016, 10);
  // camp stove: green enamel box, lid up behind with wind wings, two burners, the fuel tank in front
  P(m, 35); box(m, -0.13, 0.73, -0.6, 0.13, 0.84, -0.18); box(m, 0.13, 0.84, -0.6, 0.145, 1.1, -0.18);
  for (const z of [-0.6, -0.18]) box(m, -0.13, 0.84, z - 0.005, 0.13, 1.0, z + 0.005);
  P(m, 34); for (const z of [-0.49, -0.29]) cyl(m, [0, 0.84, z], [0, 0.85, z], 0.06, 12);
  P(m, 3); cyl(m, [-0.15, 0.78, -0.55], [-0.15, 0.78, -0.23], 0.035, 12);
  return m;
}
// 1950s amateur refractor: white tube on an equatorial head and a wooden tripod, aimed up at the eastern sky
function meshTelescope() {
  const m = new Mesh(), hy = 1.12;
  P(m, 104); for (let i = 0; i < 3; i++) { const a = i / 3 * TAU + 0.3; m.sweep([[0, hy - 0.05, 0], [cos(a) * 0.5, 0, sin(a) * 0.5]], 0.025, 0.02); }
  P(m, 34); cyl(m, [0, hy - 0.08, 0], [0, hy + 0.05, 0], 0.05, 12); box(m, -0.05, hy + 0.04, -0.06, 0.05, hy + 0.12, 0.06);
  cyl(m, [0, hy + 0.08, 0], [0.15, hy - 0.08, -0.1], 0.012, 6); disc(m, [0.15, hy - 0.08, -0.1], [0.15, -0.16, -0.1], 0.05, 12); // counterweight
  const d = [-0.3, 0.62, 0.72], l = hypot(...d); for (let k = 0; k < 3; k++) d[k] /= l;
  const p = (t, o = 0) => [d[0] * t, hy + 0.13 + d[1] * t + o, d[2] * t];
  P(m, 23); cyl(m, p(-0.5), p(0.62), 0.045, 16);
  P(m, 34); cyl(m, p(0.6), p(0.82), 0.052, 16, false); cyl(m, p(-0.5), p(-0.6), 0.025, 10); cyl(m, p(-0.6), [p(-0.6)[0], p(-0.6)[1] + 0.06, p(-0.6)[2] - 0.03], 0.016, 8);
  P(m, 23); cyl(m, p(-0.1, 0.075), p(0.2, 0.075), 0.015, 8);
  // dew shield, rings, the focuser and a star diagonal with its eyepiece, the finder's brackets
  P(m, 34); cyl(m, p(0.5), p(0.6), 0.054, 16, false); for (const t of [-0.3, 0.2]) cyl(m, p(t - 0.012), p(t + 0.012), 0.05, 16);
  P(m, 3); cyl(m, p(-0.6), p(-0.68), 0.017, 10); P(m, 34); { const e = p(-0.7); cyl(m, e, [e[0] + 0.04, e[1] + 0.03, e[2] - 0.02], 0.016, 10); cyl(m, [e[0] + 0.04, e[1] + 0.03, e[2] - 0.02], [e[0] + 0.04, e[1] + 0.09, e[2] - 0.02], 0.012, 10); }
  P(m, 3); for (const t of [-0.05, 0.15]) cyl(m, p(t, 0.045), p(t, 0.07), 0.004, 6);
  P(m, 34); box(m, -0.04, hy + 0.12, -0.03, 0.04, hy + 0.16, 0.03); cyl(m, [0, hy - 0.3, 0], [0, hy - 0.08, 0], 0.012, 8);
  return m;
}
// inside the tent: a rumpled sleeping bag turned back, a pillow, the tape recorder on a crate, and photos and newspaper
// clippings pinned to the canvas (tent coordinates: door at -z, back wall at z = 1.8, side walls at x = +-1.5)
function meshTentInside() {
  const m = new Mesh(); rseed(470);
  P(m, 25); loft(m, [[-1.05, 0.95, 0.04, 0.3, 0.03, 3], [-0.95, 0.95, 0.08, 0.36, 0.07, 3], [-0.6, 0.97, 0.1, 0.38, 0.09, 3], [-0.25, 0.92, 0.12, 0.4, 0.11, 3],
    [0.1, 0.96, 0.09, 0.39, 0.08, 3], [0.4, 0.95, 0.06, 0.37, 0.05, 3], [0.55, 0.95, 0.04, 0.37, 0.03, 3]], 18);
  // the top turned back at the head, plaid lining up
  P(m, 26); const g = []; for (let i = 0; i <= 5; i++) { const r = []; for (let j = 0; j <= 4; j++) { const u = i / 5, v = j / 4; r.push(m.v(0.58 + 0.76 * v + 0.02 * sin(u * 9), 0.1 + 0.05 * sin(PI * u) + 0.02 * sin(v * 11 + u * 5), 0.45 + 0.5 * u)); } g.push(r); }
  for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) { m.quad(g[i][j], g[i + 1][j], g[i + 1][j + 1], g[i][j + 1]); m.quad(g[i][j], g[i][j + 1], g[i + 1][j + 1], g[i + 1][j]); }
  P(m, 27); loft(m, [[1.0, 0.95, 0.06, 0.2, 0.02, 2.5], [1.06, 0.95, 0.1, 0.27, 0.07, 2.5], [1.32, 0.95, 0.11, 0.28, 0.08, 2.5], [1.38, 0.95, 0.07, 0.22, 0.03, 2.5]], 14);
  // crate and tape recorder (lid open against the wall, two reels of brown tape)
  P(m, 103); box(m, -1.38, 0, 1.1, -0.92, 0.36, 1.62);
  P(m, 30); box(m, -1.32, 0.36, 1.18, -0.98, 0.5, 1.5); box(m, -1.32, 0.5, 1.52, -0.98, 0.78, 1.55);
  P(m, 42); box(m, -1.31, 0.5, 1.19, -0.99, 0.505, 1.49);
  for (const x of [-1.24, -1.06]) { P(m, 36); cyl(m, [x, 0.505, 1.33], [x, 0.52, 1.33], 0.07, 18); P(m, 42); cyl(m, [x, 0.52, 1.33], [x, 0.525, 1.33], 0.02, 8); }
  P(m, 31); for (let i = 0; i < 4; i++) box(m, -1.28 + i * 0.05, 0.5, 1.2, -1.25 + i * 0.05, 0.52, 1.23);
  // the photographs and clippings pinned to the canvas are in PAPERS (paper.js)
  return m;
}
function meshCamp() {
  const m = new Mesh();
  put(m, meshFire(), 0, 0, 0);
  put(m, meshTent(), 1, 0, 7.5); put(m, meshTentInside(), 1, 0, 7.5);
  put(m, meshTable(), 3.4, 0, -0.9, 0.25);
  put(m, meshTelescope(), -3.6, 0, 3.9, 0);
  // on the cooler lid: an enamel mug, binoculars and the observer's logbook
  P(m, 20); lathe(m, [[0, 0], [0.04, 0], [0.042, 0.09], [0.038, 0.09], [0.036, 0.005], [0, 0.005]], 14, 2.15, 0.4, 2.45);
  P(m, 34); for (const s of [-1, 1]) cyl(m, [2.42 + s * 0.035, 0.44, 2.3], [2.42 + s * 0.035, 0.44, 2.45], 0.027, 10);
  P(m, 39); box(m, 2.25, 0.4, 2.48, 2.45, 0.415, 2.62);
  // shovel stuck in the sand by the woodpile, a galvanised bucket and a green tackle box by the tent
  P(m, 104); cyl(m, [-3.75, 0.1, -3.5], [-3.62, 1.0, -3.42], 0.018, 6); P(m, 42); box(m, -3.85, -0.15, -3.56, -3.67, 0.12, -3.48);
  P(m, 42); lathe(m, [[0, 0], [0.12, 0], [0.15, 0.27], [0.155, 0.28], [0.145, 0.28], [0.11, 0.01], [0, 0.01]], 18, -2.15, 0, 6.05);
  P(m, 11); box(m, -2.65, 0, 5.85, -2.3, 0.2, 6.12); P(m, 3); box(m, -2.5, 0.2, 5.97, -2.45, 0.24, 6.0);
  put(m, meshTruck(), 8, 0, -4.2);
  put(m, meshTrailer(), 8, 0, -4.2 + 2.64 + 1.32);
  put(m, meshCooler(), 2.3, 0, 2.4, 0.4);
  // the park's picnic table with the observer's papers, every sheet of paper, the camera on its tripod, the park sign
  put(m, meshPicnic(), PICNIC[0], 0, PICNIC[1]);
  paperSheets(m);
  put(m, meshCameraTripod(), CAMERA[0], 0, CAMERA[1]);
  // firewood stacked by the fire
  rseed(450); P(m, 108);
  for (let i = 0; i < 9; i++) { const l = rr(0.6, 0.85), r = rr(0.05, 0.075), y = r + (i / 3 | 0) * 0.12, x0 = -3.1 + i % 3 * 0.17 + (i / 3 | 0) * 0.08; cyl(m, [x0, y, -2.9], [x0 + rr(-0.1, 0.1), y, -2.9 + l], r, 7); }
  // duffel bag and a jerry can
  P(m, 17); m.tube([[2.5, 0.16, 5.0], [2.6, 0.17, 5.2], [2.95, 0.17, 5.5], [3.05, 0.16, 5.62]], (k) => [0.1, 0.17, 0.17, 0.1][k], 12, true);
  P(m, 19); box(m, 5.75, 0, 1.0, 5.92, 0.47, 1.45); for (const z of [1.14, 1.22, 1.3]) box(m, 5.81, 0.47, z, 5.86, 0.52, z + 0.03); cyl(m, [5.835, 0.44, 1.04], [5.835, 0.53, 1.0], 0.022, 8);
  return m;
}
// tubular kerosene hurricane lantern of the 1950s (Dietz style), red paint and tin, origin at the flame:
// a wide flat fount at the bottom, the burner, a clear pear-shaped globe inside a wire guard, two air tubes up the sides
// to the top chamber with its ventilated cap, and the wire bail
function meshLantern() {
  const m = new Mesh();
  P(m, 40); lathe(m, [[0, -0.175], [0.075, -0.175], [0.09, -0.168], [0.094, -0.155], [0.09, -0.13], [0.07, -0.118], [0.035, -0.112], [0.03, -0.1]], 24); // fount
  P(m, 42); lathe(m, [[0.03, -0.1], [0.034, -0.09], [0.034, -0.082], [0.028, -0.078]], 16); cyl(m, [0.035, -0.095, 0], [0.06, -0.095, 0], 0.004, 6); // burner, wick knob
  P(m, 41); lathe(m, [[0.028, -0.078], [0.045, -0.06], [0.056, -0.025], [0.057, 0.005], [0.05, 0.04], [0.036, 0.065], [0.03, 0.072]], 22); // globe
  P(m, 42);
  for (let i = 0; i < 4; i++) { const a = i / 4 * TAU + PI / 4, c = cos(a), s2 = sin(a); m.tube([[c * 0.034, -0.08, s2 * 0.034], [c * 0.063, -0.02, s2 * 0.063], [c * 0.062, 0.01, s2 * 0.062], [c * 0.04, 0.066, s2 * 0.04]], 0.0022, 4, false); } // guard wires
  for (const [y, r] of [[-0.02, 0.064], [0.03, 0.058]]) { const ring = []; for (let i = 0; i <= 16; i++) ring.push([cos(i / 16 * TAU) * r, y, sin(i / 16 * TAU) * r]); m.tube(ring, 0.0022, 4, false); }
  P(m, 40); lathe(m, [[0.03, 0.072], [0.07, 0.078], [0.076, 0.09], [0.07, 0.105], [0.045, 0.118], [0.03, 0.122]], 22); // top chamber
  P(m, 42); lathe(m, [[0.03, 0.122], [0.032, 0.135], [0.022, 0.145], [0, 0.148]], 14); // ventilated cap
  P(m, 40); for (const sd of [-1, 1]) m.tube([[sd * 0.088, -0.125, 0], [sd * 0.098, -0.07, 0], [sd * 0.098, 0.03, 0], [sd * 0.085, 0.09, 0], [sd * 0.06, 0.1, 0]], 0.0075, 8, true); // air tubes
  P(m, 42); const bail = []; for (let i = 0; i <= 12; i++) { const a = i / 12 * PI; bail.push([cos(a) * 0.1, 0.07 + sin(a) * 0.15, 0]); } m.tube(bail, 0.003, 4, false);
  // clip-on tin reflector: a polished half drum behind the globe (on your side), on two wire clips
  P(m, 42); { const g = []; for (let i = 0; i <= 10; i++) { const a = PI * (0.08 + 0.84 * i / 10), r = []; for (let j = 0; j <= 3; j++) r.push(m.v(-cos(a) * 0.085, -0.075 + j * 0.028, sin(a) * 0.085)); g.push(r); }
    for (let i = 0; i < 10; i++) for (let j = 0; j < 3; j++) { m.quad(g[i][j], g[i + 1][j], g[i + 1][j + 1], g[i][j + 1]); m.quad(g[i][j], g[i][j + 1], g[i + 1][j + 1], g[i + 1][j]); } }
  P(m, 42); for (const y of [-0.06, 0.0]) cyl(m, [0, y, 0.058], [0, y, 0.086], 0.002, 4, false);
  return m;
}
// your gloved hand round the top of the lantern's bail (same origin as the lantern), drawn only while you hold it:
// a leather work glove, the wrist and the cuff of a dark wool shirt, going back toward you
function meshHand() {
  const m = new Mesh();
  P(m, 43);
  put(m, tag(icosphere(1, (x, y, z) => [x * 0.048, y * 0.034, z * 0.04]), 43), 0, 0.235, 0.012);
  for (let i = 0; i < 4; i++) cyl(m, [-0.03 + i * 0.02, 0.212, -0.018], [-0.03 + i * 0.02, 0.244, -0.034], 0.0105, 6);
  cyl(m, [0.004, 0.245, 0.03], [0.012, 0.29, 0.1], 0.03, 10);
  P(m, 44); cyl(m, [0.011, 0.285, 0.09], [0.02, 0.32, 0.17], 0.04, 12);
  return m;
}
