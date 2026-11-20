// ============================================================================
// WGSL sources
// ============================================================================

// The moon: full, low in the west (-z), a little to the north (+x). Its light casts the (baked) shadows.
// Its place is the real one at the start of totality (astro.js): 13.45 degrees up, azimuth 279.4 (9.4 degrees north of west).
// Compass used throughout: -z west, +z east, +x north, -x south.
const MOON = (() => { const el = 13.45 * PI / 180, az = 9.36 * PI / 180; return [cos(el) * sin(az), sin(el), -cos(el) * cos(az)]; })();
// Camp: centre of the flat clearing (x, ground height, z). The terrain generator flattens the ground around it.
const CAMP = [0, -45, 2];
// The canyon (M2): a winding main canyon, closed at both ends, with side pockets off it. Everything outside is the
// plateau, standing 26-43 m above the floor, so the walls are the boundary of the map.
// Main canyon centreline, west to east: x, z, half width.
const CANYON = [[-18, -150, 9], [6, -124, 14], [-6, -82, 17], [0, -40, 16], [-4, 2, 13.5], [-6, 36, 15], [12, 70, 17], [8, 86, 7], [-3, 106, 15], [6, 122, 6.5], [10, 134, 11], [4, 150, 8]];
// Side pockets: ax, az, bx, bz, half width at a, at b. The basin off the west reach holds the 1870s ruins (M3).
const POCKETS = [[-6, -82, -38, -88, 10, 9], [-38, -88, -54, -78, 13, 15], [-46, -86, -62, -98, 12, 9], [-52, -80, -66, -74, 9, 6], [-6, 36, 30, 46, 7, 9], [-3, 106, -32, 118, 7, 8]];
// The dirt road out: from the camp landing up through a cut in the north wall: x, z, height above the camp floor,
// half width. Its foot is the landing behind the pickup and trailer, which are parked across it end to end.
const RAMP = [[5, 1.7, 0, 6.45], [12, 1.7, 0, 6.45], [17, 2.2, 0.6, 4.5], [24, 3, 1.5, 4], [40, 8, 3.6, 4], [62, -2, 7.5, 4], [86, -18, 11.5, 4], [112, -30, 15.5, 4], [140, -40, 20, 4], [178, -50, 26, 4]];
const wv = (a) => a.map((p) => 'vec' + p.length + 'f(' + p.join(', ') + ')').join(', ');
// Milky Way: the normal of its plane is the galactic north pole, 32.7 degrees up at azimuth 78 (7 November 1957, 5 a.m.,
// southern California). The band rises from the north-north-west horizon, passes 57 degrees up in the west (above the
// moon) and comes down in the south-south-east; its bright centre is far below the horizon, so this is the faint half.
const MWN = (() => { const al = 32.7 * PI / 180, az = 78 * PI / 180; return [cos(al) * cos(az), sin(al), cos(al) * sin(az)]; })();

const W_NOISE = /*wgsl*/`
fn ss(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0., 1.); return t * t * (3. - 2. * t); }
fn h31(p: vec3f) -> f32 { var q = fract(p * vec3f(.1031, .1030, .0973)); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
fn h33(p: vec3f) -> vec3f { var q = fract(p * vec3f(.1031, .1030, .0973)); q += dot(q, q.yxz + 33.33); return fract((q.xxy + q.yxx) * q.zyx); }
fn vn(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3. - 2. * f);
  return mix(mix(mix(h31(i), h31(i + vec3f(1., 0., 0.)), u.x), mix(h31(i + vec3f(0., 1., 0.)), h31(i + vec3f(1., 1., 0.)), u.x), u.y),
             mix(mix(h31(i + vec3f(0., 0., 1.)), h31(i + vec3f(1., 0., 1.)), u.x), mix(h31(i + vec3f(0., 1., 1.)), h31(i + vec3f(1., 1., 1.)), u.x), u.y), u.z);
}
fn fbm(p: vec3f, n: i32) -> f32 {
  var a = .5; var s = 0.; var q = p;
  for (var i = 0; i < n; i++) { s += a * vn(q); q = q * 2.03 + vec3f(17.1, 31.7, 5.3); a *= .5; }
  return s / (1. - 2. * a);
}
fn wor(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p); var d = 9.;
  for (var x = -1; x <= 1; x++) { for (var y = -1; y <= 1; y++) { for (var z = -1; z <= 1; z++) {
    let o = vec3f(f32(x), f32(y), f32(z)); let r = o + h33(i + o) - f; d = min(d, dot(r, r));
  } } }
  return sqrt(d);
}
`;

// ---------------------------------------------------------------- terrain density (compute)
const W_DENS = W_NOISE + /*wgsl*/`
struct U { n: vec4u, o: vec4f, c: vec4u };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read_write> D: array<f32>;
@group(0) @binding(2) var<storage, read> P: array<vec4f>;
fn smax(a: f32, b: f32, k: f32) -> f32 { let h = max(k - abs(a - b), 0.) / k; return max(a, b) + h * h * k * .25; }
fn smin(a: f32, b: f32, k: f32) -> f32 { return -smax(-a, -b, k); }
fn seg2(p: vec2f, a: vec2f, b: vec2f) -> f32 { let pa = p - a; let ba = b - a; let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0., 1.); return length(pa - ba * h); }
fn seg3(p: vec3f, a: vec3f, b: vec3f) -> f32 { let pa = p - a; let ba = b - a; let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0., 1.); return length(pa - ba * h); }
const NCAN = ${CANYON.length}; const NPOC = ${POCKETS.length}; const NRMP = ${RAMP.length};
var<private> CAN: array<vec3f, NCAN> = array<vec3f, NCAN>(${wv(CANYON)});
var<private> POC: array<vec3f, NPOC * 2> = array<vec3f, NPOC * 2>(${wv(POCKETS.flatMap((k) => [[k[0], k[1], k[4]], [k[2], k[3], k[5]]]))});
var<private> RMP: array<vec4f, NRMP> = array<vec4f, NRMP>(${wv(RAMP)});
fn segp(p: vec2f, a: vec2f, b: vec2f) -> vec2f { let pa = p - a; let ba = b - a; let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0., 1.); return vec2f(length(pa - ba * h), h); }
// signed distance to the canyon and its pockets in plan (negative inside)
fn canyonD(p: vec2f) -> f32 {
  var d = 1e3;
  for (var i = 0; i < NCAN - 1; i++) { let a = CAN[i]; let b = CAN[i + 1]; let s = segp(p, a.xy, b.xy); d = smin(d, s.x - mix(a.z, b.z, s.y), 8.); }
  for (var i = 0; i < NPOC; i++) { let a = POC[i * 2]; let b = POC[i * 2 + 1]; let s = segp(p, a.xy, b.xy); d = smin(d, s.x - mix(a.z, b.z, s.y), 6.); }
  return d;
}
// the road: distance outside its corridor (x) and the height of its surface there (y)
fn rampD(p: vec2f) -> vec2f {
  var best = 1e3; var y = 0.;
  for (var i = 0; i < NRMP - 1; i++) { let a = RMP[i]; let b = RMP[i + 1]; let s = segp(p, a.xy, b.xy); let dd = s.x - mix(a.w, b.w, s.y); if (dd < best) { best = dd; y = mix(a.z, b.z, s.y); } }
  return vec2f(best, y);
}
fn dens(p: vec3f) -> f32 {
  let w = vec3f(fbm(p * .04 + 11., 3), fbm(p * .04 + 47., 3), fbm(p * .04 + 83., 3)) - .5;
  let q = p + w * vec3f(15., 6., 15.);
  let g0 = -45.5 + 7. * (fbm(vec3f(q.xz * .011, 3.), 4) - .5) + 1.6 * (fbm(vec3f(q.xz * .07, 9.), 3) - .5);
  let tn = 1. * (fbm(vec3f(q.xz * .09, 2.), 3) - .5); // mesa tops stay nearly flat
  var dm = -1e3; var de = 1e3;
  var k = 0u;
  for (var i = 0u; i < u.c.x; i++) {
    let a = P[k]; let b = P[k + 1u]; k += 2u;
    let yr = clamp((p.y - g0) / (b.y - g0), 0., 1.3);
    var e = seg2(q.xz, a.xy, a.zw) - b.x;
    e -= b.z * .45 * ss(.3, .92, yr) + 3. * (1. - yr) * (1. - yr) - b.w * ss(.0, .5, yr) * (1. - ss(.5, 1., yr));
    dm = smax(dm, smin(-e, b.y + tn - p.y, 3.), 2.5);
    de = min(de, e);
  }
  // the camp clearing: flat ground (the walls around it stay put, and wander less there)
  let pad = 1. - ss(15., 24., length(p.xz - vec2f(${CAMP[0]}, ${CAMP[2]})));
  // the canyon in plan, its edge wandering a little; walls rise to the plateau within a few metres
  let dc = canyonD(p.xz + w.xz * 5. * (1. - pad));
  // toward the setting moon the rims are lower, so the moon shows above them from camp
  let msec = ss(.9, .975, dot(normalize(p.xz - vec2f(${CAMP[0]}, ${CAMP[2]})), normalize(vec2f(${MOON[0]}, ${MOON[2]}))));
  let plat = ss(-1.5, 2.5, dc);
  let g1 = g0 + 3.5 * ss(-7., 0., dc) * (1. - pad); // a talus apron along the foot of the walls
  let bt = ss(.58, .7, fbm(vec3f(q.xz * .018, 8.), 3)) * 14. + ss(.5, .62, fbm(vec3f(q.xz * .05, 12.), 2)) * 5.;
  let th = g1 + plat * (26. + 17. * fbm(vec3f(q.xz * .03, 5.), 2) + bt * ss(4., 14., dc)) * (1. - .42 * msec);
  var d = smax(g1 + 4.5 * ss(10., 0., de) - p.y, dm, 3.);
  d = smax(d, (th - p.y) * .7, 3.);
  k = u.c.x * 2u;
  for (var i = 0u; i < u.c.y; i++) {
    let a = P[k]; let b = P[k + 1u]; k += 2u;
    var r = p + w * 1.2 - a.xyz;
    let cs = cos(a.w); let sn = sin(a.w);
    r = vec3f(cs * r.x + sn * r.z, r.y / b.z, -sn * r.x + cs * r.z);
    d = smax(d, b.y - length(vec2f(length(r.xy) - b.x, r.z)), 1.5);
  }
  let hg = p.y - g0;
  let rk = mix(.1, 1., ss(.5, 5., hg)); // sandy floors stay fairly smooth, rock above them is rough
  // sandstone: level beds of different hardness (hard ones stand out as ledges, soft ones weather back), crisp partings
  // between them, vertical joints and flutes down the faces, and only a little lumpy roughness
  let by = p.y * .32 + w.y * .08; let fb = fract(by);
  let hard = h31(vec3f(floor(by), 3., 7.));
  d += rk * ((hard - .5) * 2.8 + ss(.0, .08, fb) * ss(1., .9, fb) * .8 - .4);
  d += rk * (fbm(vec3f(p.x * .22, p.y * .035, p.z * .22), 3) - .5) * 2.;
  // vertical joints: straight cracks running down through the beds
  let jn = abs(fbm(vec3f(p.x * .07, p.z * .07, 3.), 3) - .5);
  d -= rk * ss(.035, .0, jn) * 1.4;
  d += rk * ((.5 - wor(p * .3 + 7.)) * .18 + (fbm(p * .7, 2) - .5) * .22);
  for (var i = 0u; i < u.c.z; i++) {
    let a = P[k]; let b = P[k + 1u]; k += 2u;
    d = smin(d, seg3(p + w * 2., a.xyz, b.xyz) - a.w, 2.);
  }
  d = mix(d, ${CAMP[1]} - p.y, pad * (1. - plat));
  // the road: open air above its surface inside the cut, with ragged walls
  let rd = rampD(p.xz);
  let ry = ${CAMP[1]} + rd.y;
  d = min(d, max(rd.x - max(p.y - ry, 0.) * .75 + (fbm(p * .3 + 5., 2) - .5) * 1.4, ry - p.y));
  return min(d, 3. - p.y);
}
@compute @workgroup_size(4, 4, 4) fn main(@builtin(global_invocation_id) id: vec3u) {
  if (any(id >= u.n.xyz)) { return; }
  var d = dens(u.o.xyz + vec3f(id) * u.o.w);
  if (id.x == 0u || id.z == 0u || id.x == u.n.x - 1u || id.z == u.n.z - 1u || id.y == u.n.y - 1u) { d = -1.; }
  D[id.x + u.n.x * (id.y + u.n.y * id.z)] = d;
}
`;

