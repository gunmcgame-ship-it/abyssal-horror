// ============================================================================
// M3: the 1870s settlement (nine roofless dry-stone homes), its supper stages, the traces of later visitors,
// and the new camp pieces (park picnic table with the papers, the camera on its tripod, the park sign)
// ============================================================================
// the settlement's middle, and the nine homes: x, z (world) and state (0 still standing to the eaves, 1 broken down,
// 2 little more than footings). Houses face roughly toward the middle.
const RUINC = [-50, -85];
const RUINS = [[-58, -93, 0], [-61, -85, 1], [-57, -76, 2], [-48, -75, 0], [-39, -80, 1], [-41, -90, 0], [-49, -94, 1], [-50, -84, 2], [-33, -87, 1]];
// mesh ids (see main.js): 26..29 building stones (rock-shaded instances), 30 the rest of the ruins (world coordinates),
// 31..33 the supper stages' small things (drawn from stage 1, 2, 3 on), 34 the traces of later visitors, 35..38 the
// building stones in low detail; then single objects placed as instances, so their wood grain follows them:
// 39, 40 roof logs (whole, broken), 41 a hewn lintel, 42 a board, 43 an old table and 44 a bench (stage 1), 45 an iron stove,
// 46 the park sign, 47 the trail marker
const RUIN_STONE = 26, RUIN_MESH = 30, RUIN_STAGE = 31, TRACE_MESH = 34;
const W_LOG = 39, W_BEAM = 41, W_BOARD = 42, W_TABLE = 43, W_BENCH = 44, W_STOVE = 45, W_SIGN = 46, W_MARKER = 47, SOLN = 48;
const LOG_L = 3.6; // the length of the log meshes at scale 1
const TRACE = [[14, 42, 2.4], [12.6, 41.3, 0.6], [-14, -80, 1.2], [-28, -85, 0.6]]; // keep plants and rocks off these (x, z, r)
// wood part ids (paper.js woodPM): grain along local x, y, z; 100.. silver grey, 103.. brown stained
const WOOD = { gx: 100, gy: 101, gz: 102, bx: 103, by: 104, bz: 105, log: 106, beam: 107 };

// a dry-laid building stone: a block of sandstone split out of a bed, its faces roughly square to each other but
// uneven, the edges and corners broken round, a few spalls off. A distance field (the split faces blended with a smooth
// maximum, the faces displaced by noise) meshed with surface nets; about 1.2 lx long, 1.04 ly high, 1.25 deep
const BLOCKV = [[0.85, 0.62], [1.15, 0.55], [1.6, 0.5], [0.95, 0.85]];
function meshBlock(sd, sub = 2) {
  const [lx, ly] = BLOCKV[sd - 1], lz = 1.25;
  rseed(700 + sd);
  const pl = [[rr(-0.1, 0.1), 1, rr(-0.1, 0.1), ly * rr(0.46, 0.54)], [rr(-0.1, 0.1), -1, rr(-0.08, 0.08), ly * rr(0.5, 0.54)]];
  for (let i = 0; i < 4; i++) { const a = i / 4 * TAU + rr(-0.28, 0.28), t = rr(-0.18, 0.18); pl.push([cos(a), t, sin(a), rr(0.46, 0.58) * (i % 2 ? lz : lx)]); }
  for (let i = 0; i < 3; i++) { const a = (rnd() * 4 | 0) / 4 * TAU + PI / 4 + rr(-0.3, 0.3); pl.push([cos(a), rr(-0.25, 0.25), sin(a), rr(0.55, 0.7) * Math.SQRT1_2 * (lx + lz)]); }
  for (let i = 0; i < 3; i++) { const a = rnd() * TAU, b = rnd() < 0.5 ? 1 : -1; pl.push([cos(a), b, sin(a), rr(0.55, 0.7) * (abs(cos(a)) * lx + abs(sin(a)) * lz + ly) / 2 * Math.SQRT2]); }
  const P2 = pl.map(([a, b, c, o]) => { const l = hypot(a, b, c); return [a / l, b / l, c / l, o / l]; }), k = 0.06 * min(lx, ly);
  const f = (x, y, z) => {
    let d = x * P2[0][0] + y * P2[0][1] + z * P2[0][2] - P2[0][3];
    for (let i = 1; i < P2.length; i++) d = smax(d, x * P2[i][0] + y * P2[i][1] + z * P2[i][2] - P2[i][3], k);
    return d + 0.035 * min(lx, ly) * (fbm(x * 2.4 + sd, y * 2.4, z * 2.4, 3) - 0.5) * 2 + 0.008 * (fbm(x * 9 + sd * 3, y * 9, z * 9, 2) - 0.5) * 2;
  };
  const R = 0.62 * max(lx, ly, lz) + 0.05, res = LV > 1 || sub < 2 ? 0.15 : 0.075;
  return sdfMesh(f, () => 0, -R, -R, -R, R, R, R, res);
}
// every triangle its own corners, so split faces shade flat with crisp edges
function unweld(m) { const o = new Mesh(); for (let t = 0; t < m.i.length; t += 3) { const A = m.i[t] * 3, B = m.i[t + 1] * 3, C = m.i[t + 2] * 3, P0 = m.p; const ux = P0[B] - P0[A], uy = P0[B + 1] - P0[A + 1], uz = P0[B + 2] - P0[A + 2], vx = P0[C] - P0[A], vy = P0[C + 1] - P0[A + 1], vz = P0[C + 2] - P0[A + 2]; if (hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) < 1e-6) continue; const v = [0, 1, 2].map((k) => { const j = m.i[t + k]; o.aux.push(m.aux[j]); o.p.push(m.p[j * 3], m.p[j * 3 + 1], m.p[j * 3 + 2]); return o.p.length / 3 - 1; }); o.tri(v[0], v[1], v[2]); } return o; }
// an oriented box: centre, a horizontal axis (ux, uz), half sizes along it, up and across; roll tips the axis up (radians)
function obb(m, cx, cy, cz, ux, uz, hu, hv, ht, roll = 0) {
  const cr = cos(roll), sr = sin(roll), U = [ux * cr, sr, uz * cr], V = [-ux * sr, cr, -uz * sr], T = [-uz, 0, ux];
  const C = (a, b, d) => m.v(cx + U[0] * a * hu + V[0] * b * hv + T[0] * d * ht, cy + U[1] * a * hu + V[1] * b * hv + T[1] * d * ht, cz + U[2] * a * hu + V[2] * b * hv + T[2] * d * ht);
  const f = (p, q, r, s) => m.quad(C(...p), C(...q), C(...r), C(...s));
  f([-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1]); f([-1, -1, 1], [-1, 1, 1], [1, 1, 1], [1, -1, 1]);
  f([-1, -1, -1], [-1, 1, -1], [-1, 1, 1], [-1, -1, 1]); f([1, -1, -1], [1, -1, 1], [1, 1, 1], [1, 1, -1]);
  f([-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]); f([-1, -1, -1], [-1, -1, 1], [1, -1, 1], [1, -1, -1]);
}
// a rough-sawn or hewn timber along local z: sections with uneven width and height, slightly bent, eased edges
function timber(m, part, z0, z1, w, h, n = 8, rough = 0.12, cx = 0, cy = 0) {
  P(m, part); const secs = [], s0 = rnd() * 10;
  for (let k = 0; k <= n; k++) { const t = k / n, f = (fbm(t * 3 + s0, s0, 0, 2) - 0.5) * rough; secs.push([z0 + (z1 - z0) * t, cx + f * w * 0.3, cy + sin(t * PI) * h * 0.05 + f * h * 0.2, w * (1 + f), h * (1 - f * 0.6), 7]); }
  loft(m, secs, 16);
}
// a weathered roof log (a viga) along local x from 0 to LOG_L: knotty uneven section, deep drying checks, a sawn end at
// 0 and (broken: true) a splintered end at LOG_L
function meshLog(broken) {
  rseed(760 + (broken ? 1 : 0));
  const m = new Mesh(), nL = 26, nA = 16, R = 0.125, rings = [];
  const checks = [rr(0, TAU), rr(0, TAU), rr(0, TAU), rr(0, TAU)], knots = []; for (let i = 0; i < 7; i++) knots.push([rr(0.08, 0.92), rr(0, TAU)]);
  P(m, WOOD.log);
  for (let i = 0; i <= nL; i++) {
    const t = i / nL, x = t * LOG_L, ring = [];
    for (let j = 0; j < nA; j++) {
      const a = j / nA * TAU;
      let r = R * (1.06 - 0.26 * t) * (1 + (fbm(t * 6, a * 0.8, 3, 2) - 0.5) * 0.24 + 0.06 * sin(a * 2 + t * 3));
      for (const ca of checks) { const tw = ca + t * 1.4, d = abs(((a - tw + PI) % TAU + TAU) % TAU - PI); r *= 1 - 0.22 * Math.exp(-d * d * 260) * sstep(0.04, 0.2, t) * sstep(0.99, 0.75, t); }
      for (const [kt, ka] of knots) { const d = abs(((a - ka + PI) % TAU + TAU) % TAU - PI), dt = (t - kt) * LOG_L; r *= 1 + 0.18 * Math.exp(-(d * d * 30 + dt * dt * 200)); }
      let xx = x;
      if (broken && i === nL) xx -= rr(0, 0.22) * (0.5 + 0.5 * sin(a * 3 + 1));
      ring.push(m.v(xx, r * sin(a), r * cos(a)));
    }
    rings.push(ring);
  }
  for (let i = 0; i < nL; i++) for (let j = 0; j < nA; j++) { const j2 = (j + 1) % nA; m.quad(rings[i][j], rings[i][j2], rings[i + 1][j2], rings[i + 1][j]); }
  for (const [i, s] of [[0, -1], [nL, 1]]) { const c = m.v(i === nL && broken ? LOG_L - 0.12 : i / nL * LOG_L, 0, 0); for (let j = 0; j < nA; j++) { const j2 = (j + 1) % nA; s > 0 ? m.tri(rings[i][j], rings[i][j2], c) : m.tri(rings[i][j2], rings[i][j], c); } }
  return m;
}
// a hewn lintel beam along local z, 1.5 m, and a weathered board along local z, 1.6 m
function meshBeam() { const m = new Mesh(); rseed(770); timber(m, WOOD.beam, -0.75, 0.75, 0.25, 0.085, 12, 0.22); return m; }
function meshBoard() { const m = new Mesh(); rseed(771); timber(m, WOOD.gz, -0.8, 0.8, 0.1, 0.013, 10, 0.12); return m; }

