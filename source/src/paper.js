// ============================================================================
// M3 shared layout and paper: where the picnic table, papers, tire tracks and the camera's sky patch are
// (used by world.js for geometry, main.js for collision, shaders.js for the printed and written patterns)
// ============================================================================
// the park picnic table (camp coords x, z; its top surface height) and where the camera on its tripod points: the patch
// of sky where the stars will go out (M5), as a direction in camp coords (x north, y up, z east)
const PICNIC = [-4.6, 0.6, 0.78], SKYPATCH = [0.55, 0.64, 0.53], CAMERA = [-6.2, -1.6];
// old tire tracks down the canyon toward the ruins (world x, z): two faint ruts, years old, half drifted over
const TRACKS = [[2, -7], [1, -18], [-3, -34], [-5, -50], [-6, -64], [-12, -76], [-24, -84], [-33, -86]];

// Every sheet of paper, in camp coords: kind, seed, centre o, U (along the sheet, to the right as you read it), V (up the
// page), half sizes along U and V, and whether it lies flat (curls at the corners) or hangs pinned (bows, bottom corners lift).
// Kinds: 0 newspaper 1957, 1 newspaper 1947 (the Roswell paper), 2 clipping, 3 photograph, 4 park map, 5 star chart,
// 6 notebook left page, 7 notebook right page. Each sheet gets part id PAPER0 + its index (the shader looks its frame up).
const PAPER0 = 74, PAPERS = [];
{
  const r4 = (a) => a.map((v) => +v.toFixed(4));
  // flat on a surface: yaw as in put() (local x -> (cos, -sin), the top of the page toward local -z)
  const flat = (kind, seed, x, y, z, yaw, hu, hv) => {
    const c = cos(yaw), s = sin(yaw);
    PAPERS.push({ kind, seed, o: r4([x, y, z]), u: r4([c, 0, -s]), v: r4([-s, 0, -c]), h: [hu, hv], flat: true });
  };
  // pinned to the tent's canvas (tent at camp (1, 7.5)): the back wall faces into the tent (-z), the left wall faces +x
  const back = (kind, seed, x, y, hu, hv) => PAPERS.push({ kind, seed, o: r4([1 + x, y, 7.5 + 1.735]), u: [-1, 0, 0], v: [0, 1, 0], h: [hu, hv], flat: false });
  const left = (kind, seed, z, y, hu, hv) => PAPERS.push({ kind, seed, o: r4([1 - 1.435, y, 7.5 + z]), u: [0, 0, -1], v: [0, 1, 0], h: [hu, hv], flat: false });
  // on the folding table (camp (3.4, -0.9), turned 0.25): today's paper, folded, under a stone
  { const c = cos(0.25), s = sin(0.25), lx = -0.02, lz = 0; flat(0, 3, 3.4 + lx * c + lz * s, 0.7395, -0.9 - lx * s + lz * c, 0.01, 0.19, 0.15); }
  // in the tent: clippings (older, 1947 to 1957) and the observer's own photographs
  for (const [x, y, w, h, k] of [[-0.9, 1.15, 0.06, 0.08, 1], [-0.7, 1.32, 0.09, 0.12, 0], [-0.45, 1.1, 0.06, 0.05, 1], [-0.25, 1.28, 0.07, 0.1, 0], [-0.05, 1.05, 0.12, 0.07, 0],
    [0.2, 1.3, 0.05, 0.07, 1], [0.38, 1.12, 0.08, 0.11, 0], [0.6, 1.25, 0.06, 0.08, 1], [-0.55, 0.9, 0.1, 0.06, 0]]) back(k ? 3 : 2, PAPERS.length * 7 + 1, x, y, w, h);
  for (const [z, y, w, h, k] of [[0.9, 1.0, 0.08, 0.1, 0], [1.2, 1.15, 0.06, 0.05, 1], [0.5, 1.12, 0.06, 0.08, 1]]) left(k ? 3 : 2, PAPERS.length * 7 + 2, z, y, w, h);
  // on the picnic table: the 1947 paper, the park map, the star chart, the notebook open at its last pages, photographs
  const [px, pz, py] = PICNIC;
  flat(1, 11, px - 0.03, py + 0.0015, pz - 0.62, 0.06, 0.2, 0.15);
  flat(4, 12, px + 0.04, py + 0.0025, pz - 0.15, -0.04, 0.2, 0.15);
  flat(5, 13, px - 0.04, py + 0.0016, pz + 0.3, 1.57 + 0.05, 0.21, 0.165);
  { const yaw = 1.57 - 0.12, c = cos(yaw), s = sin(yaw), cx = px + 0.1, cz = pz + 0.68, y = py + 0.0135;
    for (const k of [0, 1]) { const o = (k ? 1 : -1) * 0.0875; flat(6 + k, 14 + k, cx + o * c, y, cz - o * s, yaw, 0.084, 0.108); } }
  flat(3, 21, px - 0.1, py + 0.0042, pz - 0.52, 0.32, 0.045, 0.06);
  flat(3, 22, px + 0.14, py + 0.0045, pz - 0.02, -0.45, 0.06, 0.045);
  flat(3, 23, px + 0.06, py + 0.0044, pz + 0.12, 0.9, 0.045, 0.06);
  // over the bed, the whole front page of the Los Angeles Times of November 4, 1957: the dog in orbit
  back(8, 31, 0.45, 1.62, 0.19, 0.29);
}