// ---------------------------------------------------------------- fullscreen helpers
const W_FS = /*wgsl*/`
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { return vec4f(f32(i32(i & 1u) * 4 - 1), f32(i32(i >> 1u) * 4 - 1), 0., 1.); }
`;

// rock detail texture (tileable): rg = slope, b = height, a = mottling
const W_DETAIL = W_NOISE + W_FS + /*wgsl*/`
fn hp(p: vec2f, per: f32) -> f32 { return h31(vec3f(p - per * floor(p / per), per)); }
fn tn(p: vec2f, per: f32) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3. - 2. * f);
  return mix(mix(hp(i, per), hp(i + vec2f(1., 0.), per), u.x), mix(hp(i + vec2f(0., 1.), per), hp(i + vec2f(1., 1.), per), u.x), u.y);
}
fn tf(uv: vec2f, per: f32, n: i32) -> f32 { var a = .5; var s = 0.; var pr = per; for (var i = 0; i < n; i++) { s += a * tn(uv * pr + f32(i) * 7.3, pr); pr *= 2.; a *= .5; } return s / (1. - 2. * a); }
fn tw(p: vec2f, per: f32) -> vec3f {
  let i = floor(p); let f = fract(p); var d = vec2f(9.); var id = 0.;
  for (var x = -1; x <= 1; x++) { for (var y = -1; y <= 1; y++) {
    let o = vec2f(f32(x), f32(y)); let c = i + o; let cw = c - per * floor(c / per);
    let hh = h33(vec3f(cw, per)); let r = o + hh.xy - f; let l = dot(r, r);
    if (l < d.x) { d.y = d.x; d.x = l; id = hh.z; } else if (l < d.y) { d.y = l; }
  } }
  return vec3f(sqrt(d), id);
}
fn H(uv: vec2f) -> f32 {
  let wq = uv + .11 * (vec2f(tf(uv, 3., 4), tf(uv + .5, 3., 4)) - .5);
  let f = tf(wq, 3., 8);
  let r1 = 1. - abs(tf(wq + 1.7, 5., 6) * 2. - 1.);
  let cr = min(abs(tf(wq + 4.1, 4., 5) * 2. - 1.) * 7., 1.);
  let cr2 = min(abs(tf(wq.yx + 2.3, 9., 4) * 2. - 1.) * 9., 1.);
  let pt = tw(wq * 29., 29.);
  let pit = (1. - ss(.0, .34, pt.x)) * step(.62, pt.z);
  return f * .50 + r1 * r1 * .24 + cr * cr2 * .26 - pit * .07;
}
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = fc.xy / 1024.; let e = 1. / 1024.;
  let h = H(uv);
  let gx = H(uv + vec2f(e, 0.)) - H(uv - vec2f(e, 0.)); let gy = H(uv + vec2f(0., e)) - H(uv - vec2f(0., e));
  let s = clamp(vec2f(gx, gy) * 1024. * .5 * .075, vec2f(-1.), vec2f(1.));
  return vec4f(-s * .5 + .5, h, tf(uv + 3.7, 3., 5));
}
`;

// blit / mip / bloom chain
const W_BLIT = W_FS + /*wgsl*/`
@group(0) @binding(0) var t: texture_2d<f32>;
@group(0) @binding(1) var s: sampler;
fn uvOf(fc: vec4f, k: f32) -> vec2f { return fc.xy * k / vec2f(textureDimensions(t)); }
@fragment fn fsMip(@builtin(position) fc: vec4f) -> @location(0) vec4f { return textureSampleLevel(t, s, uvOf(fc, 2.), 0.); }
fn kar(c: vec3f) -> vec4f { let w = 1. / (1. + max(c.r, max(c.g, c.b))); return vec4f(c * w, w); }
@fragment fn fsDown0(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = uvOf(fc, 2.); let e = 1. / vec2f(textureDimensions(t));
  let a = kar(min(textureSampleLevel(t, s, uv + e * vec2f(-1., -1.), 0.).rgb, vec3f(24.)));
  let b = kar(min(textureSampleLevel(t, s, uv + e * vec2f(1., -1.), 0.).rgb, vec3f(24.)));
  let c = kar(min(textureSampleLevel(t, s, uv + e * vec2f(-1., 1.), 0.).rgb, vec3f(24.)));
  let d = kar(min(textureSampleLevel(t, s, uv + e * vec2f(1., 1.), 0.).rgb, vec3f(24.)));
  let m = a + b + c + d;
  return vec4f(m.rgb / m.a, 1.);
}
@fragment fn fsDown(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = uvOf(fc, 2.); let e = 1. / vec2f(textureDimensions(t));
  return (textureSampleLevel(t, s, uv + e * vec2f(-1., -1.), 0.) + textureSampleLevel(t, s, uv + e * vec2f(1., -1.), 0.)
        + textureSampleLevel(t, s, uv + e * vec2f(-1., 1.), 0.) + textureSampleLevel(t, s, uv + e * vec2f(1., 1.), 0.)) * .25;
}
@fragment fn fsUp(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = uvOf(fc, .5); let e = .75 / vec2f(textureDimensions(t));
  return (textureSampleLevel(t, s, uv + e * vec2f(-1., -1.), 0.) + textureSampleLevel(t, s, uv + e * vec2f(1., -1.), 0.)
        + textureSampleLevel(t, s, uv + e * vec2f(-1., 1.), 0.) + textureSampleLevel(t, s, uv + e * vec2f(1., 1.), 0.)) * .25;
}
`;

// ---------------------------------------------------------------- shared scene code
// Light units: moonlight on a surface facing the moon is about 0.6; the post pass scales everything by the exposure.
const S_G = /*wgsl*/`
// mc: moonlight (rgb, after the eclipse) and how much of the moon's light is left (w, 1 uneclipsed .. ~.01 in totality)
// ec: the earth's shadow on the moon: its centre (xy, in moon radii, x right and y up on the disc), umbra and penumbra radii
struct G { vp: mat4x4f, sm: mat4x4f, cam: vec4f, right: vec4f, up: vec4f, fwd: vec4f, sun: vec4f, res: vec4f, mis: vec4f, fire: vec4f, lant: vec4f, mc: vec4f, ec: vec4f, tn: vec4f, lm: mat4x4f, ld: vec4f };
const TAU = 6.2831853;
const LOW = ${LV > 1};
const MOON = vec3f(${MOON});
const MWN = vec3f(${MWN});
// sky light in the shadows: moonlight scattered by the air (blue, goes with the moon), and airglow + starlight (always there)
const SKYA = vec3f(.030, .045, .095);
const SKY0 = vec3f(.0045, .0055, .0085);
const FIREC = vec3f(1., .40, .12);
const LANTC = vec3f(1., .64, .34);
fn sat(x: f32) -> f32 { return clamp(x, 0., 1.); }
fn ss(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0., 1.); return t * t * (3. - 2. * t); }
fn ign(p: vec2f) -> f32 { return fract(52.9829189 * fract(dot(p, vec2f(.06711056, .00583715)))); }
fn hs(x: f32) -> f32 { return fract(sin(x * 127.1) * 43758.5453); }
fn fin(c: vec3f) -> vec4f { return vec4f(min(max(c, vec3f(0.)), vec3f(60.)), 1.); }
// the breeze: 0.35 calm .. 1 in a gust, gusts travel across the canyon
fn gust(t: f32, p: vec2f) -> f32 { let s = t - dot(p, vec2f(.05, .02)); return .35 + .65 * pow(.5 + .5 * sin(s * .37) * sin(s * .23 + 1.3), 2.); }
// the night sky without stars. Moonlight scattered by the air makes a dim day-blue sky, lighter low down and toward the
// moon, with a warm glow round the moon itself; under it the faint airglow, brightest along the horizon. In totality only
// the airglow is left.
fn skyBase(rd: vec3f) -> vec3f {
  let up = sat(rd.y); let mu = sat(dot(rd, MOON)); let ml = g.mc.w;
  var c = mix(vec3f(.0050, .0056, .0070), vec3f(.0010, .0013, .0026), pow(up, .35));
  c += mix(vec3f(.030, .040, .062), vec3f(.0060, .0105, .0260), pow(up, .45)) * (1. + .8 * mu * mu) * ml;
  c += g.mc.rgb * vec3f(.10, .08, .065) * (pow(mu, 6.) * .3 + pow(mu, 40.) * .5 + pow(mu, 400.) * 1.5);
  return c * select(1., .6, rd.y < 0.);
}
`;