// ---------------------------------------------------------------- 1870s things
// a small cast-iron box stove: body on four bowed legs, a fire door with a latch, two lids on top, the flue collar
function meshStove() {
  const m = new Mesh();
  P(m, 47);
  box(m, -0.3, 0.18, -0.22, 0.3, 0.6, 0.22);
  box(m, -0.33, 0.6, -0.25, 0.33, 0.645, 0.25); box(m, -0.31, 0.165, -0.235, 0.31, 0.19, 0.235);
  for (const y of [0.3, 0.42, 0.52]) box(m, -0.305, y, -0.225, 0.305, y + 0.012, 0.225);                              // cast ribs
  for (const x of [-0.15, 0.13]) { cyl(m, [x, 0.645, -0.02], [x, 0.657, -0.02], 0.088, 14); box(m, x - 0.03, 0.657, -0.025, x + 0.03, 0.664, -0.015); }
  box(m, -0.19, 0.25, -0.236, 0.11, 0.5, -0.222); box(m, -0.205, 0.235, -0.228, 0.125, 0.515, -0.22);
  for (let i = 0; i < 4; i++) box(m, -0.16 + i * 0.065, 0.27, -0.24, -0.13 + i * 0.065, 0.3, -0.236);              // draft slots
  cyl(m, [0.09, 0.37, -0.24], [0.09, 0.37, -0.27], 0.012, 6); box(m, 0.06, 0.36, -0.275, 0.15, 0.38, -0.265);
  for (const y of [0.28, 0.47]) cyl(m, [-0.205, y, -0.235], [-0.205, y + 0.04, -0.235], 0.012, 6);
  for (let i = 0; i < 4; i++) { const sx = i & 1 ? 1 : -1, sz = i & 2 ? 1 : -1; m.tube([[sx * 0.26, 0.19, sz * 0.18], [sx * 0.3, 0.1, sz * 0.21], [sx * 0.29, 0, sz * 0.2]], 0.024, 6, true); }
  box(m, -0.24, 0.165, -0.33, 0.24, 0.18, -0.22);
  cyl(m, [0.12, 0.645, 0.12], [0.12, 0.72, 0.12], 0.065, 12, false);
  return m;
}
// a sawn-plank table on two trestles (top 1.24 x 0.76, long side along x) and a bench, silver-grey with age
function meshOldTable() {
  const m = new Mesh(); rseed(780);
  for (let i = 0; i < 3; i++) { const z = -0.25 + i * 0.25; P(m, WOOD.gx); obb(m, rr(-0.01, 0.01), 0.73, z, 1, 0, 0.62, 0.022, 0.118, rr(-0.008, 0.008)); }
  for (const s of [-1, 1]) {
    for (const t of [-1, 1]) { P(m, WOOD.gy); obb(m, s * 0.48, 0.355, t * 0.2, 1, 0, 0.028, 0.355, 0.035, 0); }
    P(m, WOOD.gz); obb(m, s * 0.48, 0.68, 0, 1, 0, 0.032, 0.03, 0.33, 0); obb(m, s * 0.48, 0.12, 0, 1, 0, 0.03, 0.025, 0.3, 0);
  }
  P(m, WOOD.gx); obb(m, 0, 0.14, 0, 1, 0, 0.5, 0.02, 0.03, 0);
  return m;
}
function meshBench() {
  const m = new Mesh(); rseed(781);
  P(m, WOOD.gx); obb(m, 0, 0.44, 0, 1, 0, 0.56, 0.022, 0.12, rr(-0.01, 0.01));
  P(m, WOOD.gy); for (const s of [-1, 1]) obb(m, s * 0.45, 0.21, 0, 1, 0, 0.026, 0.21, 0.1, 0);
  return m;
}
// graniteware: a plate, a cup with a handle; an ironstone pitcher; a stew pot; a helping of beans and meat; a loaf
function meshPlate() { const m = new Mesh(); P(m, 49); lathe(m, [[0, 0.002], [0.06, 0.002], [0.075, 0.012], [0.112, 0.024], [0.118, 0.026], [0.114, 0.028], [0.07, 0.016], [0, 0.014]], 22); return m; }
function meshCup() { const m = new Mesh(); P(m, 49); lathe(m, [[0, 0], [0.038, 0], [0.042, 0.075], [0.046, 0.078], [0.04, 0.078], [0.036, 0.006], [0, 0.006]], 16); m.tube([[0.044, 0.062, 0], [0.068, 0.058, 0], [0.07, 0.03, 0], [0.044, 0.022, 0]], 0.006, 5, false); return m; }
function meshPitcher() { const m = new Mesh(); P(m, 48); lathe(m, [[0, 0], [0.06, 0], [0.075, 0.06], [0.07, 0.15], [0.055, 0.2], [0.062, 0.23], [0.058, 0.232], [0.05, 0.2], [0, 0.19]], 20); m.tube([[0.06, 0.2, 0], [0.11, 0.19, 0], [0.11, 0.08, 0], [0.072, 0.06, 0]], 0.009, 6, false); return m; }
function meshPot() { const m = new Mesh(); P(m, 47); lathe(m, [[0, 0], [0.1, 0], [0.13, 0.04], [0.135, 0.12], [0.14, 0.13], [0.13, 0.135], [0.12, 0.13], [0, 0.125]], 20); m.tube([[-0.13, 0.12, 0], [-0.09, 0.26, 0], [0.09, 0.26, 0], [0.13, 0.12, 0]], 0.005, 5, false); return m; }
function meshFood() {
  const m = new Mesh(); P(m, 51); lathe(m, [[0, 0.026], [0.04, 0.022], [0.07, 0.014], [0.08, 0.011]], 14);
  for (let i = 0; i < 16; i++) { const a = rnd() * TAU, r = sqrt(rnd()) * 0.06; put(m, tag(icosphere(0, (x, y, z) => [x * 0.011, y * 0.007, z * 0.008]), 51), cos(a) * r, 0.026 - r * 0.2, sin(a) * r, rnd() * TAU); }
  return m;
}
function meshLoaf() { return tag(icosphere(2, (x, y, z) => [x * 0.11 * (1 + 0.06 * sin(z * 20)), max(y, -0.2) * 0.07 + 0.012, z * 0.065]), 53); }