// The paper atlas: every sheet drawn once at load (paperart.js) into one texture, at PAPER_PXM pixels per metre.
// Shelf-packed here so the shader knows each sheet's rectangle.
const PAPER_ATLAS = LV > 1 ? 2048 : 4096, PAPER_PXM = PAPER_ATLAS === 4096 ? 3000 : 1500;
for (const S of PAPERS) S.pxm = PAPER_PXM * (S.kind <= 1 ? 1.25 : S.kind === 4 || S.kind === 5 ? 1.45 : S.kind === 8 ? 0.82 : 1); // the big sheets denser, the broadsheet (read from further) less
{
  // skyline packing, tallest first: each sheet goes where its top would sit lowest along the current skyline
  const sky = [[0, 0, PAPER_ATLAS]], px = (S) => [Math.ceil(S.h[0] * 2 * S.pxm) + 8, Math.ceil(S.h[1] * 2 * S.pxm) + 8];
  const order = PAPERS.map((S, i) => i).sort((a, b) => px(PAPERS[b])[1] - px(PAPERS[a])[1]);
  let over = false;
  for (const i of order) {
    const S = PAPERS[i], [w, h] = px(S); let best = null;
    for (let k = 0; k < sky.length; k++) {
      const x = sky[k][0]; if (x + w > PAPER_ATLAS) break;
      let y = 0, cov = 0; for (let j = k; j < sky.length && cov < w; j++) { y = max(y, sky[j][1]); cov += sky[j][2] - (j === k ? 0 : 0); if (sky[j][0] + sky[j][2] >= x + w) break; }
      if (!best || y < best[1] || (y === best[1] && x < best[0])) best = [x, y];
    }
    if (!best || best[1] + h > PAPER_ATLAS) over = true;
    const [x, y] = best || [0, 0]; S.rect = [x + 4, y + 4, w - 8, h - 8];
    // the new segment, and what it covers trimmed off the old ones
    const out = []; for (const s of sky) { const s0 = s[0], s1 = s[0] + s[2]; if (s1 <= x || s0 >= x + w) { out.push(s); continue; } if (s0 < x) out.push([s0, s[1], x - s0]); if (s1 > x + w) out.push([x + w, s[1], s1 - x - w]); }
    out.push([x, y + h, w]); out.sort((p, q) => p[0] - q[0]);
    sky.length = 0; for (const s of out) { const l = sky[sky.length - 1]; if (l && l[1] === s[1]) l[2] += s[2]; else sky.push(s); }
  }
  if (over) console.warn('paper atlas overflow');
}