const S_B = S_G + /*wgsl*/`
@group(0) @binding(0) var<uniform> g: G;
@group(0) @binding(1) var sR: sampler;
@group(0) @binding(2) var sC: sampler;
@group(0) @binding(3) var sS: sampler_comparison;
@group(0) @binding(4) var tSh: texture_depth_2d;
@group(0) @binding(5) var tLS: texture_depth_2d;
@group(0) @binding(6) var tD: texture_2d<f32>;
@group(0) @binding(7) var tV: texture_3d<f32>;
@group(0) @binding(8) var tM: texture_2d<f32>;
@group(0) @binding(9) var tPA: texture_2d<f32>;
@group(0) @binding(10) var sP: sampler;
fn shUV(p: vec3f) -> vec3f { let s = g.sm * vec4f(p, 1.); return vec3f(s.x * .5 + .5, .5 - s.y * .5, s.z - .0004); }
fn shadow1(p: vec3f) -> f32 { let s = shUV(p); return textureSampleCompareLevel(tSh, sS, s.xy, s.z); }
fn shadow9(p: vec3f) -> f32 {
  if (LOW) { return shadow1(p); }
  let s = shUV(p); let e = 1.6 / ${SHADOW}.; var a = 0.;
  for (var x = -1; x <= 1; x++) { for (var y = -1; y <= 1; y++) { a += textureSampleCompareLevel(tSh, sS, s.xy + vec2f(f32(x), f32(y)) * e, s.z); } }
  return a / 9.;
}
fn shadowSoft(p: vec3f) -> f32 {
  let s = shUV(p); let e = 7. / ${SHADOW}.; var a = 0.;
  for (var x = -2; x <= 2; x++) { for (var y = -2; y <= 2; y++) { a += textureSampleCompareLevel(tSh, sS, s.xy + vec2f(f32(x), f32(y)) * e, s.z); } }
  return a / 25.;
}
fn vol(p: vec3f) -> vec4f { return textureSampleLevel(tV, sC, (p - vec3f(-192., -56., -192.)) / vec3f(384., 60., 384.), 0.); }
// point lights: g.fire and g.lant are position + strength (flicker included); short range, fast fall-off, no shadows
const FIRER = 16.; const LANTR = 70.;
// fall-off: k is how fast. The fire is physical (fast); the lantern's reflector and the eye's sensitivity to a warm
// light at night make its pool fade more gently, so it shows the way ahead instead of only your feet
fn att(p: vec3f, l: vec4f, r: f32) -> f32 {
  let d = distance(l.xyz, p);
  if (r == LANTR) { // the lantern: inverse square, like a real flame (a 10-candle lantern, doubled ahead by the
    // reflector: about full moonlight on a wall 10 m ahead, a quarter moon at 25 m, a little over starlight at 50 m);
    // the 1.6 is the flame and globe's size, the window only takes the last stretch to nothing
    let q = d / LANTR; let w = sat(1. - q * q * q * q);
    return l.w * w * w / (1.6 + .2 * d * d);
  }
  let w = sat(1. - d * d / (r * r)); return l.w * w * w / (1.6 + 1.3 * d * d);
}
// The camp's big things as rounded boxes (camp coordinates, metres from the fire: centre + yaw, half size + rounding),
// so the fire and the lantern cast soft shadows past them and the ground darkens a little under them.
// Keep in step with meshCamp() in world.js. The tent is a hollow shell with its door open toward the fire.
const NCB = 11;
var<private> CB: array<vec4f, 22> = array<vec4f, 22>(
  vec4f(8., .75, -5.22, 0.), vec4f(.9, .4, 1.5, .08),      // pickup: hood, fenders, lower cab
  vec4f(8., 1.54, -4.35, 0.), vec4f(.78, .3, .66, .06),    // pickup: cab
  vec4f(8., .8, -2.7, 0.), vec4f(.74, .48, .88, .04),      // pickup: bed
  vec4f(8., 1.52, 2.96, 0.), vec4f(.75, .62, 2.7, .42),     // trailer
  vec4f(2.3, .2, 2.4, .4), vec4f(.32, .2, .18, .02),        // cooler
  vec4f(-3.0, .17, -2.55, 0.), vec4f(.3, .17, .4, .05),     // firewood
  vec4f(5.83, .24, 1.22, 0.), vec4f(.08, .23, .22, .01),    // jerry can
  vec4f(2.75, .15, 5.3, .72), vec4f(.15, .13, .38, .05),    // duffel bag
  vec4f(3.4, .71, -.9, .25), vec4f(.3, .02, .62, .01),      // camp table top
  vec4f(3.4, .82, -.9, .25), vec4f(.13, .1, .6, .02),       // stove and radio on it
  vec4f(-2.35, .14, 6.0, .3), vec4f(.25, .14, .2, .02));    // tackle box and bucket
const CAMPV = vec3f(${CAMP});
fn sdb(p: vec3f, i: i32) -> f32 {
  let a = CB[i * 2]; let b = CB[i * 2 + 1]; let q0 = p - a.xyz; let c = cos(a.w); let s = sin(a.w);
  let q = abs(vec3f(c * q0.x - s * q0.z, q0.y, s * q0.x + c * q0.z)) - b.xyz + b.w;
  return length(max(q, vec3f(0.))) + min(max(q.x, max(q.y, q.z)), 0.) - b.w;
}
fn campBoxes(p: vec3f) -> f32 { var d = 1e3; for (var i = 0; i < NCB; i++) { d = min(d, sdb(p, i)); } return d; }
fn campSD(p: vec3f) -> f32 {
  let d = campBoxes(p);
  // tent: canvas shell, door gap toward the fire
  let tq = p - vec3f(1., 1.17, 7.5); let tb = abs(tq) - vec3f(1.5, 1.17, 1.8);
  let shell = abs(length(max(tb, vec3f(0.))) + min(max(tb.x, max(tb.y, tb.z)), 0.)) - .03;
  let dq = abs(p - vec3f(1., .93, 5.7)) - vec3f(.5, .93, .3);
  return min(d, max(shell, -(length(max(dq, vec3f(0.))) + min(max(dq.x, max(dq.y, dq.z)), 0.))));
}
// how much of the light at l reaches p (soft, from a few steps along the way)
fn campVis(p: vec3f, l: vec3f, r: f32) -> f32 {
  let q = p - CAMPV; let lq = l - CAMPV;
  if (dot(q.xz, q.xz) > 600. || distance(p, l) > r) { return 1.; }
  let dl = lq - q; let L = length(dl); let rd = dl / L;
  var t = .05; var v = 1.;
  for (var k = 0; k < 14; k++) {
    let h = campBoxes(q + rd * t); v = min(v, 8. * h / t); t += clamp(h, .03, max(L * .1, .08));
    if (t > L - .15 || v < .02) { break; }
  }
  return ss(0., 1., v);
}
// contact darkening on and near the camp things
fn campAO(p: vec3f) -> f32 { let q = p - CAMPV; if (dot(q.xz, q.xz) > 600.) { return 1.; } return .4 + .6 * ss(0., .7, campBoxes(q)); } // not the tent: its walls are cloth, and a box is a poor fit for its roof
// The lantern with its clip-on tin reflector (g.ld.xyz: where the reflector throws the light). Ahead the reflector
// adds its bounce to the flame, so the light fans forward; behind and to the sides only the shielded spill is left.
// Straight down the lantern's own fount shades the ground (the dark disc under every hanging lantern). The forward fan
// also has a shadow map (g.lm, tLS), so rocks, plants and the camp throw moving shadows as the lantern swings.
fn lantShadow(p: vec3f) -> f32 {
  if (g.ld.w < .5) { return 1.; }
  let c = g.lm * vec4f(p, 1.);
  if (c.w <= .05) { return 1.; }
  let u = c.xy / c.w;
  if (abs(u.x) > .98 || abs(u.y) > .98) { return 1.; }
  let uv = vec2f(u.x * .5 + .5, .5 - u.y * .5); let z = c.z / c.w - .0006;
  if (z >= 1.) { return 1.; } let e = 1.3 / 1024.;
  var a = textureSampleCompareLevel(tLS, sS, uv, z) * 2.;
  a += textureSampleCompareLevel(tLS, sS, uv + vec2f(e, e), z) + textureSampleCompareLevel(tLS, sS, uv + vec2f(-e, e), z);
  a += textureSampleCompareLevel(tLS, sS, uv + vec2f(e, -e), z) + textureSampleCompareLevel(tLS, sS, uv + vec2f(-e, -e), z);
  return a / 6.;
}
fn lantF(p: vec3f) -> f32 {
  let v = p - g.lant.xyz; let d = length(v);
  if (d > LANTR) { return 0.; }
  let dir = v / max(d, 1e-3); let c = dot(dir, g.ld.xyz);
  // the reflector: a soft wide fan with a hot centre (where it is aimed), the shielded spill behind and aside
  let fan = mix(.2, .6, g.tn.w) + 1.7 * ss(.3, .85, c) + 3.3 * ss(.88, .985, c);                       // spill behind and aside .. the reflector's fan ahead
  let fount = 1. - .8 * ss(.82, .97, -dir.y);                    // the fount's shadow straight below
  return fan * fount * select(1., lantShadow(p), c > .05);
}
fn plV(p: vec3f) -> vec2f { return vec2f(campVis(p, g.fire.xyz, FIRER), campVis(p, g.lant.xyz, LANTR) * lantF(p)); }
fn plD(p: vec3f, n: vec3f, v: vec2f) -> vec3f {
  let lf = normalize(g.fire.xyz - p); let ll = normalize(g.lant.xyz - p);
  return FIREC * att(p, g.fire, FIRER) * sat(dot(n, lf) * .8 + .2) * v.x + LANTC * att(p, g.lant, LANTR) * sat(dot(n, ll) * .8 + .2) * v.y;
}
fn plS(p: vec3f, n: vec3f, V: vec3f, pw: f32, v: vec2f) -> vec3f {
  let lf = normalize(g.fire.xyz - p); let ll = normalize(g.lant.xyz - p);
  return FIREC * att(p, g.fire, FIRER) * pow(sat(dot(n, normalize(V + lf))), pw) * sat(dot(n, lf) * 4.) * v.x
       + LANTC * att(p, g.lant, LANTR) * pow(sat(dot(n, normalize(V + ll))), pw) * sat(dot(n, ll) * 4.) * v.y;
}
// sky light from above (sky: how open to the sky, from the baked volume) and a little warm bounce from the ground
fn amb(n: vec3f, sky: f32) -> vec3f { let up = n.y * .5 + .5; return (SKYA * g.mc.w + SKY0) * g.tn.x * (.2 + .8 * sky) * (.3 + .7 * up) + g.mc.rgb * .05 * (.4 + .6 * sat(dot(n, -vec3f(MOON.x, 0., MOON.z)))) * (.5 + .5 * sky); }
// thin, dry desert air: far rock takes on a little of the sky's blue, and at the end of the draw distance it is all sky
// Light hanging in the air: the night air (and the fire's smoke) scatters a little of the fire and lantern light toward
// the eye along every view ray, so both sit in a soft glow instead of just painting the ground. Closed form of the
// point light's 1/d^2 summed along the ray from the eye, out to distance L.
fn airGlow(rd: vec3f, L: f32, lp: vec3f, I: f32) -> f32 {
  let o = lp - g.cam.xyz; let t0 = dot(o, rd); let h = max(length(o - rd * t0), .12);
  return I * (atan((L - t0) / h) - atan(-t0 / h)) / h;
}
fn inScatter(rd: vec3f, L: f32) -> vec3f {
  return FIREC * airGlow(rd, L, g.fire.xyz + vec3f(0., .5, 0.), g.fire.w) * .00035 + LANTC * airGlow(rd, L, g.lant.xyz, g.lant.w) * .000027;
}
fn fog(c: vec3f, wp: vec3f) -> vec3f {
  let v = wp - g.cam.xyz; let d = length(v); let rd = v / d;
  let T = exp(-d * .0028);
  let o = c * T + skyBase(vec3f(rd.x, .04, rd.z)) * .6 * (1. - T);
  // moonlit air (g.sun.w: LOOK.haze): the low moon lights the air over the canyon, so the further the rock the more
  // of a faint blue-grey veil lies over it; the walls, rims and ruins stand out in layers against it, and the sky
  // behind them is a little lighter still
  let hz = g.sun.w * (SKYA * g.mc.w * 1.4 + SKY0 * 1.5) * (.75 + .5 * pow(sat(dot(rd, MOON)), 3.));
  return mix(o, skyBase(rd), ss(195., 235., d)) + hz * (1. - exp(-d * .03)) + inScatter(rd, d);
}
fn qrot(q: vec4f, v: vec3f) -> vec3f { return v + 2. * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
`;