// ---------------------------------------------------------------- the camp's new pieces (camp coords; the camp mesh is
// not turned, so the picnic table's grain can use the camp's own axes)
// park picnic table: heavy brown-stained planks, A-frame legs, seats both sides, long side along z
function meshPicnic() {
  const m = new Mesh(), T = PICNIC[2]; rseed(790);
  P(m, WOOD.bz); for (let i = 0; i < 5; i++) box(m, -0.38 + i * 0.155, T - 0.045, -0.92 + rr(-0.01, 0.01), -0.38 + i * 0.155 + 0.146, T, 0.92 + rr(-0.01, 0.01));
  for (const s of [-1, 1]) {
    P(m, WOOD.bz); for (let i = 0; i < 2; i++) { const x = s * (0.62 + i * 0.13); box(m, x - 0.058, 0.42, -0.92, x + 0.058, 0.465, 0.92); }
    for (const z of [-0.62, 0.62]) { const fx = s * 0.75, tx = s * 0.22, dx = tx - fx, dy = T - 0.045, l = hypot(dx, dy); P(m, WOOD.by); obb(m, (fx + tx) / 2, dy / 2, z, Math.sign(dx), 0, l / 2, 0.055, 0.022, atan2(dy, abs(dx))); }
  }
  P(m, WOOD.bx); for (const z of [-0.62, 0.62]) { box(m, -0.9, 0.365, z + 0.028, 0.9, 0.42, z + 0.072); box(m, -0.38, T - 0.09, z + 0.028, 0.38, T - 0.045, z + 0.072); }
  P(m, 34); for (const s of [-1, 1]) for (const z of [-0.62, 0.62]) { cyl(m, [s * 0.66, 0.39, z + 0.072], [s * 0.66, 0.39, z + 0.08], 0.011, 6); cyl(m, [s * 0.28, T - 0.068, z + 0.072], [s * 0.28, T - 0.068, z + 0.08], 0.011, 6); }
  return m;
}
// every sheet in PAPERS: a gently curled grid on both sides; pinned ones bow a little and their bottom corners lift, with a tack
function paperSheets(m) {
  PAPERS.forEach((S, i) => {
    rseed(600 + i);
    const n = [S.u[1] * S.v[2] - S.u[2] * S.v[1], S.u[2] * S.v[0] - S.u[0] * S.v[2], S.u[0] * S.v[1] - S.u[1] * S.v[0]];
    const c1 = rr(0.6, 1.4), c2 = rr(-1, 1), nu = 12, nv = 12, g = [], gb = [];
    const at = (u, v, back) => {
      let lift;
      const k = S.kind === 4 ? 0.35 : S.kind === 3 ? 0.55 : 1;
      if (S.flat) lift = (S.kind <= 1 ? 0.0002 : 0) + k * (0.0042 * c1 * (u ** 4 + v ** 4) + 0.0016 * c2 * u * v + 0.0009 * sin(u * 5 + c2 * 3) * v * v) + (S.kind >= 6 ? 0.004 * (1 - u * u) - 0.006 * sstep(0.7, 1, S.kind === 6 ? u : -u) : 0) + (S.kind <= 1 ? 0.0028 * Math.exp(-u * u * 60) + 0.002 * sstep(0.7, 1, -v) : 0);
      else lift = 0.0015 * (1 - v * v) * c1 + 0.005 * sstep(-0.2, -1, v) * u * u + 0.001 * sin(u * 6 + c2) * (1 - v);
      lift -= back ? 0.0004 : 0;
      return [S.o[0] + S.u[0] * u * S.h[0] + S.v[0] * v * S.h[1] + n[0] * lift, S.o[1] + S.u[1] * u * S.h[0] + S.v[1] * v * S.h[1] + n[1] * lift, S.o[2] + S.u[2] * u * S.h[0] + S.v[2] * v * S.h[1] + n[2] * lift];
    };
    P(m, PAPER0 + i);
    for (let a = 0; a <= nu; a++) { const r = [], rb = []; for (let b = 0; b <= nv; b++) { const u = a / nu * 2 - 1, v = b / nv * 2 - 1; r.push(m.v(...at(u, v, false))); rb.push(m.v(...at(u, v, true))); } g.push(r); gb.push(rb); }
    for (let a = 0; a < nu; a++) for (let b = 0; b < nv; b++) { m.quad(g[a][b], g[a + 1][b], g[a + 1][b + 1], g[a][b + 1]); m.quad(gb[a][b], gb[a][b + 1], gb[a + 1][b + 1], gb[a + 1][b]); }
    // a folded newspaper: the rounded fold along its bottom edge, the second half under it
    if (S.kind <= 1) {
      P(m, 55); const e0 = at(-1, -1, false), e1 = at(1, -1, false), T = 0.0026;
      cyl(m, [e0[0], e0[1] - T, e0[2]], [e1[0], e1[1] - T, e1[2]], T, 10, false);
      for (const [du, dv, y] of [[0.004, 0.003, -T * 0.55], [-0.003, 0.005, -T * 1.35]]) obb(m, S.o[0] + S.u[0] * du + S.v[0] * dv, S.o[1] + y, S.o[2] + S.u[2] * du + S.v[2] * dv, S.u[0], S.u[2], S.h[0] * 0.995, T * 0.45, S.h[1] * 0.99, 0);
    }
    if (!S.flat) for (const u of S.kind === 3 ? [0] : [-0.84, 0.84]) { P(m, 31); const t = at(u, 0.9, false); cyl(m, t, [t[0] + n[0] * 0.004, t[1] + n[1] * 0.004, t[2] + n[2] * 0.004], 0.004, 10); P(m, 42); cyl(m, [t[0] + n[0] * 0.004, t[1] + n[1] * 0.004, t[2] + n[2] * 0.004], [t[0] + n[0] * 0.006, t[1] + n[1] * 0.006, t[2] + n[2] * 0.006], 0.0015, 6); }
  });
  // under the open notebook: its marbled covers and the page block
  const nb = PAPERS.findIndex((S) => S.kind === 6), L = PAPERS[nb], R = PAPERS[nb + 1];
  const cx = (L.o[0] + R.o[0]) / 2, cz = (L.o[2] + R.o[2]) / 2, y = PICNIC[2], ux = L.u[0], uz = L.u[2];
  P(m, 54); obb(m, cx, y + 0.0015, cz, ux, uz, 0.182, 0.0015, 0.116, 0);
  P(m, 55); for (const s of [-1, 1]) obb(m, cx + ux * s * 0.088, y + 0.007, cz + uz * s * 0.088, ux, uz, 0.084, 0.0055, 0.107, 0);
  // a pencil across the right page (yellow paint, sharpened wood, the lead), and two map tacks
  { const a = [R.o[0] - 0.05, R.o[1] + 0.006, R.o[2] + 0.06], b = [R.o[0] + 0.07, R.o[1] + 0.006, R.o[2] - 0.015], d = [b[0] - a[0], 0, b[2] - a[2]], l = hypot(d[0], d[2]);
    P(m, 56); cyl(m, a, b, 0.0036, 6); P(m, 9); cyl(m, b, [b[0] + d[0] / l * 0.014, b[1], b[2] + d[2] / l * 0.014], 0.0036, 6); P(m, 34); cyl(m, [b[0] + d[0] / l * 0.014, b[1], b[2] + d[2] / l * 0.014], [b[0] + d[0] / l * 0.02, b[1], b[2] + d[2] / l * 0.02], 0.0012, 5); }
  const mp = PAPERS.find((S) => S.kind === 4);
  P(m, 31); for (const [u, v] of [[-0.92, 0.9], [0.92, 0.9], [0.92, -0.9], [-0.92, -0.9]]) { const x = mp.o[0] + mp.u[0] * u * mp.h[0] + mp.v[0] * v * mp.h[1], z = mp.o[2] + mp.u[2] * u * mp.h[0] + mp.v[2] * v * mp.h[1]; cyl(m, [x, mp.o[1], z], [x, mp.o[1] + 0.004, z], 0.005, 8); }
}
// an Argus C3-style 35 mm camera (the black "brick", chrome lens and trim) on a wooden tripod, aimed at SKYPATCH
function meshCameraTripod() {
  const m = new Mesh(), hy = 1.22, [sx, sy, sz] = SKYPATCH, hl = hypot(sx, sz), ux = sx / hl, uz = sz / hl, el = atan2(sy, hl);
  P(m, 34); cyl(m, [0, hy - 0.06, 0], [0, hy + 0.02, 0], 0.035, 12); cyl(m, [0, hy - 0.1, 0], [0, hy - 0.06, 0], 0.05, 12);
  for (let i = 0; i < 3; i++) { const a = i / 3 * TAU + 0.4, L = (t) => [cos(a) * (0.035 + 0.485 * t), hy - 0.08 - (hy - 0.08) * t, sin(a) * (0.035 + 0.485 * t)];
    P(m, WOOD.by); m.sweep([L(0), L(0.55)], 0.038, 0.026); m.sweep([L(0.5), L(1)], 0.03, 0.02);
    P(m, 31); { const p = L(0.52); cyl(m, [p[0], p[1] + 0.025, p[2]], [p[0], p[1] - 0.025, p[2]], 0.026, 8); }
    P(m, 42); { const p = L(1); cyl(m, p, [p[0] * 1.02, -0.04, p[2] * 1.02], 0.007, 5); } }
  const c = [ux * 0.01, hy + 0.08, uz * 0.01], U = [ux * cos(el), sin(el), uz * cos(el)];
  const V = [-ux * sin(el), cos(el), -uz * sin(el)], T = [-uz, 0, ux], at = (a, b, d) => [c[0] + U[0] * a + V[0] * b + T[0] * d, c[1] + U[1] * a + V[1] * b + T[1] * d, c[2] + U[2] * a + V[2] * b + T[2] * d];
  P(m, 30); obb(m, c[0], c[1], c[2], ux, uz, 0.03, 0.036, 0.068, el);
  { const p = at(0, 0.039, 0); P(m, 3); obb(m, p[0], p[1], p[2], ux, uz, 0.031, 0.004, 0.069, el); }                    // top plate
  for (const [d, r, hh] of [[-0.05, 0.011, 0.008], [0.048, 0.01, 0.006], [0.025, 0.006, 0.01]]) { P(m, 3); cyl(m, at(0, 0.043, d), at(0, 0.043 + hh, d), r, 12); P(m, 34); cyl(m, at(0, 0.043 + hh, d), at(0, 0.0445 + hh, d), r * 0.8, 12); } // rewind knob, shutter dial, release
  for (const d of [-0.045, 0.045]) { P(m, 6); const p = at(0.031, 0.022, d); obb(m, p[0], p[1], p[2], ux, uz, 0.002, 0.007, 0.01, el); P(m, 3); obb(m, p[0] - U[0] * 0.0005, p[1] - U[1] * 0.0005, p[2] - U[2] * 0.0005, ux, uz, 0.0015, 0.009, 0.012, el); } // rangefinder windows
  { const p = at(0, 0.047, -0.012); P(m, 34); obb(m, p[0], p[1], p[2], ux, uz, 0.012, 0.004, 0.014, el); }            // accessory shoe
  const l0 = [c[0] + U[0] * 0.03, c[1] + U[1] * 0.03, c[2] + U[2] * 0.03], l1 = [c[0] + U[0] * 0.075, c[1] + U[1] * 0.075, c[2] + U[2] * 0.075];
  P(m, 3); cyl(m, l0, l1, 0.022, 16); P(m, 34); for (let k = 0; k < 2; k++) { const a0 = 0.035 + k * 0.022; cyl(m, [c[0] + U[0] * a0, c[1] + U[1] * a0, c[2] + U[2] * a0], [c[0] + U[0] * (a0 + 0.01), c[1] + U[1] * (a0 + 0.01), c[2] + U[2] * (a0 + 0.01)], 0.0235, 20); } P(m, 34); cyl(m, l1, [l1[0] + U[0] * 0.004, l1[1] + U[1] * 0.004, l1[2] + U[2] * 0.004], 0.024, 16, false); P(m, 6); disc(m, [l1[0] + U[0] * 0.001, l1[1] + U[1] * 0.001, l1[2] + U[2] * 0.001], U, 0.016, 14);
  P(m, 34); cyl(m, [0, hy + 0.02, 0], [-ux * 0.25, hy - 0.05, -uz * 0.25], 0.008, 6);
  P(m, 34); { const s0 = at(0, 0.054, 0.025); m.tube([s0, [s0[0] + 0.02, s0[1] + 0.03, s0[2]], [uz * 0.12, hy - 0.15, -ux * 0.12], [uz * 0.06, hy - 0.45, -ux * 0.06]], 0.0018, 5, false); }
  return m;
}
// the park's routed-wood entrance sign (its own object): a brown board on two posts with pyramid tops and a little cap;
// the name and a border are routed into the board's face and painted cream (in the shader: part 70, signD())
function meshSign() {
  const m = new Mesh();
  for (const x of [-0.98, 0.98]) {
    P(m, WOOD.by); box(m, x - 0.066, -0.3, -0.166, x + 0.066, 1.38, -0.034);
    const t = [x, 1.44, -0.1], cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => m.v(x + a * 0.066, 1.38, -0.1 + b * 0.066)), tp = m.v(...t);
    for (let k = 0; k < 4; k++) m.tri(cs[k], cs[(k + 1) % 4], tp);
  }
  P(m, 70); box(m, -1.1, 0.8, -0.03, 1.1, 1.3, 0.03); P(m, WOOD.bx); box(m, -1.15, 1.3, -0.07, 1.15, 1.35, 0.06);
  P(m, 34); for (const x of [-0.98, 0.98]) for (const y of [0.9, 1.2]) cyl(m, [x, y, -0.034], [x, y, 0.034], 0.007, 8); // carriage bolts
  rseed(791); for (const x of [-0.98, 0.98]) for (let i = 0; i < 5; i++) { const a = rnd() * TAU; put(m, stone(i + (x > 0 ? 5 : 0)), x + cos(a) * rr(0.1, 0.2), 0.02, -0.1 + sin(a) * rr(0.1, 0.2), rnd() * TAU, [rr(0.05, 0.09), rr(0.03, 0.06), rr(0.05, 0.08)]); }
  return m;
}
const SIGN = [4.2, -8.5, atan2(-0.443, 0.897)]; // camp x, z, yaw (its face toward the camp)
// a faded trail marker at the mouth of the ruins pocket (its own object, leaning a little): a grey post with a
// pyramid top, a small brown board with a cream arrow pointing west
function meshMarker() {
  const m = new Mesh();
  P(m, WOOD.gy); box(m, -0.05, -0.15, -0.05, 0.05, 1.04, 0.05);
  { const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => m.v(a * 0.05, 1.04, b * 0.05)), tp = m.v(0, 1.09, 0); for (let k = 0; k < 4; k++) m.tri(cs[k], cs[(k + 1) % 4], tp); }
  P(m, WOOD.bx); box(m, -0.19, 0.82, 0.05, 0.19, 0.98, 0.075);
  P(m, 57); obb(m, 0.035, 0.9, 0.0762, 1, 0, 0.085, 0.012, 0.0012, 0);
  { const z = 0.0772, t = m.v(-0.152, 0.9, z), u = m.v(-0.055, 0.95, z), d = m.v(-0.055, 0.85, z); m.tri(t, d, u); m.tri(t, u, d); }
  P(m, 34); for (const y of [0.85, 0.95]) cyl(m, [0, y, 0.075], [0, y, 0.08], 0.006, 6);
  return m;
}