// generated WGSL pieces (plain strings: the build's shader minifier stops at a backtick)
const f2 = (v) => (+v).toFixed(3), f6 = (v) => (+v).toFixed(6);
// the park sign's routed name: monoline strokes on a 4 x 6 grid; signWGSL() writes signD(p), the distance (board
// metres) from p to the nearest stroke, each letter tested only inside its own box
const STROKES = {
  C: [[4, 5, 3, 6, 1, 6, 0, 5, 0, 1, 1, 0, 3, 0, 4, 1]], O: [[1, 0, 3, 0, 4, 1, 4, 5, 3, 6, 1, 6, 0, 5, 0, 1, 1, 0]], L: [[0, 6, 0, 0, 4, 0]],
  D: [[0, 0, 0, 6, 2.5, 6, 4, 4.5, 4, 1.5, 2.5, 0, 0, 0]], S: [[4, 5, 3, 6, 1, 6, 0, 5, 0, 4, 1, 3, 3, 3, 4, 2, 4, 1, 3, 0, 1, 0, 0, 1]],
  U: [[0, 6, 0, 1, 1, 0, 3, 0, 4, 1, 4, 6]], P: [[0, 0, 0, 6, 3, 6, 4, 5, 4, 4, 3, 3, 0, 3]], E: [[4, 6, 0, 6, 0, 0, 4, 0], [0, 3, 3, 3]],
  R: [[0, 0, 0, 6, 3, 6, 4, 5, 4, 4, 3, 3, 0, 3], [2, 3, 4, 0]], A: [[0, 0, 0, 4, 2, 6, 4, 4, 4, 0], [0, 2.5, 4, 2.5]], N: [[0, 0, 0, 6, 4, 0, 4, 6]],
  Y: [[0, 6, 2, 3, 4, 6], [2, 3, 2, 0]], T: [[0, 6, 4, 6], [2, 6, 2, 0]], I: [[2, 0, 2, 6], [1, 0, 3, 0], [1, 6, 3, 6]], M: [[0, 0, 0, 6, 2, 3, 4, 6, 4, 0]],
};
function signWGSL() {
  const u = 0.0175, adv = 5.6 * u, out = [];
  ['COLDSUPPER CANYON', 'NATIONAL MONUMENT'].forEach((L, li) => {
    const w = L.length * adv - 1.6 * u, y0 = li ? 0.9 : 1.09;
    for (let ci = 0; ci < L.length; ci++) {
      const st = STROKES[L[ci]]; if (!st) continue;
      const ox = -w / 2 + ci * adv, segs = [];
      for (const pts of st) for (let k = 0; k + 3 < pts.length; k += 2) segs.push([ox + pts[k] * u, y0 + pts[k + 1] * u, ox + pts[k + 2] * u, y0 + pts[k + 3] * u]);
      out.push('if (p.x > ' + f2(ox - 0.02) + ' && p.x < ' + f2(ox + 4 * u + 0.02) + ' && p.y > ' + f2(y0 - 0.02) + ' && p.y < ' + f2(y0 + 6 * u + 0.02) + ') { ' + segs.map((s) => 'd = min(d, segD(p, vec2f(' + f6(s[0]) + ', ' + f6(s[1]) + '), vec2f(' + f6(s[2]) + ', ' + f6(s[3]) + ')));').join(' ') + ' }');
    }
  });
  return 'fn signD(p: vec2f) -> f32 { var d = 1.; let bq = abs(p - vec2f(0., 1.05)) - vec2f(1.055, .215); d = min(d, abs(max(bq.x, bq.y))); ' + out.join(' ') + ' return d; }';
}
const paperCases = () => PAPERS.map((P, i) => 'case ' + (PAPER0 + i) + ' { f = PF(vec3f(' + P.o.map(f2) + '), vec3f(' + P.u.map(f2) + '), vec3f(' + P.v.map(f2) + '), vec2f(' + P.h.map(f2) + '), ' + P.kind + ', vec4f(' + P.rect.map((v) => f6(v / PAPER_ATLAS)) + '), ' + f2(P.pxm) + '); }').join(' ');
const polySegs = (P) => P.slice(1).map((b, i) => 'd = min(d, segD(p, vec2f(' + f2(P[i][0]) + ', ' + f2(P[i][1]) + '), vec2f(' + f2(b[0]) + ', ' + f2(b[1]) + ')));').join(' ');
// The paper and wood shader pieces, included in the solid shader (shaders.js). A function so the constants exist by then.
const paperWGSL = () => /*wgsl*/`
// ---------------------------------------------------------------- paper (PAPERS in paper.js, drawn by paperart.js)
struct PF { o: vec3f, u: vec3f, v: vec3f, h: vec2f, k: i32, r: vec4f, d: f32 };
fn paperFrame(id: i32) -> PF {
  var f: PF; f.h = vec2f(.1); f.u = vec3f(1., 0., 0.); f.v = vec3f(0., 0., 1.);
  switch id {
    ${paperCases()}
    default {}
  }
  return f;
}
fn segD(p: vec2f, a: vec2f, b: vec2f) -> f32 { let ab = b - a; let t = sat(dot(p - a, ab) / max(dot(ab, ab), 1e-9)); return length(p - a - ab * t); }
// the old tire tracks' centre line (terrain ruts)
fn mapTrack(p: vec2f) -> f32 {
  var d = 1e9;
  ${polySegs(TRACKS)}
  return d;
}
// a sheet: its picture from the atlas (mip level from the size of this pixel on the paper), the newspapers' fold, gloss on prints
fn paperPM(id: i32, op: vec3f, pfw: f32) -> PM {
  var m: PM; m.gl = .06; m.mt = 0.; m.bp = .02; m.e = vec3f(0.); m.n = vec3f(0.); m.tl = .25;
  let f = paperFrame(id); let d = op - f.o;
  let W = f.h.x * 2.; let H = f.h.y * 2.;
  let p = vec2f(dot(d, f.u) + f.h.x, f.h.y - dot(d, f.v));
  let uv = f.r.xy + clamp(p / vec2f(W, H), vec2f(.001), vec2f(.999)) * f.r.zw;
  let t = textureSampleLevel(tPA, sP, uv, log2(max(pfw * f.d, 1.))).rgb;
  m.a = pow(t, vec3f(2.2)) * .74;
  if (f.k <= 1) { let fd = p.y - H * .5; m.n = f.v * sign(fd) * ss(.004, 0., abs(fd)) * .3; }
  let wr = vn2d(p * 38. + f.o.xz * 7.); let wr2 = vn2d(p.yx * 110. + 3.);
  m.n += (f.u * (wr - .5) + f.v * (wr2 - .5) * .5) * select(.12, .04, f.k == 3);
  if (f.k == 3) { m.gl = .5; m.tl = .05; }
  if (f.k == 5) { m.gl = .15; }
  return m;
}

// Weathered wood, the grain along the object's own x, y or z: part 100..102 sun-greyed (old timbers, the 1870s
// tables), 103..105 brown stained and worn back to grey on the tops (park furniture, posts, crates), 106 a roof log
// along x (bark in patches), 107 a hewn beam along z (adze scallops). op is the object's own position (no seed
// offset), so the rings are centred on the piece. Side grain: fibre streaks at three sizes with the soft wood worn
// back between hard ridges, drying checks that follow the grain; end grain: rings round the pith and radial splits.
fn gN(al: f32, cp: vec2f, w: f32) -> f32 { return mix(vn2d(vec2f(al, cp.x)), vn2d(vec2f(al + 17.3, cp.y)), w); }
fn woodPM(id: i32, op: vec3f, on: vec3f, h: f32, pfw: f32, sd: f32) -> PM {
  var m: PM; m.gl = .03; m.mt = 0.; m.e = vec3f(0.); m.tl = 0.; m.n = vec3f(0.); m.bp = 0.;
  let brown = (id >= 103 && id <= 105) || id == 108; let logw = id == 106 || id == 108; let beam = id == 107;
  var ax = (id - 100) % 3; if (id == 106) { ax = 0; } if (beam || id == 108) { ax = 2; }
  var A = vec3f(1., 0., 0.); if (ax == 1) { A = vec3f(0., 1., 0.); } else if (ax == 2) { A = vec3f(0., 0., 1.); }
  let B1 = normalize(cross(A, vec3f(.267, .534, .802))); let B2 = cross(A, B1);
  let so = fract(sd * 7.31) * 40.;
  let al = dot(op, A) + so; let c = op - A * dot(op, A);
  let cp = vec2f(dot(c, B1), dot(c, B2)); let cr = length(cp);
  let wq = ss(.35, .65, abs(dot(on, B1)));       // a face turned toward B1 runs along B2
  let fg = ss(.003, .001, pfw); let mg = ss(.015, .004, pfw);
  let wob = (gN(al * .9, cp * 6., wq) - .5) * .03 + (gN(al * .2 + 3., cp * 1.5, wq) - .5) * .08;
  let ring = fract((cr + wob) * select(select(95., 60., beam), 26., logw));
  let late = ss(.8, .9, ring) * ss(1., .94, ring);   // the latewood: a thin hard line in each ring
  let s1 = gN(al * .4, cp * 30., wq); let s2 = gN(al * 1.2 + 7., cp * 110., wq); let s3 = gN(al * 3. + 13., cp * 330., wq);
  let fib = s1 * .4 + mix(.5, s2, mg) * .35 + mix(.5, s3, fg * ss(.0018, .0008, pfw)) * .25;
  let cn = gN(al * .35 + 21., cp * 22., wq); let cw = .012 + .03 * ss(.5, .9, gN(al * .8 + 5., cp * 3., wq));
  let chk = (1. - ss(0., cw, abs(cn - .5))) * ss(.44, .52, gN(al * .5 + 40., cp * 4., wq)) * mg;
  let cn2 = gN(al * 1.2 + 31., cp * 70., wq);
  let chk2 = (1. - ss(0., .03, abs(cn2 - .5))) * ss(.48, .56, gN(al * 2. + 50., cp * 9., wq)) * fg * .5;
  let crack = max(chk, chk2);
  let endg = ss(.6, .85, abs(dot(on, A)));
  let ang = atan2(cp.y, cp.x);
  let rad = (1. - ss(0., .04, abs(vn2d(vec2f(ang * 5. + so, cr * 4.)) - .5))) * ss(.4, .6, vn2d(vec2f(ang * 2., so)));
  let wear = ss(.3, .8, on.y * .6 + gN(al * .7 + 60., cp * 8., wq) * .8 - .1);
  var top = select(vec3f(.25, .235, .215), vec3f(.21, .19, .165), logw || beam); var dark = vec3f(.06, .05, .04);
  if (brown) { top = mix(vec3f(.17, .10, .055), vec3f(.27, .245, .215), wear * .55); dark = vec3f(.055, .032, .018); }
  var col = mix(dark, top, .3 + .7 * fib) * (1. - .45 * late * mg);
  col *= .85 + .3 * gN(al * .15 + 80., cp * 1.2, wq);
  col = mix(col, vec3f(.025, .018, .012), crack * .9);
  let ec = mix(dark * 1.3, top * .75, ss(.15, .7, ring)) * (1. - .7 * rad);
  col = mix(col, ec, endg);
  let bk = select(0., ss(.5, .55, gN(al * .9 + 90., cp * 5., wq)) * (1. - endg), logw);
  let pl = vn2d(vec2f(al * 9., ang * 6.)); let bpl = 1. - ss(0., .07, abs(vn2d(vec2f(al * 3.5, ang * 11.)) - .5));   // ridges and deep fissures along the log
  col = mix(col, vec3f(.10, .075, .055) * (.7 + .6 * pl) * (1. - .7 * bpl), bk);
  // posts: red dirt and darkening where they go into the ground
  let gd = select(0., ss(.22, -.02, op.y), ax == 1);
  col = mix(col, vec3f(.16, .085, .045), gd * .7);
  let adz = select(.5, fract(al * 5.5 + gN(al * .5, cp * 3., wq) * 2.), beam);
  let T = normalize(cross(A, on) + vec3f(1e-4));
  m.a = col;
  m.n = (T * ((s2 - .5) * .4 * mg + (late - .3) * .15 * mg) - on * crack * .6) * (1. - endg)
      + A * (adz - .5) * .25 * (1. - endg) + (T * (pl - .5) * 1.2 - on * bpl * .5) * bk;
  m.gl = .006 * (1. - crack);
  return m;
}
`;