// ---------------------------------------------------------------- solid meshes (terrain, rocks, camp, cacti, trunks, lantern)
// mat (instance): 0 terrain, 1 rock, 2 painted part list (the part id is in each vertex: see prop())
const W_SOLID = S_B + /*wgsl*/`
struct VI { @location(0) p: vec3f, @location(1) n: vec4f, @location(2) a: vec4f, @location(3) b: vec4f, @location(4) c: vec4f };
struct VO { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) op: vec3f, @location(3) on: vec3f,
  @location(4) @interpolate(flat) m: vec4f, @location(5) @interpolate(flat) q: vec4f, @location(6) ao: f32, @location(7) va: f32 };
@vertex fn vs(i: VI) -> VO {
  var o: VO;
  var sc = i.a.w;
  if (i.c.x < 1.5 && i.c.z > 1.5 && g.res.x > 0.) { sc *= 1. - ss(i.c.z * .7, i.c.z, distance(i.a.xyz, g.cam.xyz) / g.mis.z); }
  var w = i.a.xyz + qrot(i.b, i.p * sc);
  o.cp = g.vp * vec4f(w, 1.); o.wp = w; o.n = qrot(i.b, i.n.xyz); o.op = i.p * i.a.w + i.c.y * 37.; o.on = i.n.xyz;
  o.m = i.c; o.q = i.b; o.ao = i.n.w;
  o.va = sat((length(i.n.xyz) - .4) / .58); // baked occlusion, stored as the length of the normal (Mesh.build)
  return o;
}
struct TP { h: f32, c: f32, n: vec3f };
fn tri(p: vec3f, n: vec3f, s: f32) -> TP {
  var w = pow(abs(n), vec3f(4.)); w /= (w.x + w.y + w.z);
  let x = textureSample(tD, sR, p.zy * s); let y = textureSample(tD, sR, p.xz * s); let z = textureSample(tD, sR, p.xy * s);
  var o: TP;
  o.h = x.b * w.x + y.b * w.y + z.b * w.z;
  o.c = x.a * w.x + y.a * w.y + z.a * w.z;
  let a = x.rg * 2. - 1.; let b = y.rg * 2. - 1.; let c = z.rg * 2. - 1.;
  o.n = vec3f(0., a.y, a.x) * w.x + vec3f(b.x, 0., b.y) * w.y + vec3f(c.x, c.y, 0.) * w.z;
  return o;
}
// part list: albedo, gloss, metal, bump, emission
struct PM { a: vec3f, gl: f32, mt: f32, bp: f32, e: vec3f, n: vec3f, tl: f32 }; // n: extra normal tilt, tl: translucency
fn vn2d(p: vec2f) -> f32 { let i = floor(p); let f = fract(p); let u = f * f * (3. - 2. * f); let n = i.x + i.y * 57.;
  return mix(mix(hs(n), hs(n + 1.), u.x), mix(hs(n + 57.), hs(n + 58.), u.x), u.y); }
${paperWGSL()}
${signWGSL()}
fn prop(id: i32, op: vec3f, on: vec3f, mc: f32, h: f32, pfw: f32, sd: f32, cv: f32) -> PM {
  if (id >= ${PAPER0} && id < ${PAPER0 + PAPERS.length}) { return paperPM(id, op, pfw); }
  if (id >= 100 && id <= 108) { return woodPM(id, op - vec3f(sd * 37.), on, h, pfw, sd); }
  if (id == 70) {   // the sign board: brown wood with the name routed into its face, cream paint in the grooves
    var m = woodPM(103, op - vec3f(sd * 37.), on, h, pfw, sd);
    if (on.z > .5) {
      let q = op.xy - vec2f(sd * 37.); let e = .0008;
      let d = signD(q); let g = normalize(vec2f(signD(q + vec2f(e, 0.)) - d, signD(q + vec2f(0., e)) - d) + vec2f(1e-6));
      let r = .0088; let aa = max(pfw * 1.5, .0006);
      let inG = ss(r + aa * .5, r - aa * .5, d);           // in the groove
      let wall = ss(r * .55, r, d) * inG;                  // its rounded side, sloping down to the floor
      let chip = ss(.62, .7, vn2d(q * 160.)) * ss(.4, .8, vn2d(q * 22. + 5.));
      let paint = vec3f(.62, .56, .40) * (.8 + .3 * vn2d(q * 420.));
      m.a = mix(m.a, mix(paint, m.a * .55, max(chip, ss(.55, .95, d / r))), inG) * (1. - .55 * wall);
      m.n += vec3f(-g * wall * 1.4, 0.);
      m.gl = mix(m.gl, .06, inG * (1. - chip));
    }
    return m;
  }
  var m: PM; m.a = vec3f(.5); m.gl = .05; m.mt = 0.; m.bp = .03; m.e = vec3f(0.); m.n = vec3f(0.); m.tl = 0.;
  switch id {
    case 1 { m.a = vec3f(.58, .54, .44); m.gl = .22; m.bp = 0.; }             // cream paint
    case 2 { m.a = vec3f(.25, .40, .37); m.gl = .2; m.bp = 0.; }              // turquoise paint
    case 3 { m.a = vec3f(.78, .78, .8); m.gl = .9; m.mt = .95; m.bp = 0.; }   // chrome (it reflects the lit ground: fs)
    case 4 { m.a = vec3f(.035); m.gl = .15; m.bp = .3; }                         // tyre rubber
    case 5 { m.a = vec3f(.72, .71, .67); m.gl = .2; m.bp = .1; }               // whitewall
    case 6 { m.a = vec3f(.02, .024, .03); m.gl = 1.; m.mt = .5; m.bp = 0.; }   // window glass
    case 7 {   // aluminium skin, twenty summers old: oxidised to a satin grey, each panel a little different, darker seams,
      // shallow dents, dull streaks running down
      let pz = op.z / .62; let py = op.y / .55; let pid = floor(pz) * 7.1 + floor(py) * 3.3;
      let sz = abs(fract(pz) - .5); let sy = abs(fract(py) - .5);
      let seam = max(ss(.012, .0, sz - .488), ss(.012, .0, sy - .488));
      let dent = vn2d(op.zy * 3.5 + vec2f(pid)); let stk = ss(.55, .8, vn2d(vec2f(op.z * 9. + pid, op.y * .7)));
      m.a = vec3f(.44, .45, .46) * (.86 + .2 * hs(pid)) * (1. - .55 * seam) * (1. - .12 * stk) * (.93 + .1 * vn2d(op.zy * 40.));
      m.gl = .28 * (1. - .4 * stk); m.mt = .25; m.bp = 0.; m.n = vec3f(0., dent - .5, dent - .5) * .08; }
    case 8 {   // white canvas: sewn panels with felled seams, uneven threads, folds and sag, water marks, red dust low
      let sw = op.x + op.z; let md = ss(.012, .004, pfw);
      let sd0 = abs(fract(sw / .92) - .5); let seam = ss(.02, .0, sd0 - .47);
      let st = step(.5, fract(op.y * 110.)) * ss(.012, .0, abs(sd0 - .462));
      let wv = (sin(op.x * 1700.) * sin(op.y * 1700.) + sin(op.z * 1700.) * sin(op.y * 1650.)) * .5 * ss(.0008, .0003, pfw);
      let slub = (vn2d(vec2f(op.y * 260. + sw * 37., sw * 4. + op.y * 3.)) - .5) * md;
      let stain = ss(.55, .78, vn2d(vec2f(sw * 1.3, op.y * 2.1))) * .16 + ss(.62, .8, vn2d(vec2f(sw * 6., op.y * 5.))) * .1;
      let dirt = ss(.55, .0, op.y) * .4;
      m.a = vec3f(.62, .59, .51) * (.93 + .1 * mc) * (1. - .22 * seam - .25 * st) * (1. + .05 * wv + .02 * slub) * (1. - stain) * mix(vec3f(1.), vec3f(.78, .6, .42), dirt); m.gl = .02; m.bp = 0.; m.tl = .5;
      let w1 = vn2d(vec2f(sw * 3., op.y * 4.)) * 2. - 1.; let w2 = vn2d(vec2f(sw * 7. + 3., op.y * 9.)) * 2. - 1.; let w3 = vn2d(vec2f(sw * 19., op.y * 23.)) * 2. - 1.;
      m.n = vec3f(w1 * .1 + w2 * .05 + w3 * .025 * md + slub * .05, 0., w2 * .08 - w1 * .04) + vec3f(sign(fract(sw / .92) - .5), 0., 0.) * seam * .25; }
    case 9 { let gr = vn2d(vec2f((op.x + op.z) * 9., op.y * 140. + (op.x - op.z) * 140.)); m.a = vec3f(.30, .20, .11) * (.8 + .35 * gr); m.gl = .15; m.bp = .02; }   // wood, with a grain
    case 10 { m.a = vec3f(.20, .135, .08) * (.8 + .35 * vn2d(vec2f((op.x + op.z) * 40., op.y * 3.))); m.bp = .04; }                          // dark wood, poles
    case 11 { m.a = vec3f(.07, .14, .09) * (.85 + .3 * mc); m.gl = .35; m.bp = .05; }             // green steel
    case 12 { m.a = vec3f(.30, .02, .015); m.gl = .5; m.bp = 0.; }              // red tail light
    case 13 { m.a = vec3f(.33, .22, .16) * (.6 + .6 * h); m.bp = 1.4; }        // stone
    case 14 { let ck = vn2d(op.xz * 90. + op.y * 70.); let cr = 1. - ss(0., .06, abs(fract(ck * 4.) - .5) - .38); m.a = vec3f(.03, .027, .025) * (.7 + .5 * ck) + vec3f(.12) * ss(.7, .9, vn2d(op.xz * 30.)) * .5; m.a *= 1. - .7 * cr; m.gl = .08 * (1. - cr); m.bp = .2; m.n = vec3f(ck - .5, 0., cr - .5) * .3; }   // charcoal: checked into blocks, a silvery sheen
    case 15 { m.a = vec3f(.03, .02, .015); m.bp = 1.2;                          // embers in the fire bed
      m.e = vec3f(1., .22, .03) * g.fire.w * .05 * ss(.35, .8, mc + .25 * sin(g.cam.w * 2. + op.x * 9.)); }
    case 16 { m.a = vec3f(.30, .29, .28); m.bp = .6; }                         // ash
    case 17 { m.a = vec3f(.42, .36, .24) * (.85 + .3 * mc); m.gl = .03; m.bp = .08; }  // khaki canvas
    case 18 { m.a = vec3f(.55, .48, .35); m.bp = .5; }                         // rope
    case 19 { m.a = vec3f(.13, .14, .08) * (1. - .45 * ss(.012, .0, abs(abs(op.z - 1.225) / .2 - abs(op.y - .235) / .21)) * step(.83, abs(op.x - 5.835) / .085)); m.gl = .3; m.bp = .1; } // olive drab steel, X-stamped can sides
    case 20 { m.a = vec3f(.10, .20, .42); m.gl = .7; m.bp = .05; }             // blue enamel
    case 21 { m.a = vec3f(.04, .04, .045); m.gl = .2; m.bp = .3; }             // chassis
    case 22 { m.a = vec3f(.35, .35, .33); m.gl = .6; m.mt = .2; m.bp = 0.; }     // headlight glass
    case 23 { m.a = vec3f(.56, .55, .51); m.gl = .3; m.bp = 0.; }             // white paint, aged
    case 24 { let wv = .5 + .5 * sin(op.x * 900.) * sin(op.z * 900.); m.a = vec3f(.36, .33, .25) * (.9 + .1 * wv) * (1. - .25 * ss(.02, .0, abs(fract(op.x / .9) - .5) - .47)); m.bp = 0.; }   // canvas groundsheet, seamed
    case 40 { m.a = vec3f(.42, .05, .03); m.gl = .5; m.bp = .1; }              // lantern: red paint
    case 41 { m.a = vec3f(.04); m.gl = .4; m.bp = 0.;                           // lantern: clear glass globe, faintly lit from inside
      m.e = LANTC * g.lant.w * (.012 + .022 * ss(.06, -.03, op.y) + .1 * exp(-(op.y + .01) * (op.y + .01) / .0009)); } // brightest round the flame
    case 42 { m.a = vec3f(.30, .30, .31); m.gl = .6; m.mt = .8; m.bp = .05; } // lantern: tin and wire
    case 25 { m.a = vec3f(.19, .21, .12) * (1. - .3 * ss(.03, .0, abs(fract(op.z / .16) - .5) - .45)); m.bp = .3; m.n = vec3f(sin(op.z * 40.), 0., cos(op.x * 31.)) * .06; } // sleeping bag: olive drab, quilted
    case 26 { let px = step(.5, fract(op.x / .09)); let pz = step(.5, fract(op.z / .09));                   // sleeping bag lining: red plaid flannel
      m.a = mix(vec3f(.40, .05, .04), vec3f(.10, .03, .03), (px + pz) * .35) + vec3f(.12, .10, .02) * ss(.02, .0, abs(fract(op.x / .09) - .25) - .01); m.bp = .2; }
    case 27 { m.a = mix(vec3f(.70, .68, .62), vec3f(.20, .26, .45), ss(.15, .1, abs(fract(op.x / .05) - .5)) * .7); m.bp = .1; }  // pillow ticking
    case 28 {   // newspaper clipping: grey columns of text under a dark headline
      let r = floor(op.y / .011); let c = floor((op.x + op.z) / .045);
      let txt = step(fract(op.y / .011), .55) * step(.12, hs(c * 7.13 + r * 1.71)) * step(.08, fract((op.x + op.z) / .045));
      let cell = floor(vec2f(op.x + op.z, op.y) / vec2f(.11, .07)); let hasPh = step(.55, hs(cell.x * 3.7 + cell.y * 11.3));
      let ph = hasPh * step(.3, fract((op.x + op.z) / .11)) * step(.85, 1. - fract(op.y / .07)) * 0. + hasPh * step(.25, fract((op.x + op.z) / .11)) * step(.45, fract(op.y / .07)) * step(fract(op.y / .07), .92);
      let ht = ss(.5, .3, length(fract(vec2f(op.x + op.z, op.y) / .004) - .5) / (.25 + .5 * vn2d(vec2f(op.x + op.z, op.y) * 40.)));
      let hl = step(.93, fract(op.y / .07));
      m.a = vec3f(.60, .58, .50) * (1. - .45 * txt * (1. - ph) - .6 * hl - .55 * ph * ht); m.bp = 0.; m.tl = .3; }
    case 33 {   // the newspaper lying folded on the table: masthead, headline, a photo and columns of text, seen from above
      let c0 = cos(.49); let s0 = sin(.49); let q = vec2f(c0 * (op.x - 3.4) - s0 * (op.z + .9), s0 * (op.x - 3.4) + c0 * (op.z + .9)) + vec2f(.02, .15);
      let row = floor(q.x / .009); let col = floor(q.y / .05);
      let txt = step(fract(q.x / .009), .55) * step(.1, hs(col * 7.1 + row * 1.3)) * step(.1, fract(q.y / .05));
      let head = step(-.16, q.x) * step(q.x, -.11) * step(.03, q.y) * step(q.y, .27) * step(.25, fract(q.y / .028));
      let ph = step(-.09, q.x) * step(q.x, .02) * step(.15, q.y) * step(q.y, .28);
      let ht = ss(.5, .3, length(fract(q / .004) - .5) / (.2 + .6 * vn2d(q * 35.)));
      m.a = vec3f(.62, .60, .52) * (1. - .42 * txt * (1. - ph) * step(-.1, q.x) - .75 * head - .6 * ph * ht); m.bp = 0.; }
    case 29 { m.a = vec3f(.35 + .3 * mc) * (1. - .5 * ss(.3, .7, .5 + .5 * sin(op.x * 90. + sin(op.y * 70.) * 2.) * sin(op.y * 80. + op.z * 60.))); m.gl = .5; m.bp = 0.; }        // black-and-white photograph
    case 30 { let pb = ss(.4, .7, vn2d(op.xz * 900. + op.y * 700.)) * ss(.001, .0004, pfw); m.a = vec3f(.035, .03, .028) * (.8 + .4 * pb); m.gl = .3 * (1. - .5 * pb); m.bp = .5; m.n = vec3f(pb - .5) * .15; }   // black leatherette, pebbled                 // black leatherette (radio, tape recorder)
    case 31 { m.a = vec3f(.62, .46, .20); m.gl = .8; m.mt = 1.; m.bp = 0.; }        // brass trim
    case 32 { m.a = vec3f(.72, .64, .45) * (1. - .5 * ss(.004, .0, abs(fract(op.x / .02) - .5) - .45)); m.gl = .5; m.bp = 0.; } // radio dial face
    case 34 { m.a = vec3f(.02); m.gl = .5; m.bp = 0.; }                                // black paint
    case 35 { m.a = vec3f(.07, .2, .12); m.gl = .5; m.bp = 0.; }                      // green enamel (camp stove)
    case 36 { m.a = vec3f(.11, .065, .035); m.gl = .45; m.bp = 0.; }                   // brown tape on the reels
    case 37 { m.a = vec3f(.17, .18, .10) * (.85 + .3 * mc); m.bp = .2;                 // olive tarp
      m.n = vec3f(sin(op.x * 9. + op.z * 4.), 0., cos(op.z * 11. - op.x * 3.)) * .12; }
    case 38 { let wv = sin(op.x * 1300.) * sin((op.y + op.z) * 1300.) * ss(.0008, .0003, pfw); let st = ss(.006, .0, abs(fract((op.x + .26) / .52 * 4.) - .5) - .47); m.a = vec3f(.07, .17, .10) * (.85 + .3 * mc) * (1. + .1 * wv) * (1. - .3 * st) * (.85 + .3 * vn2d(op.xz * 30. + op.y * 20.)); m.bp = 0.; m.tl = .2; m.n = vec3f(0., vn2d(op.xz * 12.) - .5, 0.) * .2; }   // chair canvas: duck weave, stitched hems, sag
    case 39 { m.a = vec3f(.10, .15, .11) * (.85 + .25 * vn2d(op.xz * 300. + op.y * 200.)); m.gl = .12; m.bp = .25; }   // the logbook: green bookcloth
    case 47 {   // rusted iron: scaly orange-brown rust over black, pitted
      let r1 = vn2d(op.xz * 26. + op.y * 19.); let r2 = vn2d(op.zy * 130. + op.x * 90.); let r3 = vn2d(op.xy * 420. + op.z * 310.);
      m.a = mix(vec3f(.11, .075, .055), vec3f(.38, .17, .065), ss(.2, .75, r1 * .7 + r2 * .3)) * (.75 + .45 * r3) * (.85 + .3 * h); m.gl = .12 * (1. - r1); m.mt = .1; m.bp = 1.4; }
    case 58 {   // the old fire's ash: black charcoal in the middle, grey ash in drifts, feathering out into the sand
      let r = length(op.xz - vec2f(14., 42.)) / .4 + (vn2d(op.xz * 9.) - .5) * .6 + (vn2d(op.xz * 40.) - .5) * .25; let cb = vn2d(op.xz * 28.); let ash = ss(.55, .75, vn2d(op.xz * 12. + 4.));
      m.a = mix(mix(vec3f(.035, .03, .028), vec3f(.20, .19, .18), ash * .7) * (.75 + .5 * cb), vec3f(.36, .24, .15) * (.85 + .3 * cb), ss(.55, 1., r)); m.bp = .5; if (r > 1.) { m.tl = -1.; } }   // past its ragged edge: not drawn (fs discards)
    case 48 { let cz = 1. - ss(0., .04, abs(vn2d(op.xz * 90. + op.y * 70.) - .5)); m.a = vec3f(.34, .33, .30) * (1. - .35 * cz * ss(.004, .001, pfw)) * (1. - .3 * ss(.6, .85, vn2d(op.xz * 25. + op.y * 18.))) * (.9 + .1 * h); m.gl = .25; m.bp = 0.; }   // white ironstone: crazed glaze, tea-stained
    case 49 {   // graniteware: blue-grey enamel speckled white, chipped black at the rims and knocked edges
      let sp = step(.72, hs(dot(floor(op * 320.), vec3f(1., 57., 113.)))) * ss(.002, .0008, pfw); let ch = max(ss(.8, .86, vn2d(op.xz * 45. + op.y * 60.)), ss(60., 160., cv) * ss(.35, .55, vn2d(op.xz * 120. + op.y * 90.)));
      m.a = mix(mix(vec3f(.09, .12, .19), vec3f(.62, .64, .66), sp * .75), vec3f(.025), ch) * (.85 + .2 * h); m.gl = .5 * (1. - ch); m.bp = 0.; }
    case 50 { m.a = vec3f(.09, .04, .015); m.gl = .55; m.bp = .03; m.tl = .3; }    // brown bottle glass, sand-scoured
    case 51 { let lm = vn2d(op.xz * 160. + op.y * 90.); m.a = mix(vec3f(.16, .07, .03), vec3f(.30, .16, .07), lm) * (.7 + .5 * h); m.gl = .35; m.bp = .2; m.n = vec3f(lm - .5, 0., vn2d(op.zx * 130.) - .5) * .4; }   // stew gone cold: beans, a skin of fat
    case 52 { m.a = vec3f(.19, .11, .06) * (.8 + .3 * vn2d(vec2f((op.x + op.z) * 3., op.y * 70.))) * (.85 + .2 * h); m.gl = .15; m.bp = .35; }   // stained sign board
    case 53 { m.a = mix(vec3f(.30, .16, .07), vec3f(.58, .44, .27), vn2d(op.xz * 50. + op.y * 30.)); m.bp = .8; }   // a crusted loaf
    case 54 { let mb = vn2d(op.xz * 70.) * .65 + vn2d(op.xz * 160.) * .35; let mk = ss(.55, .7, fract(mb * 3.)); m.a = vec3f(mix(.4, mix(.04, .74, mk), ss(.004, .0012, pfw))); m.gl = .25; m.bp = .05; } // marbled notebook cover
    case 55 { m.a = vec3f(.80, .77, .67) * (1. - .18 * step(.5, fract(op.y * 3000.))); m.bp = 0.; }   // the edges of a page block
    case 56 { m.a = vec3f(.66, .48, .06); m.gl = .5; m.bp = 0.; }    // pencil: yellow paint
    case 57 { m.a = vec3f(.34, .3, .21) * (.7 + .35 * vn2d(op.xy * 90. + op.z * 70.)) * (1. - .3 * ss(.6, .8, vn2d(op.xy * 25.))); m.gl = .04; m.bp = .05; }   // faded cream routed paint
    case 67 { m.a = vec3f(.08, .11, .10) * (.7 + .6 * vn2d(op.xz * 60. + op.y * 37.)); m.bp = 1.8; m.tl = .25; }
    case 68 { m.a = vec3f(.07, .10, .065) * (.7 + .6 * vn2d(op.xz * 70. + op.y * 41.)); m.bp = 1.8; m.tl = .25; }
    case 44 { m.a = vec3f(.07, .075, .09) * (.85 + .3 * mc); m.bp = .4; }   // dark wool shirt cuff
    case 43 { m.a = vec3f(.30, .19, .10) * (.8 + .3 * mc); m.gl = .2; m.bp = .3; }   // leather work glove
    case 60 { m.a = vec3f(.11, .15, .07) * (.75 + .4 * vn2d(op.xz * 30. + op.y * 22.)) * (.8 + .3 * h); m.gl = .15; m.bp = .05; }    // cactus
    case 61 { let fb = fract(sin(dot(floor(op.xz * vec2f(55., 47.)), vec2f(12.9, 78.2))) * 43758.5);
      m.a = vec3f(.20, .16, .13) * (.5 + .5 * h) * (.65 + .55 * fb); m.bp = 1.2; m.n = vec3f(sin(op.x * 120. + op.y * 6.), 0., cos(op.z * 110. - op.y * 5.)) * .3; }       // juniper bark
    case 62 { m.a = vec3f(.44, .42, .38) * (.7 + .4 * h); m.bp = 1.2; }       // dead silver wood
    case 63 {   // prickly pear pad: olive green under a waxy bloom, purple where drought has stressed it, corky scars low
      let n1 = vn2d(op.xy * 14. + op.z * 9.); let n2 = vn2d(op.zy * 40. + op.x * 31.); let cork = ss(.62, .7, vn2d(op.xz * 22. + op.y * 5.)) * ss(.25, .05, op.y);
      m.a = mix(vec3f(.12, .15, .065), vec3f(.15, .10, .11), ss(.5, .75, n1) * .6) * (.85 + .3 * n2) * (.85 + .3 * mc);
      m.a = mix(m.a, vec3f(.23, .17, .10), cork); m.gl = .12; m.bp = .05; m.n = vec3f(n2 - .5, 0., n1 - .5) * .12; } // prickly pear pad
    case 64 { m.a = vec3f(.62, .58, .46); m.gl = .3; m.bp = 0.; m.tl = .4; }    // spines: pale straw, translucent
    case 69 { m.a = vec3f(.24, .15, .07); m.bp = .3; }
    case 72 {   // trailer windows: dark glass with the curtains drawn behind, pale folds catching a little light
      let fo = .5 + .5 * sin((op.z * 40. + op.x * 40.) + vn2d(vec2f(op.z * 6., op.y * 3.)) * 3.);
      m.a = vec3f(.07, .065, .055) * (.6 + .6 * fo); m.gl = .85; m.mt = .1; m.bp = 0.; }
    case 73 {   // licence plate: black, a yellow rim, embossed yellow characters (a coarse glyph pattern), dented
      // in the plate's own frame (front plate y .2 .. .34, rear plate y .56 .. .72): u across, v up
      let rear = op.y > .45; let v = (op.y - select(.2, .56, rear)) / select(.14, .16, rear); let u = (op.x + .155) / .31;
      let rim = step(u, .04) + step(.96, u) + step(v, .08) + step(.92, v);
      let cf = fract((op.x + .13) / .037); let cx = floor((op.x + .13) / .037); let cr = (v - .26) / .48;
      let ch = step(.18, cf) * step(cf, .82) * step(0., cr) * step(cr, 1.) * step(abs(op.x), .125);
      let gl = step(.35, hs(cx * 3.1 + floor(cr * 5.) * 7.3 + floor(cf * 3.) * 1.7 + select(0., 5.7, rear)));
      m.a = mix(vec3f(.025, .024, .022), vec3f(.55, .42, .08), min(1., rim + ch * gl)); m.gl = .35; m.bp = 0.; }
    case 71 { let st = vn2d(vec2f((op.x + op.z) * 60., op.y * 6.)); m.a = vec3f(.12, .095, .07) * (.7 + .5 * st); m.gl = .01; m.bp = .1; }   // weathered stick wood                         // glochid tufts
    case 65 { m.a = vec3f(.15, .03, .09); m.gl = .1; m.bp = .2; }             // prickly pear fruit
    case 66 { let pl = fract(sin(dot(floor(vec2f(op.x + op.z, op.y * .6) * 18.), vec2f(12.9, 78.2))) * 43758.5);
      m.a = vec3f(.21, .16, .13) * (.55 + .5 * h) * (.7 + .45 * pl); m.bp = 1.6; }       // pinyon bark
    default {}
  }
  weather(&m, id, op, on, pfw, cv);
  return m;
}
// things left out in the desert: red dust settled on what faces up and splashed up from the ground, paint chipped
// (most on edges and corners, where the surface turns sharply: cv) down to grey primer and rust, chrome pitted and
// dulled, glass filmed with dust. op is in metres with the ground at y = 0 for the camp's things.
fn weather(m: ptr<function, PM>, id: i32, op: vec3f, on: vec3f, pfw: f32, cv: f32) {
  let paint = id == 1 || id == 2 || id == 11 || id == 19 || id == 20 || id == 23 || id == 35 || id == 21 || id == 34 || id == 12;
  let made = paint || id == 50 || id == 72 || id == 73 || id == 3 || id == 4 || id == 5 || id == 6 || id == 22 || id == 42 || id == 30 || id == 31 || id == 17 || id == 37 || id == 9 || id == 10;
  if (!made) { return; }
  let n1 = vn2d(op.xz * 2.3 + op.y * 1.7); let rq = vec2f(op.x * .8 - op.y * .6 + op.z * .3, op.x * .6 + op.y * .8 - op.z * .5);
  let n2 = vn2d(rq * 5.) * .6 + vn2d(rq.yx * 13. + 7.) * .4; let n3 = vn2d(vec2f(rq.x * 37. + op.z * 23., rq.y * 41. - op.z * 19.));
  let fd = ss(.006, .0015, pfw);
  // chips: islands in a noise, opened up along sharp edges; a ring of primer round each, rust in the middle
  let edge = ss(6., 45., cv);
  let cn = n2 * .7 + mix(.5, n3, fd) * .3 + edge * .3 + ss(.9, .3, op.y) * .06;
  let chip = select(0., ss(.71, .73, cn), paint); let core = select(0., ss(.745, .77, cn), paint);
  (*m).a = mix((*m).a, vec3f(.19, .18, .17), chip);
  (*m).a = mix((*m).a, vec3f(.16, .07, .03) * (.7 + .5 * n3), core);
  (*m).gl *= 1. - .8 * chip; (*m).mt *= 1. - chip;
  // rust bleeding down from the chips below them: a streak where the noise of the column above was chipped
  let col = vn2d(vec2f((op.x + op.z) * 40., op.y * 1.5 + 3.));
  let streak = select(0., ss(.8, .95, col) * (1. - abs(on.y)) * ss(.6, 1.2, op.y) * .25, paint);
  (*m).a = mix((*m).a, vec3f(.20, .085, .03), streak);
  // chrome: pitting and dull bloom
  if (id == 3 || id == 31) { let pit = ss(.66, .72, mix(.5, vn2d(op.xy * 300. + op.z * 210.), ss(.002, .0006, pfw))); (*m).a *= 1. - .5 * pit; (*m).gl *= 1. - .6 * max(pit, ss(.4, .8, n1) * .6); }
  // dust: on what faces up, thickest in hollows of the noise; red dust splashed up from the ground on everything low
  let fdn = vn2d(op.xz * 23. + op.y * 17.) * .6 + vn2d(op.zx * 71. - op.y * 43.) * .4;
  let up = ss(.4, .95, on.y) * (.15 + .5 * ss(.45, .75, fdn)) * .45;
  let low = ss(.32, .0, op.y) * (.3 + .7 * ss(.4, .7, fdn)) * (1. - .4 * ss(.6, .9, on.y)) * select(.5, 1., op.y > -1.);
  var dk = max(up * .75, low * .65) * select(1., .25, id == 30 || id == 31 || id == 42);
  if (id == 6 || id == 22 || id == 50) { dk = max(dk, .25 + .35 * ss(.3, .8, n1)) * .55; }   // glass: a film all over
  if (id == 4) { dk = max(dk, .3); }                                             // tyres: grey-brown with dust
  let dust = vec3f(.47, .32, .21) * (.85 + .3 * n2);
  (*m).a = mix((*m).a, dust, dk); (*m).gl *= 1. - .85 * dk; (*m).mt *= 1. - dk;
}
@fragment fn fs(i: VO, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let mat = i32(i.m.x + .5); let fl_ = select(-1., 1., ff);
  let on = normalize(i.on) * fl_; let n0 = normalize(i.n) * fl_;
  let dist = length(i.wp - g.cam.xyz);
  let rock = mat <= 1;
  let pfw = length(fwidth(i.op)); // world size of this pixel on the surface, for detail that fades instead of shimmering
  let cvt = length(fwidth(on)) / max(pfw, 1e-5); // how sharply the surface turns (1 / m): edges wear first
  let ts = select(1., i.m.z, mat >= 2);
  let A = tri(i.op, on, .1 * ts); let B = tri(i.op, on, .43 * ts); let C = tri(i.op, on, 1.9 * ts); let F = tri(i.op, on, 6.7 * ts); let fk = ss(10., 1.5, dist) * f32(rock);
  let hgt = A.h * .5 + B.h * .35 + C.h * .15;
  var bump = 1.15; var gloss = .04; var alb = vec3f(0.); var emi = vec3f(0.); var metal = 0.; var sgro = 0.; var rip = 0.; var tilt = vec3f(0.); var tl = 0.; var aoK = ss(.12, .6, hgt);
  let big = textureSample(tD, sR, i.op.xz * .013 + i.op.y * .021).a;
  let big2 = textureSample(tD, sR, i.op.zx * .031 + i.op.y * .043 + .37).a;
  let sk = textureSample(tD, sR, vec2f((i.op.x + i.op.z) * .33, i.op.y * .035));
  let sk2 = textureSample(tD, sR, vec2f((i.op.x - i.op.z) * 1.1, i.op.y * .11));
  let gm = textureSample(tM, sC, i.wp.xz / 384. + .5);
  if (rock) {
    // sandstone: red, orange and pale beds, dark desert varnish streaks down the steep faces, pale sand on the flats
    let st = i.op.y * .32 + A.h * .35 + (big - .5) * 1.1 + (big2 - .5) * .6 + (i.op.x * .006 - i.op.z * .004) * select(0., 1., mat == 0);
    let bed = hs(floor(st)); let sf = fract(st);
    alb = mix(vec3f(.42, .16, .08), vec3f(.56, .29, .14), bed);
    let ruinS = i.m.z > 1.01 && mat == 1; // a building stone of the ruins: pale beds rarer, each stone its own tint
    alb = mix(alb, vec3f(.60, .47, .33), ss(.80, .86, bed) * ss(.25, .55, big2) * select(1., .3, ruinS));
    alb *= select(1., .8 + .35 * hs(i.m.y * 91.), ruinS);
    if (ruinS) { bump *= .8; }   // building stone: the cliffs' rock, its relief a little softened by handling
    alb = mix(alb, vec3f(.26, .12, .07), ss(.14, .08, bed));
    alb *= mix(vec3f(1.), vec3f(1.1, .95, .85), ss(.4, .7, A.c));
    let vert = 1. - abs(on.y);
    let varn = ss(.42, .66, sk.a * .7 + sk2.b * .5) * vert * ss(.3, .6, big2 + .2);
    alb *= 1. - .5 * varn * ss(.35, .65, big);
    alb *= (.65 + .6 * hgt) * mix(1., .75 + .5 * F.h, fk);
    alb *= 1. - .35 * ss(.12, .0, sf) * vert;
    sgro = -ss(.14, .0, sf) * vert * 1.2;
    if (mat == 0) {
      let flt = ss(.72, .93, n0.y);
      let sand = mix(vec3f(.50, .31, .19), vec3f(.40, .24, .14), sat(gm.a * .6 + (B.c - .5) * .5 + (big - .5) * .8)) * (.9 + .12 * C.h + .15 * (big2 - .5));
      let sm = flt * ss(.2, .5, gm.a * .6 + A.c * .6);
      alb = mix(alb, sand, sm);
      rip = sm * cos((i.wp.x * .8 + i.wp.z * .35 + B.h * 1.5) * 22. + A.c * 9.) * .12 * ss(16., 3., dist) * ss(.35, .6, B.c);
      bump = mix(bump, .28 + .2 * big, sm);
      // old tire tracks: two faint ruts, years old, half drifted over
      let rut = ss(.24, .08, abs(mapTrack(i.wp.xz) - .72)) * ss(.3, .62, vn2d(i.wp.xz * .13)) * sm;
      alb *= 1. - .17 * rut; rip *= 1. - rut; bump *= 1. - .6 * rut;
    }
  } else {
    let pm = prop(i32(round(i.ao * 127.)), i.op, on, B.c, B.h, pfw, i.m.y, cvt);
    if (pm.tl < -.5) { discard; }
    alb = pm.a; gloss = pm.gl; metal = pm.mt; emi = pm.e; bump = pm.bp; aoK = 1.; tilt = pm.n; tl = pm.tl;
  }
  let N = normalize(qrot(i.q, normalize(on + (A.n * .85 + B.n * .65 + C.n * .45 * ss(60., 12., dist) + F.n * .5 * fk) * bump + vec3f(.8, sgro, .35) * vec3f(rip, 1., rip) + tilt)));
  let V = normalize(g.cam.xyz - i.wp);
  let v1 = vol(i.wp + n0 * 1.5); let v2 = vol(i.wp + n0 * 4.5);
  let ao = (sat((v1.r - .5) * 8.) * .55 + sat((v2.r - .5) * 2.7) * .45) * aoK * i.va;
  // canvas: moonlight comes through it from outside, so its shadow is looked up on the moon side of the cloth
  let E = g.mc.rgb * select(shadow9(i.wp + n0 * .35), shadowSoft(i.wp + MOON * .4), tl > .4);
  let ndl = sat(dot(N, MOON));
  let pv = plV(i.wp + n0 * .05); let cao = campAO(i.wp);
  var c = alb * (1. - metal) * (E * (ndl + tl * sat(-dot(N, MOON))) + amb(N, v1.g) * ao * cao + plD(i.wp + n0 * .03, N, pv) * mix(1., cao, .5) * mix(1., i.va, .6)) + emi;
  let pw = mix(8., 300., gloss);
  let F0 = mix(vec3f(.04), alb, metal);
  let Fr = F0 + (1. - F0) * pow(1. - sat(dot(N, V)), 5.);
  let H = normalize(V + MOON);
  c += Fr * gloss * ((pw + 2.) / 8.) * (E * pow(sat(dot(N, H)), pw) * ndl + plS(i.wp, N, V, pw, pv));
  let R = reflect(-V, N);
  // polished metal close to the fire shows its reflection: the fire is a big bright source, so a broad warm lobe
  if (metal > .5) { c += alb * metal * plD(i.wp - vec3f(R.x, 0., R.z) * .6 + vec3f(0., -.5, 0.), vec3f(0., 1., 0.), pv) * .5 * ss(.05, -.35, R.y) * vec3f(.62, .46, .32); }
  if (metal > .5) { let lf = g.fire.xyz + vec3f(0., .2, 0.) - i.wp; let dd = length(lf); c += Fr * FIREC * g.fire.w * pow(sat(dot(R, lf / dd)), 30.) * 1.2 / (1. + dd * dd * .04) * pv.x; }
  c += Fr * gloss * select(skyBase(R), vec3f(.42, .30, .22) * (g.mc.rgb * .32 + SKYA * g.mc.w * .6 + SKY0) * (1. - .4 * R.y), R.y < 0.) * (.3 + .7 * ao) * 2.;
  // the lantern lit by its own flame: the top of the fount, the burner, the inside of the guard and air tubes, the
  // underside of the top chamber and the bail all catch the light from the globe a hand's width away (the reflector's
  // back stays dark: it faces away from the flame)
  if (mat == 2) { let pid = i32(round(i.ao * 127.)); let tf = g.lant.xyz - i.wp; let df = length(tf);
    let refl = pid == 42; // the tin (guard wires, reflector: thin and back to back) stays unlit: lit, it strobes in stripes // the reflector (two faces back to back): left dark
    if (df < .26 && pid >= 40 && pid <= 42 && !refl) { c += alb * LANTC * g.lant.w * .012 * sat(dot(N, tf / df) * .75 + .25) / (df * df + .006) * ss(.26, .18, df); } }
  // the lantern's flame, seen through its glass
  if (mat == 2 && i32(round(i.ao * 127.)) == 41) {
    // the flame seen through the glass: a small teardrop above the wick, yellow core, orange edge, and a soft glow round it
    let fd = normalize(g.lant.xyz - g.cam.xyz); let dl = distance(g.lant.xyz, g.cam.xyz); let dv = (-V - fd) * dl;
    let fx = dot(dv, g.right.xyz); let fy = dot(dv, g.up.xyz) + .004;
    let wd = .0055 * (1. - .7 * ss(-.004, .022, fy)) + .0008;
    let fl = exp(-(fx * fx) / (wd * wd) - pow(max(abs(fy - .008) - .012, 0.), 2.) / .00002);
    c += mix(vec3f(1., .45, .12), vec3f(1., .85, .55), ss(.2, .8, fl)) * g.lant.w * .43 * fl + LANTC * g.lant.w * .027 * exp(-(fx * fx + fy * fy) / .0009);
  }
  return fin(fog(c, i.wp));
}
`;