// ---------------------------------------------------------------- building the settlement (called from makeWorld)
// each home's frame: centre, forward f (toward the middle), right r, half width hw (along r) and half depth hd (along f)
function ruinHouses() {
  rseed(900);
  return RUINS.map(([x, z, st], k) => {
    let fx = RUINC[0] - x, fz = RUINC[1] - z; if (hypot(fx, fz) < 3) { fx = 1; fz = -0.15; }
    const a = atan2(fz, fx) + rr(-0.3, 0.3);
    return { x, z, st, k, fx: cos(a), fz: sin(a), rx: -sin(a), rz: cos(a), hw: rr(1.9, 2.2), hd: rr(2.45, 2.8) };
  });
}
const inHouse = (h, x, z, pad) => { const dx = x - h.x, dz = z - h.z; return abs(dx * h.rx + dz * h.rz) < h.hw + pad && abs(dx * h.fx + dz * h.fz) < h.hd + pad; };
// rotation taking local x to the direction d (a log lying from one point to another), then rolled about it
function qToX(dx, dy, dz, roll) {
  const l = hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
  let q = [0, -dz, dy, 1 + dx]; const ql = hypot(...q); q = ql < 1e-6 ? [0, 1, 0, 0] : q.map((v) => v / ql);
  return qMul(q, qAxis(1, 0, 0, roll));
}
// The homes: walls of coursed dry-laid stone (rock instances) to a ragged top, door and window openings with hewn
// lintels where both ends still bear on stone, a hearth and chimney in the standing ones, an iron stove in the others;
// fallen roof logs, boards, tumbled stone, broken crockery. The supper stages' small things go into stg[0..2].
// rbox gets the collision boxes (x, z, half sizes, yaw, the stage they appear at).
function buildSettlement(RH, gy, solid, tuft, rbox) {
  const ruin = new Mesh(), stg = [new Mesh(), new Mesh(), new Mesh()];
  stg[0].tri(stg[0].v(0, -99, 0), stg[0].v(0.01, -99, 0), stg[0].v(0, -99, 0.01)); // (stage 1's things are instances)
  rseed(910);
  let nStone = 0;
  const stoneAt = (x, y, z, ax, az, sc, v = rnd() * 4 | 0, tilt = 0.06) => {
    const q = qMul(qAxis(0, 1, 0, atan2(-az, ax) + rr(-0.09, 0.09)), qMul(qAxis(1, 0, 0, rr(-tilt, tilt)), qAxis(0, 0, 1, rr(-tilt, tilt))));
    solid(RUIN_STONE + v, x, y, z, sc, q, 1, rnd(), 1.02, 0); nStone++;
  };
  // fallen stone lies on the sand on a broad face, a little tilted, as it settled (not buried point-down)
  const loose = (x, z, sc) => { const v = rnd() * 4 | 0, tl = rr(-0.25, 0.25), q = qMul(qAxis(0, 1, 0, rnd() * TAU), qMul(qAxis(1, 0, 0, tl), qAxis(0, 0, 1, rr(-0.25, 0.25)))); solid(RUIN_STONE + v, x, gy(x, z) + 0.45 * 1.04 * BLOCKV[v][1] * sc * (1 - abs(tl)) , z, sc, q, 1, rnd(), 1.02, 0); nStone++; };
  const wood = (id, x, y, z, sc, q) => solid(id, x, y, z, sc, q, 2, rnd(), 1, 0);
  // one wall from a to b: courses of stones, each course's height from its stones, joints broken course to course
  const wallRun = (y0, ax, az, bx, bz, hf, open, yb) => {
    const len = hypot(bx - ax, bz - az), ux = (bx - ax) / len, uz = (bz - az) / len;
    // what is under each 5 cm of the wall's length (the top of the stones laid there): a stone goes down only where the
    // course below, or a lintel over an opening, carries it along most of its length, so none hangs in the air
    const NS = Math.ceil(len / 0.05) + 2, sup = new Float32Array(NS).fill(yb);
    // (a stone bridges a short gap: 60% of its length must bear; a lintel bears over the opening and its overhang)
    const carried = (s0, s1, y) => { let ok = 0, n = 0; for (let k = max(0, floor(s0 / 0.05)); k <= min(NS - 1, floor(s1 / 0.05)); k++, n++) { let v = sup[k]; for (const o of open) if (o[3] < 99 && y >= o[3] - 0.02 && k * 0.05 >= o[0] - 0.24 && k * 0.05 <= o[1] + 0.24) v = max(v, o[3] + 0.12); if (v >= y - 0.03) ok++; } return ok >= n * 0.6; };
    for (let y = yb, row = 0; y < 3.4; row++) {
      const ch = rr(0.12, 0.25) * (rnd() < 0.15 ? 1.4 : 1);
      for (let s = row % 2 ? -rr(0.1, 0.25) : rr(-0.04, 0.04); s < len;) {
        const v = rnd() < 0.08 ? 3 : rnd() * 3 | 0, sc = min(ch / (1.04 * BLOCKV[v][1]), 0.52) * rr(0.94, 1.06), sl = 1.2 * BLOCKV[v][0] * sc, sm = s + sl * 0.5;
        s += sl * rr(0.86, 0.96);
        if (sm > len + 0.08) continue;
        if (y + ch * 0.5 > hf(clamp(sm, 0, len))) continue;
        let blocked = false; for (const o of open) if (sm + sl * 0.32 > o[0] && sm - sl * 0.32 < o[1] && y + ch * 0.7 > o[2] && y + ch * 0.3 < o[3]) blocked = true;
        if (blocked) continue;
        if (!carried(sm - sl * 0.32, sm + sl * 0.32, y)) continue;
        for (let k = max(0, floor((sm - sl * 0.45) / 0.05)); k <= min(NS - 1, floor((sm + sl * 0.45) / 0.05)); k++) sup[k] = max(sup[k], y + ch);
        const off = rr(-0.05, 0.05) + (rnd() < 0.1 ? rr(-0.05, 0.05) : 0), sy = y0 + y + 1.04 * BLOCKV[v][1] * sc * 0.5;
        stoneAt(ax + ux * sm - uz * off, sy, az + uz * sm + ux * off, ux, uz, sc, v);
        if (rnd() < 0.3 && y + ch < hf(clamp(s, 0, len)) - 0.1) { const f = rnd() < 0.5 ? 1 : -1, cs = rr(0.07, 0.11); stoneAt(ax + ux * s - uz * f * 0.2, y0 + y + ch * rr(0.4, 0.95), az + uz * s + ux * f * 0.2, -uz, ux, cs, 0, 0.4); }
      }
      y += ch * 0.97;
    }
    return [len, ux, uz];
  };
  for (const H of RH) {
    const W = (lx, lz) => [H.x + H.rx * lx - H.fx * lz, H.z + H.rz * lx - H.fz * lz];
    const y0 = gy(H.x, H.z); let gmin = y0;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const p = W(a * (H.hw + 0.3), b * (H.hd + 0.3)); gmin = min(gmin, gy(p[0], p[1])); }
    const yb = gmin - y0 - 0.22, t = 0.46, hw = H.hw, hd = H.hd, st = H.st, E = 2.05, R = 2.9;
    const yaw = atan2(-H.fx, -H.fz); // put() yaw / quaternion yaw: local -z toward the front, local x along r
    const dmgW = 1 + (rnd() * 3 | 0), dmgS = rr(0.25, 0.75), keepWin = st === 1 && (H.k === 4 || H.k === 8);
    const walls = [[W(-hw - t / 2, -hd), W(hw + t / 2, -hd), 1], [W(hw, -hd + t / 2), W(hw, hd - t / 2), 0], [W(hw + t / 2, hd), W(-hw - t / 2, hd), 1], [W(-hw, hd - t / 2), W(-hw, -hd + t / 2), 0]];
    const lens = walls.map(([a, b]) => hypot(b[0] - a[0], b[1] - a[1]));
    const prof = (w) => (s) => {
      const n = fbm(s * 0.7 + w * 9.1 + H.k * 3.3, H.k * 1.7, w * 2.9, 2), u = s / lens[w];
      const lx = w === 0 ? s - hw - t / 2 : w === 2 ? hw + t / 2 - s : 0;
      let top;
      if (st === 0) {
        top = walls[w][2] ? E + (R - E) * max(0, 1 - abs(lx) / (hw + t / 2)) : E;
        top -= 0.3 * sstep(0.4, 0.7, n);
        if (w === dmgW) top -= 1.3 * Math.exp(-(((u - dmgS) / 0.18) ** 2));
      } else if (st === 1) {
        top = 0.35 + 1.45 * sstep(0.3, 0.72, n);
        if (keepWin && w === 0) top = max(top, 1.95 * Math.exp(-(((lx - 0.95) / 0.8) ** 2)));
      } else top = 0.08 + 0.55 * sstep(0.3, 0.72, n);
      return top;
    };
    const sD = -0.7 + hw + t / 2, sW = 0.95 + hw + t / 2, sH = hw + t / 2;
    // a lintel stays only where the wall stands above it at both ends; with none, the opening runs up to the broken top
    const hf0 = prof(0), LIN = [[sD, 0.72, 1.9, 0.96], [sW, 0.5, 1.56, 0.67]], linOK = LIN.map(([sc, half, y]) => hf0(sc - half) > y + 0.12 && hf0(sc + half) > y + 0.12 && hf0(sc) > y + 0.1);
    const opens = [[[sD - 0.45, sD + 0.45, -5, linOK[0] ? 1.85 : 99], [sW - 0.3, sW + 0.3, 0.88, linOK[1] ? 1.52 : 99]], [], st === 0 ? [[sH - 0.42, sH + 0.42, -5, 0.92]] : [], []];
    walls.forEach(([a, b], w) => {
      const hf = prof(w), [len, ux, uz] = wallRun(y0, a[0], a[1], b[0], b[1], hf, opens[w], yb);
      const cuts = [0]; for (const o of opens[w]) if (o[2] < 0) cuts.push(o[0], o[1]); cuts.push(len);
      for (let i = 0; i < cuts.length; i += 2) {
        const sa = max(cuts[i], 0), sb = min(cuts[i + 1], len); if (sb - sa < 0.15) continue;
        let hm = 0; for (let s = sa; s <= sb; s += 0.25) hm = max(hm, hf(s));
        if (hm > 0.5) rbox.push([a[0] + ux * (sa + sb) / 2, a[1] + uz * (sa + sb) / 2, (sb - sa) / 2, t / 2, atan2(-uz, ux), 0]);
      }
      // a lintel only where the wall stands above it at both ends (it bears on stone), else it lies fallen below
      if (w === 0) {
        for (let li = 0; li < 2; li++) {
          const [sc, half, y, ls] = LIN[li], ok = linOK[li], q = qAxis(0, 1, 0, atan2(ux, uz) + rr(-0.03, 0.03));
          if (ok) wood(W_BEAM, a[0] + ux * sc, y0 + y, a[1] + uz * sc, ls, q);
          else if (hf(sc) > 0.6 && rnd() < 0.7) { const p = [a[0] + ux * sc + uz * rr(0.5, 0.9), a[1] + uz * sc - ux * rr(0.5, 0.9)]; wood(W_BEAM, p[0], gy(p[0], p[1]) + 0.05, p[1], ls, qMul(q, qAxis(1, 0, 0, rr(-0.15, 0.15)))); }
        }
        if (hf(sW) > 0.95) wood(W_BOARD, a[0] + ux * sW, y0 + 0.86, a[1] + uz * sW, 0.5, qMul(qAxis(0, 1, 0, atan2(ux, uz)), qAxis(0, 0, 1, 0)));
      }
      for (let s = 0.2; s < len; s += 0.45) {
        const miss = max((st === 0 ? 0.3 : 2.1) - hf(s), 0), n = Math.round(miss * rr(0.9, 1.9));
        for (let j = 0; j < n; j++) { const side = rnd() < 0.55 ? 1 : -1, dd = t / 2 + 0.15 + pow(rnd(), 1.6) * 1.4, sc = rr(0.2, 0.34); loose(a[0] + ux * (s + rr(-0.3, 0.3)) - uz * side * dd, a[1] + uz * (s + rr(-0.3, 0.3)) + ux * side * dd, sc); }
      }
    });
    // standing homes: a hearth in the back wall and its chimney outside; the others an iron stove (two of them knocked over)
    let potAt = null;
    if (st === 0) {
      const ux = -H.rx, uz = -H.rz, ch = W(0, hd + t / 2 + 0.26), top = R + rr(0.1, 0.6);
      for (let y = yb, row = 0; y < top; row++) { const sc = rr(0.28, 0.33); for (const o of row % 2 ? [-0.24, 0.24] : [-0.3, 0.05, 0.3]) stoneAt(ch[0] + ux * o, y0 + y + 0.63 * sc * 0.5, ch[1] + uz * o, -H.fx, -H.fz, sc * (row % 2 ? 1 : 0.8)); y += 0.6 * sc; }
      const hs0 = W(0, hd - t / 2 - 0.32); solid(RUIN_STONE, hs0[0], y0 - 0.075, hs0[1], 0.5, qAxis(0, 1, 0, yaw), 1, 0.5, 1.02, 0);
      const hl = W(0, hd); wood(W_BEAM, hl[0], y0 + 0.98, hl[1], 0.75, qAxis(0, 1, 0, atan2(ux, uz)));
      potAt = [hs0[0], y0 + 0.08, hs0[1]];
      rbox.push([ch[0], ch[1], 0.42, 0.3, atan2(-uz, ux), 0]);
    }
    if (st >= 1 || H.k === 7) {
      const sp = W(-hw + 0.62, hd - 0.75), tip = H.k === 6 || H.k === 7, g = gy(sp[0], sp[1]);
      solid(W_STOVE, sp[0], g + (tip ? 0.24 : 0), sp[1], 1, qMul(qAxis(0, 1, 0, yaw + (tip ? 0.5 : rr(-0.15, 0.15))), qAxis(1, 0, 0, tip ? -1.5 : 0)), 2, rnd(), 1, 0);
      if (!tip) potAt = [sp[0] + (H.rx * 0.15 - H.fx * 0.02), g + 0.657, sp[1] + (H.rz * 0.15 - H.fz * 0.02)];
      const pa = W(-hw + 1.1, hd - 0.4); P(ruin, 47); cyl(ruin, [pa[0], gy(pa[0], pa[1]) + 0.065, pa[1]], [pa[0] + H.rx * 0.55, gy(pa[0], pa[1]) + 0.07, pa[1] + H.rz * 0.55], 0.064, 12, false);
      rbox.push([sp[0], sp[1], 0.32, 0.3, atan2(H.fx, H.rx), 0]);
    }
    // the roof's logs: fallen in, one end often still up on a side wall; some broken
    for (let i = 0, nT = st === 2 ? 2 : 3 + (rnd() * 3 | 0); i < nT; i++) {
      const lz = rr(-hd + 0.7, hd - 0.7), side = rnd() < 0.5 ? 1 : -1;
      const sw = side > 0 ? lz + hd - t / 2 : hd - t / 2 - lz, top = prof(side > 0 ? 1 : 3)(sw);
      const a = W(side * (hw + 0.05), lz), b = W(-side * rr(-0.3, 1.8), lz + rr(-1.4, 1.4));
      const up = top > 0.7 && rnd() < 0.75 && st < 2, broken = rnd() < 0.45, sc = rr(0.85, 1.1);
      const r = 0.125 * sc, ya = up ? y0 + top + r * 0.8 : gy(a[0], a[1]) + r * 0.55, yb2 = gy(b[0], b[1]) + r * 0.55; // lying ones half sunk in the sand
      const dx = b[0] - a[0], dy = yb2 - ya, dz = b[1] - a[1];
      wood(W_LOG + (broken ? 1 : 0), a[0], ya, a[1], sc, qToX(dx, dy, dz, rnd() * TAU));
    }
    for (let i = 0, n = 2 + (rnd() * 3 | 0); i < n; i++) { const p = W(rr(-hw + 0.5, hw - 0.5), rr(-hd + 0.6, hd - 0.6)); wood(W_BOARD, p[0], gy(p[0], p[1]) + 0.016, p[1], rr(0.45, 1.0), qMul(qAxis(0, 1, 0, rnd() * TAU), qAxis(0, 0, 1, rr(-0.06, 0.06)))); }
    // broken crockery round the hearth or stove
    if (H.k !== 2) {
      P(ruin, 48);
      for (let i = 0; i < 18; i++) {
        const p = W(rr(-hw + 0.4, hw - 0.4) * 0.8, rr(hd * 0.1, hd - 0.4)), y = gy(p[0], p[1]) + 0.007, s = rr(0.012, 0.035), a0 = rnd() * TAU, n = 4 + (rnd() * 3 | 0), vs = [], c = ruin.v(p[0], y + 0.002, p[1]);
        for (let j = 0; j < n; j++) { const a = a0 + j / n * TAU + rr(-0.3, 0.3), r = s * rr(0.5, 1); vs.push(ruin.v(p[0] + cos(a) * r, y + rr(-0.002, 0.002), p[1] + sin(a) * r)); }
        for (let j = 0; j < n; j++) { ruin.tri(c, vs[(j + 1) % n], vs[j]); ruin.tri(c, vs[j], vs[(j + 1) % n]); }
      }
    }
    for (let i = 0; i < 3; i++) { const p = W(rr(-hw + 0.4, hw - 0.4), rr(-hd + 0.4, hd - 0.4)); tuft(p[0], gy(p[0], p[1]), p[1]); }
    // the supper, in stages: 1 the table and benches, 2 places set, 3 the meal on them and the pot on the fire
    if (st < 2) {
      const tl = [rr(-0.3, 0.3), rr(-0.5, 0.2)], tp = W(...tl), ty = atan2(-H.rz, H.rx) + rr(-0.15, 0.15), y = gy(tp[0], tp[1]), c = cos(ty), s = sin(ty);
      const tf = (x, z) => [tp[0] + x * c + z * s, tp[1] - x * s + z * c];
      solid(W_TABLE, tp[0], y, tp[1], 1, qAxis(0, 1, 0, ty), 2, rnd(), 1, 0);
      for (const zz of [-0.56, 0.56]) { const b = tf(rr(-0.05, 0.05), zz); solid(W_BENCH, b[0], gy(b[0], b[1]), b[1], 1, qAxis(0, 1, 0, ty + rr(-0.06, 0.06)), 2, rnd(), 1, 0); }
      rbox.push([tp[0], tp[1], 0.66, 0.8, ty, 1]);
      for (const [sx, sz] of [[-0.3, -0.2], [0.3, -0.2], [-0.3, 0.2], [0.3, 0.2]]) {
        const p = tf(sx, sz), cp = tf(sx + 0.16, sz * 1.3), spn = tf(sx - 0.15, sz);
        put(stg[1], meshPlate(), p[0], y + 0.752, p[1], 0); put(stg[1], meshCup(), cp[0], y + 0.752, cp[1], rnd() * TAU);
        P(stg[1], 42); obb(stg[1], spn[0], y + 0.755, spn[1], s, c, 0.075, 0.003, 0.009, 0);
        put(stg[2], meshFood(), p[0], y + 0.752, p[1], rnd() * TAU);
      }
      const pc = tf(0.02, 0); put(stg[1], meshPitcher(), pc[0], y + 0.752, pc[1], rnd() * TAU);
      const lf = tf(-0.05, 0.03); put(stg[2], meshLoaf(), lf[0], y + 0.79, lf[1], ty + 0.3);
      if (potAt) put(stg[2], meshPot(), potAt[0], potAt[1], potAt[2], rnd() * TAU);
    }
  }
  return { ruin, stg, nStone };
}
// the traces of later visitors: an older cold fire ring in the east alcove (a can and a bottle by it), a rusted can at
// the mouth of the ruins pocket, the park's faded trail marker pointing the way to the ruins
function buildTraces(gy, solid, obsPush) {
  const m = new Mesh(); rseed(950);
  const fx = 14, fz = 42, g = gy(fx, fz);
  for (let i = 0; i < 11; i++) { if (i === 7) continue; const a = i / 11 * TAU + rr(-0.22, 0.22), r = rr(0.48, 0.7); solid(rnd() * 4 | 0, fx + cos(a) * r, g + rr(0, 0.04), fz + sin(a) * r, rr(0.11, 0.2), qMul(qAxis(0, 1, 0, rnd() * TAU), qAxis(1, 0, 0, rr(-0.4, 0.4))), 1, rnd(), 1, 0); }
  // the ash: a fine grid laid on the sand itself, so it has no edge; the shader fades it out into the sand
  P(m, 58); { const N = 22, R = 0.5, g2 = []; for (let i = 0; i <= N; i++) { const row = []; for (let j = 0; j <= N; j++) { const x = fx + (i / N * 2 - 1) * R, z = fz + (j / N * 2 - 1) * R; row.push(m.v(x, gy(x, z) + 0.006 + 0.008 * max(0, 1 - hypot(x - fx, z - fz) / 0.35), z)); } g2.push(row); }
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) m.quad(g2[i][j], g2[i][j + 1], g2[i + 1][j + 1], g2[i + 1][j]); }
  for (let i = 0; i < 14; i++) { const a = rnd() * TAU, r0 = sqrt(rnd()) * 0.32, b = rnd() * TAU, l = rr(0.03, 0.12); P(m, 14); cyl(m, [fx + cos(a) * r0, g + 0.012, fz + sin(a) * r0], [fx + cos(a) * r0 + cos(b) * l, g + 0.012 + rr(0, 0.015), fz + sin(a) * r0 + sin(b) * l], rr(0.008, 0.022), 6); }
  // three sticks pushed in from the edge as it burned down: charred where they lay in the fire, grey weathered wood
  // outside it, each crooked
  for (let i = 0; i < 3; i++) {
    const a = i * 2.2 + rr(-0.4, 0.4), l = rr(0.3, 0.46), r = rr(0.022, 0.034), pts = [];
    for (let k = 0; k <= 6; k++) { const t = k / 6, rr0 = 0.1 + l * t, b = a + (fbm(t * 2 + i * 5, i, 0, 2) - 0.5) * 0.25; pts.push([fx + cos(b) * rr0, g + r * 0.7 + 0.012 * sin(t * 5 + i), fz + sin(b) * rr0]); }
    P(m, 14); m.tube(pts.slice(0, 4), (k) => r * (0.55 + 0.15 * k), 8, true); P(m, 71); m.tube(pts.slice(3), r, 8, true);
  }
  const can = new Mesh(); P(can, 47); lathe(can, [[0, 0], [0.038, 0], [0.04, 0.005], [0.039, 0.11], [0.041, 0.114], [0.034, 0.114], [0.034, 0.11]], 16); disc(can, [0, 0.11, 0], [0, 1, 0], 0.034, 14);
  for (const [x, z] of [[14.75, 42.95], [-28, -85]]) putR(m, can, x, gy(x, z) + 0.039, z, rnd() * TAU, PI / 2 + rr(-0.1, 0.1));
  const bot = new Mesh(); P(bot, 50); lathe(bot, [[0, 0], [0.03, 0], [0.032, 0.005], [0.032, 0.13], [0.027, 0.162], [0.014, 0.2], [0.013, 0.248], [0.016, 0.252], [0.012, 0.256], [0, 0.254]], 14);
  putR(m, bot, 13.1, gy(13.1, 41.4) + 0.012, 41.4, 0.8, PI / 2 + 0.12); // half sunk in the sand
  putR(m, can, 13.82, gy(13.82, 41.86) + 0.028, 41.86, 2.1, PI / 2 + 0.3); // one burned in the ashes
  solid(W_MARKER, -14, gy(-14, -80) - 0.05, -80, 1, qMul(qAxis(0, 1, 0, 0.05), qAxis(1, 0, 0, 0.07)), 2, 0.3, 1, 0); obsPush(-14, -80, 0.15);
  // a cairn holds it up: a ring of base stones, smaller ones stacked on them, a few up to the knee
  { const g0 = gy(-14, -80); let k = 0; for (const [n, rad, y, s] of [[7, 0.17, 0.03, 0.1], [6, 0.12, 0.12, 0.085], [5, 0.09, 0.2, 0.07], [3, 0.07, 0.27, 0.06], [2, 0.06, 0.33, 0.05]]) for (let i = 0; i < n; i++, k++) { const a = i / n * TAU + k * 0.7; solid(rnd() * 4 | 0, -14 + cos(a) * rad, g0 + y, -80 + sin(a) * rad, s * rr(0.85, 1.15), qRand(), 1, rnd(), 1, 0); } }
  return m;
}
// copy mesh b into a: rolled round its local x axis, then turned by yaw (as put()), then moved
function putR(a, b, x, y, z, yaw, roll) {
  const n0 = a.p.length / 3, c = cos(yaw), sn = sin(yaw), cr = cos(roll), sr = sin(roll);
  for (let k = 0; k < b.p.length; k += 3) { const px = b.p[k], py = b.p[k + 1] * cr - b.p[k + 2] * sr, pz = b.p[k + 1] * sr + b.p[k + 2] * cr; a.p.push(x + px * c + pz * sn, y + py, z - px * sn + pz * c); }
  for (const v of b.aux) a.aux.push(v);
  for (const i of b.i) a.i.push(i + n0);
}