// ---------------------------------------------------------------- leaves (sagebrush, grass, yucca, juniper and pinyon foliage)
const W_LEAF = S_B + /*wgsl*/`
override ROWS: f32 = 7.;
override FAR: f32 = 150.;
struct LI { @location(0) a: vec4f, @location(1) b: vec4f, @location(2) c: vec4f };
struct LO { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) uv: vec2f,
  @location(3) @interpolate(flat) col: vec3f, @location(4) @interpolate(flat) pr: vec4f, @location(5) @interpolate(flat) sd: vec2f };
// the breeze bends plants away from the west, more in gusts and more the higher up the plant
fn sway(p: vec2f, h: f32, t: f32) -> vec2f {
  let ph = dot(p, vec2f(.31, .17)); let gs = gust(t, p);
  let a = .012 * pow(max(h, 0.), 1.1) * gs;
  return a * (vec2f(.3, .8) + vec2f(sin(t * 1.7 + ph + h * .9), cos(t * 1.3 + ph * 1.3 + h * .7)) * .6);
}
fn shape2(v: f32) -> f32 { return sin(3.14159 * sat(v)); }
@vertex fn vs(@builtin(vertex_index) vi: u32, i: LI) -> LO {
  var o: LO;
  let u = f32(vi & 1u) * 2. - 1.; let v = sin(f32(vi >> 1u) / (ROWS - 1.) * 1.5708);
  let ty = i32(i.c.x * 255. + .5); let s1 = i.c.y; let s2 = i.c.z;
  let t = g.cam.w;
  let len = i.a.w; let hA = i.b.w;
  let cy = cos(i.b.x); let sy = sin(i.b.x); let ct = cos(i.b.y); let st = sin(i.b.y);
  let d = vec3f(st * cy, ct, st * sy); let pe = vec3f(ct * cy, -st, ct * sy); let sd = vec3f(-sy, 0., cy);
  // per type: colour, y translucency, width profile, wave, flutter
  var col = vec3f(0.); var pr = vec4f(0.); var shp = vec2f(.75, .7); var wav = .2; var fls = .5;
  switch ty {
    case 0 { col = mix(vec3f(.085, .115, .105), vec3f(.11, .13, .11), s1); pr = vec4f(0., .3, 0., 0.); shp = vec2f(.2, .6); wav = .35; }   // juniper sprays
    case 1 { col = vec3f(.19, .15, .10) * (.8 + .4 * s1); pr = vec4f(0., .1, 0., 0.); shp = vec2f(.05, .1); wav = .02; fls = .1; }       // dry yucca stalk
    case 2 { col = mix(vec3f(.33, .36, .31), vec3f(.42, .44, .38), s1); pr = vec4f(0., .4, 0., 0.); shp = vec2f(.4, .5); }               // sagebrush
    case 3 { col = mix(vec3f(.13, .17, .08), vec3f(.19, .21, .10), s1); col = mix(col, vec3f(.30, .26, .16), step(.82, s2)); pr = vec4f(0., .5, 0., 0.); shp = vec2f(.25, .6); wav = .03; fls = .2; }   // yucca
    case 4 { col = mix(vec3f(.075, .11, .07), vec3f(.095, .12, .075), s1); pr = vec4f(0., .3, 0., 0.); shp = vec2f(.15, .8); wav = .05; }   // pinyon needles
    case 5 { col = mix(vec3f(.36, .31, .19), vec3f(.44, .38, .24), s1); pr = vec4f(0., .6, 0., 0.); shp = vec2f(.3, .5); wav = .4; fls = 1.; }   // dry grass
    default { col = mix(vec3f(.22, .22, .12), vec3f(.30, .27, .14), s1); pr = vec4f(0., .5, 0., 0.); shp = vec2f(.4, .5); wav = .3; }   // rabbitbrush
  }
  let gs = gust(t, i.a.xz);
  let k = (i.c.w - .3) * 2.0 + sin(t * (2.5 + s1 * 2.) + s2 * 40. + hA * .25) * .05 * fls * gs;
  let wph = v * (3. + 5. * s2) + s1 * 30. + t * 2.1;
  let wv = sin(wph) * .12 * wav * gs;
  let kq = k * 1.7; let ka = select(kq, .06, abs(kq) < .06);
  let sK = sin(ka * v); let cK = cos(ka * v);
  let c = i.a.xyz + len * (d * (sK / ka) + pe * ((1. - cK) / ka + wv * v));
  let sl = sK + wv + cos(wph) * .10 * wav * v * (3. + 5. * s2);
  let N = normalize(pe * cK - d * sl); let T0 = normalize(d * cK + pe * sl);
  let tw = (s1 - .5) * 2.4 * v;
  let S = sd * cos(tw) + N * sin(tw); let N2 = N * cos(tw) - sd * sin(tw);
  let shape = pow(max(sin(3.14159 * pow(v, shp.x)), 0.), shp.y);
  let shp_ = g.res.x == 0.;
  let cd = distance(i.a.xyz, g.cam.xyz); let far = FAR * g.mis.z;
  let farK = select((1. - ss(far * .8, far, cd)) * ss(.3, 1.2, distance(c, g.cam.xyz)), 1., shp_);
  var p = c + S * (u * farK * select(i.b.z * .5 * shape, select(max(i.b.z * .5, .09) * shape, 0., ty == 1), shp_));
  let sw = sway(i.a.xz, hA + (p.y - i.a.y), t);
  p.x += sw.x; p.z += sw.y;
  o.cp = g.vp * vec4f(p, 1.); o.wp = p; o.n = normalize(N2 + S * u * .55); o.uv = vec2f(u, v);
  o.col = col; o.pr = pr; o.sd = vec2f(s1, s2);
  return o;
}
@fragment fn fs(i: LO, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let dist = length(i.wp - g.cam.xyz);
  var n = normalize(i.n); if (!ff) { n = -n; }
  let V = normalize(g.cam.xyz - i.wp); let L = MOON;
  let lt = textureSample(tD, sR, vec2f(i.uv.x * .13 + i.sd.x * 3.7, i.uv.y * .8 + i.sd.y * 5.3));
  let vv = vol(i.wp + vec3f(0., .8, 0.));
  let E = g.mc.rgb * shadow1(i.wp + L * .3);
  let ndl = dot(n, L);
  let alb = i.col * (.72 + .28 * ss(0., .25, abs(i.uv.x))) * mix(.55, 1.1, i.uv.y) * (.58 + .42 * ss(0., .13, abs(i.uv.x))) * (.5 + 1.0 * lt.b) * (.65 + .7 * lt.a);
  let tr = (max(-ndl, 0.) * .85 + .15) * i.pr.y;
  let aov = sat((vv.r - .5) * 6.) * mix(.4, 1., i.uv.y);
  let am = (amb(n, vv.g) + amb(-n, vv.g) * i.pr.y * .5) * (.3 + .7 * aov);
  let pv = vec2f(1., lantF(i.wp + n * .05)); let pd = plD(i.wp, n, pv) + plD(i.wp, -n, pv) * i.pr.y * .6;
  var c = alb * (E * (max(ndl, 0.) + tr) + am + pd);
  c += E * pow(sat(dot(n, normalize(V + L))), 30.) * .05;
  return fin(fog(c, i.wp));
}
`;

// ---------------------------------------------------------------- the night sky, drawn behind everything
// gradient, three layers of stars, the Milky Way, thin high cloud, the full moon going into eclipse, a rare shooting star
const W_SKY = S_B + /*wgsl*/`
struct VO { @builtin(position) cp: vec4f, @location(0) wp: vec3f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VO {
  var o: VO;
  let p = vec2f(f32(i & 1u), f32(i >> 1u)) * 2. - 1.;
  o.wp = g.cam.xyz + g.fwd.xyz + g.right.xyz * (p.x * g.right.w) + g.up.xyz * (p.y * g.up.w);
  o.cp = vec4f(p, 1e-7, 1.);
  return o;
}
fn hh3(p: vec3f) -> vec3f { var q = fract(p * vec3f(.1031, .1030, .0973)); q += dot(q, q.yxz + 33.33); return fract((q.xxy + q.yxx) * q.zyx); }
fn vn3(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3. - 2. * f);
  return mix(mix(mix(hh3(i).x, hh3(i + vec3f(1., 0., 0.)).x, u.x), mix(hh3(i + vec3f(0., 1., 0.)).x, hh3(i + vec3f(1., 1., 0.)).x, u.x), u.y),
             mix(mix(hh3(i + vec3f(0., 0., 1.)).x, hh3(i + vec3f(1., 0., 1.)).x, u.x), mix(hh3(i + vec3f(0., 1., 1.)).x, hh3(i + vec3f(1., 1., 1.)).x, u.x), u.y), u.z);
}
fn fbm3(p: vec3f, n: i32) -> f32 { var a = .5; var s = 0.; var q = p; for (var i = 0; i < n; i++) { s += a * vn3(q); q = q * 2.03 + 17.1; a *= .5; } return s / (1. - 2. * a); }
// one star per occupied cell of a grid of the given scale; the 8 cells around the ray are checked, so none is cut off
fn stars(rd: vec3f, sc: f32, dens: f32, bright: f32, px: f32) -> vec3f {
  let p = rd * sc; let b = floor(p - .5); var acc = vec3f(0.);
  for (var k = 0; k < 8; k++) {
    let c = b + vec3f(f32(k & 1), f32((k >> 1) & 1), f32(k >> 2));
    let h = hh3(c);
    if (h.x < dens) {
      let sp = normalize(c + .25 + .5 * hh3(c + 17.));
      let a = length(cross(rd, sp)) / px;
      let m = (pow(h.y, 30.) * 20. + pow(h.y, 8.) * .6 + .015) * bright;
      let tint = mix(vec3f(1., .78, .58), vec3f(.78, .87, 1.15), h.z);
      acc += tint * m * exp(-a * a * 3.) * step(0., dot(rd, sp));
    }
  }
  return acc;
}
@fragment fn fs(i: VO) -> @location(0) vec4f {
  let rd = normalize(i.wp - g.cam.xyz);
  let t = g.cam.w;
  let px = 2. * g.up.w / g.res.y;   // the angle one pixel covers
  var c = skyBase(rd) + g.sun.w * (SKYA * g.mc.w * 1.4 + SKY0 * 1.5) * (.75 + .5 * pow(sat(dot(rd, MOON)), 3.)) * (1. - .55 * ss(0., .6, rd.y)); // the moonlit air (fog())
  let up = sat(rd.y);
  let mu = dot(rd, MOON);
  let ml = g.mc.w;
  let wash = 1. - .8 * pow(sat(mu), 4.) * ml;     // the moon washes out the faint stars near it (not once it is eclipsed)
  let ext = ss(-.01, .2, rd.y);                    // stars fade into the haze at the horizon
  // Milky Way: a soft band with clumps and dark dust lanes, and more faint stars inside it
  let bw = dot(rd, MWN);
  let band = exp(-bw * bw / .022) * .8 + exp(-bw * bw / .08) * .2;
  let n1 = fbm3(rd * 7., 5); let n2 = fbm3(rd * 22. + 3., 3);
  let dust = ss(.42, .62, fbm3(rd * 9. + 7., 5)) * exp(-bw * bw / .008);
  let mw = band * (.3 + 1.0 * ss(.3, .8, n1)) * (.6 + .6 * n2) * (1. - .7 * dust);
  c += vec3f(.036, .037, .043) * mw * wash * ext * (1. - .92 * ml);
  var st = stars(rd, 130., .012, .2, px) + stars(rd, 290., .03 + .35 * band * (1. - dust), .045, px) * wash * (1. - .85 * ml) + stars(rd, 520., .2 * band * (1. - dust), .01, px) * wash * (1. - .9 * ml);
  // near the horizon the air makes them twinkle
  st *= ext * (1. + .6 * (1. - up) * sin(t * 9. + dot(rd, vec3f(3000., 2100., 2700.))));
  // thin high cloud drifting across the moon: it hides the stars behind it and glows where the moon is near
  let cu = rd.xz / (rd.y + .1);
  let cn = fbm3(vec3f(cu * vec2f(.9, 1.6) + vec2f(t * .006, t * .0025), 1.), 5);
  let cd = ss(.52, .8, cn) * ss(.1, .3, rd.y) * .8; // only well above the horizon: low down it would smear into streaks
  c += st * (1. - cd);
  c = mix(c, (vec3f(.012, .013, .018) + vec3f(.10, .085, .065) * (pow(sat(mu), 10.) * .5 + pow(sat(mu), 120.) * 3.)) * (.08 + .92 * ml), cd * .45);
  // the full moon (drawn about twice its real size). The earth's shadow (g.ec) crosses it: the soft penumbra dims it, the
  // umbra leaves only a dull copper red, brighter toward the umbra's edge. eclipseLight() in main.js averages the same thing.
  let mr = normalize(cross(MOON, vec3f(0., 1., 0.))); let mu2 = cross(mr, MOON);
  let MR = .0078;
  let q = vec2f(dot(rd, mr), dot(rd, mu2)) / MR; let r = length(q);
  if (mu > 0. && r < 1.5) {
    let nz = sqrt(max(1. - r * r, 0.));
    let mar = fbm3(vec3f(q * 1.8, 3.), 5);
    let alb = mix(.6, 1., ss(.44, .58, mar)) * (.75 + .25 * nz);
    let disc = 1. - ss(1. - px / MR, 1. + px / MR, r);
    let dd = length(q - g.ec.xy);
    let pen = ss(g.ec.z - .12, g.ec.w, dd);
    let red = vec3f(1., .34, .12) * mix(.04, .22, pow(sat(dd / g.ec.z), 3.));
    let mc = 2.2 * alb * (vec3f(1., .80, .58) * pen + red * (1. - pen)) * (1. - .5 * cd);
    c = mix(c, mc, disc);
  }
  // a shooting star now and then: a short streak that flares and fades
  let P = 23.; let k = floor(t / P); let ph = fract(t / P) * P;
  let hk = hh3(vec3f(k, 7.1, 3.3));
  if (ph < .9 && hk.x < .55) {
    let az = hk.y * TAU; let el = .35 + .6 * hk.z;
    let a = vec3f(cos(el) * cos(az), sin(el), cos(el) * sin(az));
    let td = normalize(cross(a, hh3(vec3f(k, 2., 9.)) - .5));
    let s = ph / .9;
    let hd = normalize(a + td * .22 * s); let tl = normalize(a + td * .22 * max(s - .35, 0.));
    let ba = hd - tl; let pa = rd - tl; let hc = sat(dot(pa, ba) / max(dot(ba, ba), 1e-8)); let dd = length(pa - ba * hc) / px;
    c += vec3f(.9, .95, 1.) * exp(-dd * dd * .8) * hc * 1.5 * sin(3.14159 * s) * ext;
  }
  c += inScatter(rd, 400.);
  return fin(c);
}
`;

// ---------------------------------------------------------------- the real bright stars and the satellite (sky.js)
// Each is a small glowing point, drawn over the sky and hidden behind the land. They fade and twinkle low down, the
// moon's glow drowns the faint ones near it (not once it is eclipsed).
const W_STARS = S_B + /*wgsl*/`
struct SO { @builtin(position) cp: vec4f, @location(0) q: vec2f, @location(1) @interpolate(flat) c: vec3f };
@vertex fn vs(@builtin(vertex_index) vi: u32, @location(0) a: vec4f, @location(1) b: vec4f) -> SO {
  var o: SO; let q = vec2f(f32(vi & 1u), f32(vi >> 1u)) * 2. - 1.;
  let d = a.xyz; let t = g.cam.w; let up = sat(d.y); let px = 2. * g.up.w / g.res.y;
  let ext = ss(-.01, .15, d.y) * (1. - .6 * pow(1. - up, 6.));
  let tw = 1. + .55 * pow(1. - up, 2.) * sin(t * (7. + 5. * fract(b.w * 3.1)) + b.w * 40.) * sin(t * 3.1 + b.w * 17.);
  let wash = 1. - .85 * pow(sat(dot(d, MOON)), 8.) * g.mc.w;
  let I = max(a.w - .35 * g.mc.w, 0.) * ext * tw * wash;
  let r = select(normalize(cross(d, vec3f(0., 1., 0.))), vec3f(1., 0., 0.), abs(d.y) > .999); let u = cross(r, d);
  let sz = px * (1.1 + .25 * sqrt(min(I, 40.)));
  let cp = g.vp * vec4f(d + (r * q.x + u * q.y) * sz * 1.8, 0.);
  o.cp = vec4f(cp.xy, cp.w * 2e-7, cp.w);
  o.q = q * 1.8; o.c = b.rgb * I / (1.1 + .25 * sqrt(min(I, 40.))) / (1.1 + .25 * sqrt(min(I, 40.)));
  return o;
}
@fragment fn fs(i: SO) -> @location(0) vec4f { return vec4f(i.c * exp(-dot(i.q, i.q) * 1.6), 0.); }
`;

// ---------------------------------------------------------------- the campfire: flame cards turned to the camera, and rising embers (additive)
const W_FIRE = S_B + /*wgsl*/`
struct FO { @builtin(position) cp: vec4f, @location(0) uv: vec2f, @location(1) @interpolate(flat) pr: vec4f };
@vertex fn vs(@builtin(vertex_index) vi: u32, @location(0) a: vec4f, @location(1) b: vec4f) -> FO {
  var o: FO; let q = vec2f(f32(vi & 1u), f32(vi >> 1u)) * 2. - 1.; let t = g.cam.w; let s = b.x;
  if (b.y < .5) {
    let tc = g.cam.xyz - a.xyz; let rt = normalize(vec3f(tc.z, 0., -tc.x));
    let h = b.z * (.75 + .2 * sin(t * (5. + s * 4.) + s * 30.) + .1 * sin(t * 13. + s * 9.)) * (.8 + .2 * gust(t, a.xz));
    let w = a.xyz + rt * q.x * a.w + vec3f(0., (q.y * .5 + .5) * h, 0.);
    o.cp = g.vp * vec4f(w, 1.); o.uv = vec2f(q.x, q.y * .5 + .5); o.pr = vec4f(s, 0., h, 0.);
  } else {
    let life = fract(t * (.25 + .2 * s) + s * 7.);
    let p = a.xyz + vec3f(sin(life * 6. + s * 40.) * .25 + life * .4, life * (1.6 + s * 1.5), cos(life * 5. + s * 20.) * .25 + life * .7);
    let d = distance(p, g.cam.xyz); let sz = .012 * (1. - life);
    let w = p + (g.right.xyz * q.x + g.up.xyz * q.y) * max(sz, d * .0009);
    o.cp = g.vp * vec4f(w, 1.); o.uv = q; o.pr = vec4f(s, 1., (1. - life) * (1. - life) * min(1., sz / (d * .0009)), 0.);
  }
  return o;
}
fn vn2(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3. - 2. * f); let n = i.x + i.y * 57.;
  return mix(mix(hs(n), hs(n + 1.), u.x), mix(hs(n + 57.), hs(n + 58.), u.x), u.y);
}
@fragment fn fs(i: FO) -> @location(0) vec4f {
  let t = g.cam.w; let s = i.pr.x;
  if (i.pr.y > .5) { let r = length(i.uv); return vec4f(vec3f(1., .45, .12) * 8. * i.pr.z * exp(-r * r * 4.) * (1. - ss(.7, 1., r)), 0.); }
  let y = i.uv.y;
  let n = vn2(vec2f(i.uv.x * 2.5 + s * 17., y * 3. - t * 3.2)) * .65 + vn2(vec2f(i.uv.x * 6. + s * 5., y * 7. - t * 6.)) * .35;
  let x = i.uv.x + (n - .5) * .9 * y;
  let wd = max(pow(sat(1. - y), .7) * sat(y * 5. + .25) * .9, .001);
  let m = ss(wd, wd * .3, abs(x)) * ss(1., .45 - .3 * n, y + n * .25);
  let heat = m * (1. - y * .6);
  var col = mix(vec3f(1., .16, .02), vec3f(1., .5, .12), ss(.15, .55, heat));
  col = mix(col, vec3f(1., .85, .55), ss(.6, .95, heat));
  return vec4f(col * heat * 3., 0.);
}
`;

// ---------------------------------------------------------------- the eye adjusting to the dark
// One pixel: the average brightness the eye is used to. Each frame it measures the scene (the smallest bloom level, a
// log average weighted to the middle of the view) and moves toward it: quickly when it gets brighter (about a second),
// slowly when it gets darker (several seconds), like real eyes.
const W_ADAPT = S_G + W_FS + /*wgsl*/`
@group(0) @binding(0) var<uniform> g: G;
@group(0) @binding(1) var tB: texture_2d<f32>;
@group(0) @binding(2) var tP: texture_2d<f32>;
@fragment fn fs() -> @location(0) vec4f {
  let d = vec2i(textureDimensions(tB)); var a = 0.; var w = 0.;
  for (var y = 0; y < d.y; y++) { for (var x = 0; x < d.x; x++) {
    let l = dot(textureLoad(tB, vec2i(x, y), 0).rgb, vec3f(.2126, .7152, .0722));
    let q = (vec2f(f32(x), f32(y)) + .5) / vec2f(d) - .5; let k = 1. - 1.6 * dot(q, q);
    a += k * log(l + 1e-4); w += k;
  } }
  let m = exp(a / w); let p = textureLoad(tP, vec2i(0), 0).r;
  if (p <= 0.) { return vec4f(m, 0., 0., 1.); }
  let tau = select(4.5, 1., m > p);
  return vec4f(exp(mix(log(p), log(m), 1. - exp(-g.mis.y / tau))), 0., 0., 1.);
}
`;

// ---------------------------------------------------------------- final composite
const W_POST = S_G + W_FS + /*wgsl*/`
@group(0) @binding(0) var<uniform> g: G;
@group(0) @binding(1) var sC: sampler;
@group(0) @binding(2) var tS: texture_2d<f32>;
@group(0) @binding(3) var tB: texture_2d<f32>;
@group(0) @binding(4) var tA: texture_2d<f32>;
fn sat3(x: vec3f) -> vec3f { return clamp(x, vec3f(0.), vec3f(1.)); }
fn tmap(x: vec3f) -> vec3f { return sat3((x * (2.51 * x + .03)) / (x * (2.43 * x + .59) + .14)); }
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let px = vec2i(fc.xy);
  let uv = fc.xy * g.res.zw;
  var c = textureLoad(tS, px, 0).rgb;
  let bl = textureSampleLevel(tB, sC, uv, 0.).rgb;
  c = mix(c, bl, .05) + bl * .06;
  // Night vision. Where the light is dim (moon, sky, starlight) the eye sees with its rods: almost no colour, reds turn
  // dark, everything goes grey with a slight blue cast. Only where the fire or lantern lights things up enough do the
  // cones see colour again. Done on the scene light before exposure, so it follows how bright things really are.
  let lp = dot(c, vec3f(.2126, .7152, .0722));
  let sc = dot(c, vec3f(.01, .37, .62));
  c = mix(sc * mix(vec3f(.78, .88, 1.05), vec3f(.52, .74, 1.3), g.tn.y), c, max(ss(.06, .5, lp), .14)); // a trace of colour survives
  // exposure: the eyes adjust only a little; a dark scene stays dark
  let ad = textureLoad(tA, vec2i(0), 0).r;
  c *= g.mis.x * g.mis.w * clamp(pow(.032 / max(ad, 1e-5), .4), .7, 1.5); // mis.w: the fade in at the start
  let q = uv - .5;
  c *= 1. - dot(q, q) * .85;
  c = tmap(c);
  // the original project's contrast curve: deeper darks, a soft shoulder on the highlights
  let l0 = dot(c, vec3f(.2126, .7152, .0722));
  c *= mix(l0, l0 * l0 * (3. - 2. * l0), g.tn.z) / max(l0, 1e-4);
  // in the dark the eye loses colour and sees a little bluer: only the dimmest parts of the image
  let l = dot(c, vec3f(.2126, .7152, .0722));
  c = mix(vec3f(l) * vec3f(.85, .95, 1.12), c, .75 + .25 * ss(.03, .45, l));
  c = pow(max(c, vec3f(0.)), vec3f(1. / 2.2));
  let n = ign(fc.xy) + ign(fc.xy + 37.) - 1.;
  return vec4f(c + n / 255., 1.);
}
`;
