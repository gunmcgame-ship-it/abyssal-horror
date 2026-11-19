// ============================================================================
// renderer, camera and input
// ============================================================================
const $ = (id) => document.getElementById(id);
const canvas = $('c'), info = $('i'), body = document.body;
// a phone held upright gets the page turned on its side (see template.html)
const rot = matchMedia('(orientation:portrait) and (pointer:coarse)');
// loading bar: each stage glides it to `to` (the share done) over ~`ms` on the compositor, so it moves while this
// thread is busy
let loaded = 0, dead; // dead: the graphics device was lost
const say = (m, to, ms) => {
  if (!dead) $('s').textContent = m;
  const a = $('b').animate({ transform: [`scaleX(${loaded})`, `scaleX(${to})`] }, { duration: ms, fill: 'forwards', easing: 'cubic-bezier(.3,.5,.5,1)' });
  loaded = to;
  // go on once the animation runs: one not started before the thread gets busy stays stuck (timer: hidden tabs)
  return new Promise((r) => { a.ready.then(() => setTimeout(r)); setTimeout(r, document.hidden ? 0 : 1e3); });
};
const fail = (m) => { throw new Error(m, { cause: 1 }); }; // cause marks a message that is shown as it is
if (!navigator.gpu) fail('This scene needs WebGPU. Try a current Chrome or Edge.');
const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
if (!adapter) fail('No WebGPU adapter found.');
$('w').hidden = !!navigator.userAgentData; // only Chromium-based browsers have it
const hasTS = adapter.features.has('timestamp-query');
const device = await adapter.requestDevice({ requiredFeatures: hasTS ? ['timestamp-query'] : [] });
device.addEventListener('uncapturederror', (e) => console.error('GPU: ' + e.error.message));
// out of memory or a GPU timeout: reload a level lower, or on Low say what happened
device.lost.then((l) => {
  if (l.reason === 'destroyed') return; // the page is closing
  if (LV < 2) { keep('abyssal', LV + 1); location.reload(); }
  dead = body.className = 'l e'; $('s').textContent = 'The graphics device was lost. Reload the page to try again.';
});
const ctx = canvas.getContext('webgpu'), FMT = navigator.gpu.getPreferredCanvasFormat();
const Q = device.queue, HDR = 'rgba16float', DEPTH = 'depth32float';
const TU = GPUTextureUsage, BU = GPUBufferUsage, SS = GPUShaderStage;

const mod = (code) => device.createShaderModule({ code });
const buf = (data, usage) => { const b = device.createBuffer({ size: (data.byteLength + 3) & ~3, usage: usage | BU.COPY_DST }); Q.writeBuffer(b, 0, data.buffer || data, data.byteOffset || 0, data.byteLength); return b; };
const tex = (w, h, format, usage, o = {}) => device.createTexture({ size: [w, h, o.d || 1], format, usage, mipLevelCount: o.mips || 1, sampleCount: o.samples || 1, dimension: o.d ? '3d' : '2d' });

// ---------------------------------------------------------------- static resources
const sRep = device.createSampler({ addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: LV > 1 ? 1 : 8 });
const sClamp = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
const sCmp = device.createSampler({ compare: 'less-equal', magFilter: 'linear', minFilter: 'linear' });
// the paper atlas (paperart.js): every sheet of paper drawn once, with real type
const sPaper = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: LV > 1 ? 1 : 8 });
const tPaper = makePaperAtlas();
const tShadow = tex(SHADOW, SHADOW, DEPTH, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING);
const tDummy = tex(1, 1, DEPTH, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING);
// the lantern's forward shadow map (High only), re-rendered every frame from the flame
const LSH = !LV, tLShadow = tex(LSH ? 1024 : 1, LSH ? 1024 : 1, DEPTH, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING);
const tDetail = tex(1024, 1024, 'rgba8unorm', TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING, { mips: 11 });
const tVol = tex(NX / 2, NY / 2, 'rg8unorm', TU.TEXTURE_BINDING | TU.COPY_DST, { d: NZ / 2 });
const tMap = tex(512, 512, 'rgba8unorm', TU.TEXTURE_BINDING | TU.COPY_DST);

// uniforms (struct G in shaders.js): view-projection, shadow matrix, camera, basis, moon, resolution, misc, fire, lantern,
// moonlight, eclipse shadow
const UB = new Float32Array(100), UBS = new Float32Array(100), UBL = new Float32Array(100);
const ubo = device.createBuffer({ size: 400, usage: BU.UNIFORM | BU.COPY_DST }), uboS = device.createBuffer({ size: 400, usage: BU.UNIFORM | BU.COPY_DST }), uboL = device.createBuffer({ size: 400, usage: BU.UNIFORM | BU.COPY_DST });
// the night look, in one place: moonlight, sky fill in the shadows, blue of night vision, contrast in the darks,
// overall brightness (1 = as designed). The dev build has sliders for them (T).
const LOOK = { moon: 1.15, fill: 0.73, blue: 1, contrast: 0.88, bright: 0.42, haze: 1.4 }; // set by the owner by eye

const VF = SS.VERTEX | SS.FRAGMENT;
const bgl0 = device.createBindGroupLayout({ entries: [
  { binding: 0, visibility: VF, buffer: {} },
  { binding: 1, visibility: VF, sampler: {} }, { binding: 2, visibility: VF, sampler: {} }, { binding: 3, visibility: VF, sampler: { type: 'comparison' } },
  { binding: 4, visibility: VF, texture: { sampleType: 'depth' } }, { binding: 5, visibility: VF, texture: { sampleType: 'depth' } },
  { binding: 6, visibility: VF, texture: {} },
  { binding: 7, visibility: VF, texture: { viewDimension: '3d' } }, { binding: 8, visibility: VF, texture: {} },
  { binding: 9, visibility: VF, texture: {} }, { binding: 10, visibility: VF, sampler: {} }] });
const mkBG0 = (u, sh, ls = tDummy) => device.createBindGroup({ layout: bgl0, entries: [
  { binding: 0, resource: { buffer: u } }, { binding: 1, resource: sRep }, { binding: 2, resource: sClamp }, { binding: 3, resource: sCmp },
  { binding: 4, resource: sh.createView() }, { binding: 5, resource: ls.createView() }, { binding: 6, resource: tDetail.createView() },
  { binding: 7, resource: tVol.createView() }, { binding: 8, resource: tMap.createView() },
  { binding: 9, resource: tPaper.createView() }, { binding: 10, resource: sPaper }] });
const bg0 = mkBG0(ubo, tShadow, tLShadow), bg0s = mkBG0(uboS, tDummy), bg0l = mkBG0(uboL, tDummy);
const pl0 = device.createPipelineLayout({ bindGroupLayouts: [bgl0] });

const bglBlit = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: SS.FRAGMENT, texture: {} }, { binding: 1, visibility: SS.FRAGMENT, sampler: {} }] });
const plBlit = device.createPipelineLayout({ bindGroupLayouts: [bglBlit] });
const mBlit = mod(W_BLIT);
const blitPipe = (entry, format, add) => device.createRenderPipeline({ layout: plBlit, vertex: { module: mBlit, entryPoint: 'vs' },
  fragment: { module: mBlit, entryPoint: entry, targets: [{ format, blend: add ? { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } } : undefined }] } });
const pMip8 = blitPipe('fsMip', 'rgba8unorm'), pDown0 = blitPipe('fsDown0', HDR), pDown = blitPipe('fsDown', HDR), pUp = blitPipe('fsUp', HDR, true);
const blitBG = (view) => device.createBindGroup({ layout: bglBlit, entries: [{ binding: 0, resource: view }, { binding: 1, resource: sClamp }] });
const colorAtt = (view, clear) => ({ view, loadOp: clear ? 'clear' : 'load', storeOp: 'store', clearValue: [0, 0, 0, 0] });

// vertex layouts
const A = (shaderLocation, offset, format) => ({ shaderLocation, offset, format });
const vbSolid = { arrayStride: 16, attributes: [A(0, 0, 'float32x3'), A(1, 12, 'snorm8x4')] };
const ibSolid = { arrayStride: 48, stepMode: 'instance', attributes: [A(2, 0, 'float32x4'), A(3, 16, 'float32x4'), A(4, 32, 'float32x4')] };
const ibLeaf = { arrayStride: 36, stepMode: 'instance', attributes: [A(0, 0, 'float32x4'), A(1, 16, 'float32x4'), A(2, 32, 'unorm8x4')] };
const ibFire = { arrayStride: 32, stepMode: 'instance', attributes: [A(0, 0, 'float32x4'), A(1, 16, 'float32x4')] };

const scenePipe = (m, vsE, fsE, buffers, o = {}) => device.createRenderPipeline({ layout: pl0,
  vertex: { module: m, entryPoint: vsE, buffers, constants: o.constants },
  fragment: { module: m, entryPoint: fsE, targets: [{ format: HDR, blend: o.blend }] },
  primitive: { topology: o.strip ? 'triangle-strip' : 'triangle-list', cullMode: o.cull || 'none' },
  depthStencil: { format: DEPTH, depthWriteEnabled: !o.blend, depthCompare: 'greater' }, multisample: { count: AA } });
const shadowPipe = (m, vsE, buffers, o = {}) => device.createRenderPipeline({ layout: pl0,
  vertex: { module: m, entryPoint: vsE, buffers, constants: o.constants },
  primitive: { topology: o.strip ? 'triangle-strip' : 'triangle-list', cullMode: o.cull || 'none' },
  depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 1.5 } });

await say('Compiling shaders…', 0.05, 300);
const mSolid = mod(W_SOLID), mLeaf = mod(W_LEAF), mSky = mod(W_SKY), mFire = mod(W_FIRE);
const pTerrain = scenePipe(mSolid, 'vs', 'fs', [vbSolid, ibSolid], { cull: 'back' });
const pSolid = scenePipe(mSolid, 'vs', 'fs', [vbSolid, ibSolid]);
const pLeaf = scenePipe(mLeaf, 'vs', 'fs', [ibLeaf], { strip: true, constants: { ROWS: 9 } });
const pLeaf5 = scenePipe(mLeaf, 'vs', 'fs', [ibLeaf], { strip: true, constants: { ROWS: 5 } });
const pLeafS = scenePipe(mLeaf, 'vs', 'fs', [ibLeaf], { strip: true, constants: { ROWS: 3, FAR: 70 } });
const pLeafF = scenePipe(mLeaf, 'vs', 'fs', [ibLeaf], { strip: true, constants: { ROWS: 3 } });
const pSky = scenePipe(mSky, 'vs', 'fs', [], { strip: true });
const ADD = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } };
const pFire = scenePipe(mFire, 'vs', 'fs', [ibFire], { strip: true, blend: ADD });
const pStars = scenePipe(mod(W_STARS), 'vs', 'fs', [ibFire], { strip: true, blend: ADD });
const pSolidSh = shadowPipe(mSolid, 'vs', [vbSolid, ibSolid]), pTerrSh = shadowPipe(mSolid, 'vs', [vbSolid, ibSolid], { cull: 'front' });
const pLeafSh = shadowPipe(mLeaf, 'vs', [ibLeaf], { strip: true, constants: { ROWS: 3 } });
const mPost = mod(W_POST);
// the eye's adaptation: tAd is this frame's value, tAdP last frame's (copied over after the frame)
const tAd = tex(1, 1, 'r32float', TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING | TU.COPY_SRC), tAdP = tex(1, 1, 'r32float', TU.TEXTURE_BINDING | TU.COPY_DST);
const mAdapt = mod(W_ADAPT), pAdapt = device.createRenderPipeline({ layout: 'auto', vertex: { module: mAdapt, entryPoint: 'vs' }, fragment: { module: mAdapt, entryPoint: 'fs', targets: [{ format: 'r32float' }] } });
const passAdapt = { colorAttachments: [colorAtt(tAd.createView(), true)] };
const pPost = device.createRenderPipeline({ layout: 'auto', vertex: { module: mPost, entryPoint: 'vs' }, fragment: { module: mPost, entryPoint: 'fs', targets: [{ format: FMT }] } });

// ---------------------------------------------------------------- moon + shadow matrix
// An orthographic view from the moon (MOON in shaders.js). The moon is low, so the world seen from it is wide and
// short: the map covers 2 x 215 m across and 2 x 110 m up, and 520 m in depth.
{
  const L = MOON, ll = hypot(L[0], L[2]), lr = [-L[2] / ll, 0, L[0] / ll];
  const lu = [L[1] * lr[2] - L[2] * lr[1], L[2] * lr[0] - L[0] * lr[2], L[0] * lr[1] - L[1] * lr[0]];
  const RX = 215, RY = 110, d0 = -260, d1 = 260, m = UBS;
  m[0] = lr[0] / RX; m[4] = lr[1] / RX; m[8] = lr[2] / RX; m[12] = 0;
  m[1] = lu[0] / RY; m[5] = lu[1] / RY; m[9] = lu[2] / RY; m[13] = 0;
  m[2] = -L[0] / (d1 - d0); m[6] = -L[1] / (d1 - d0); m[10] = -L[2] / (d1 - d0); m[14] = d1 / (d1 - d0);
  m[3] = 0; m[7] = 0; m[11] = 0; m[15] = 1;
  for (let i = 0; i < 16; i++) { UBS[16 + i] = m[i]; UB[16 + i] = m[i]; }
  for (let i = 0; i < 3; i++) { UB[48 + i] = UBS[48 + i] = MOON[i]; }
  UBS[32] = 0; UBS[33] = -20; UBS[34] = 0; UBS[35] = 0; UBS[58] = 1;
  Q.writeBuffer(uboS, 0, UBS);
}

// ---------------------------------------------------------------- world generation
await say('Shaping the canyon…', 0.25, 1200);
// marks a load in progress (quality.js); leaving the page before it ends is not a crash
keep('abyssalLoad', 1);
addEventListener('pagehide', () => keep('abyssalLoad', ''));
let D;
{
  const prims = primBuffer();
  const m = mod(W_DENS), p = device.createComputePipeline({ layout: 'auto', compute: { module: m, entryPoint: 'main' } });
  const size = NX * NY * NZ * 4;
  const u = new ArrayBuffer(48), uu = new Uint32Array(u), uf = new Float32Array(u);
  uu[0] = NX; uu[1] = NY; uu[2] = NZ; uf[4] = OX; uf[5] = OY; uf[6] = OZ; uf[7] = VS;
  uu[8] = MESAS.length; uu[9] = ARCHES.length; uu[10] = HOLES.length; uu[11] = CLEARS.length;
  const bu = buf(new Uint8Array(u), BU.UNIFORM), bp = buf(prims, BU.STORAGE);
  const bd = device.createBuffer({ size, usage: BU.STORAGE | BU.COPY_SRC }), br = device.createBuffer({ size, usage: BU.MAP_READ | BU.COPY_DST });
  const bg = device.createBindGroup({ layout: p.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: bu } }, { binding: 1, resource: { buffer: bd } }, { binding: 2, resource: { buffer: bp } }] });
  const e = device.createCommandEncoder(), c = e.beginComputePass();
  c.setPipeline(p); c.setBindGroup(0, bg); c.dispatchWorkgroups(NX / 4, NY / 4, NZ / 4); c.end();
  e.copyBufferToBuffer(bd, 0, br, 0, size);
  Q.submit([e.finish()]);
  await br.mapAsync(GPUMapMode.READ);
  D = new Float32Array(br.getMappedRange().slice(0));
  br.unmap(); br.destroy(); bd.destroy();
  // rock connected to the seabed: each column's unbroken run up from the bottom is, and the rock above a gap
  // (overhangs, specks) is when it touches rock that is. What never connects is a speck of noise floating in
  // the air (surface nets would make it a small box), so it becomes air
  const S = NX * NY, R = new Uint8Array(D.length), O = [1, -1, NX, -NX, S, -S], b = new Uint8Array(NX), L = [];
  for (let i = 0; i < D.length;) { b.fill(1); for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++, i++) if (D[i] <= 0) b[x] = 0; else if (b[x]) R[i] = 1; else L.push(i); }
  for (let k = 1; k; L.reverse()) { k = 0; for (const i of L) if (!R[i] && O.some((o) => R[i + o])) R[i] = k = 1; }
  for (const i of L) if (!R[i]) D[i] = -D[i];
}
// Distance to the rock for collide(), in 1/127 m (> 0 in rock, clamped to ±1 m), kept only in the 4x4x4-voxel
// bricks near the surface within the camera's reach (~2 MB). CI per brick: 0 all air, 1 all rock, n brick n-2 in CG.
const CO = 52, CN = 102, CI = new Uint16Array(CN * CN * NY / 4);
let CG = new Int8Array(64 * 65534);
{
  let n = 0;
  for (let bz = 0; bz < CN; bz++) for (let by = 1; by < NY / 4 - 1; by++) for (let bx = 0; bx < CN; bx++) {
    if (hypot(bx - CN / 2 + 0.5, bz - CN / 2 + 0.5) > 52) continue; // more than 156 m out: never reached
    let lo = 127, hi = -127;
    for (let z = 0; z < 4; z++) for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const i = CO + bx * 4 + x + NX * (by * 4 + y + NY * (CO + bz * 4 + z)), gz = D[i + NX * NY] - D[i - NX * NY];
      const gx = D[i + 1] - D[i - 1], g = D[i + NX] - D[i - NX], l = sqrt(gx * gx + g * g + gz * gz) / 1.5;
      const q = round(clamp(D[i] / max(l, 0.05), -1, 1) * 127);
      CG[n * 64 + x + 4 * y + 16 * z] = q; if (q < lo) lo = q; if (q > hi) hi = q;
    }
    CI[bx + CN * (by + NY / 4 * bz)] = lo === hi && lo * lo === 16129 ? +(lo > 0) : (n++, n + 1);
  }
  CG = CG.slice(0, n * 64);
}
await say('Weathering the sandstone…', 0.32, 400);
const T = buildTerrain(D);
// HM: height of the lowest floor in every column of the density grid (0.75 m apart): what you walk on, under the
// arches too. SANDM: sand (255) or bare rock (0) on the flats, for the footsteps.
const HM = new Float32Array(NX * NZ);
for (let iz = 0; iz < NZ; iz++) for (let ix = 0; ix < NX; ix++) {
  let y = OY;
  for (let gy = 0; gy < NY - 1; gy++) { const d = D[ix + NX * (gy + NY * iz)], da = D[ix + NX * (gy + 1 + NY * iz)]; if (d > 0 && da <= 0) { y = OY + (gy + d / (d - da)) * VS; break; } }
  HM[ix + NX * iz] = y;
}
const groundAt = (x, z) => {
  const fx = clamp((x - OX) / VS, 0, NX - 1.001), fz = clamp((z - OZ) / VS, 0, NZ - 1.001), ix = fx | 0, iz = fz | 0, u = fx - ix, v = fz - iz, i = ix + NX * iz;
  return (HM[i] * (1 - u) + HM[i + 1] * u) * (1 - v) + (HM[i + NX] * (1 - u) + HM[i + NX + 1] * u) * v;
};

// preset viewpoints (position with y above the ground, look-at), dev keys 1-6; the world generator keeps them clear
// 1 tent door, 2 the camp from outside, 3 the ruins pocket, 4 the bend east of camp, 5 the south rim where the ridge
// figure will stand (M5), 6 an overlook on the plateau north of the canyon
const POSES = [
  [CAMP[0] + 1, 1.62, CAMP[2] + 6.4, CAMP[0] - 1, -44.0, CAMP[2] - 8],
  [CAMP[0] - 9, 2.2, CAMP[2] - 9, CAMP[0] + 3, -44.5, CAMP[2] + 3],
  [-38, 1.7, -86, -60, -42, -88],
  [-4, 1.7, 46, 14, -40, 76],
  [2, 1.7, 22, -26, -14, 30],
  [40, 1.7, -60, -2, -44, -40],
];
// the benchmark walk (dev.js, F/B): 60 s along the canyon floor from the ruins basin, past camp, out east;
// eye height above the floor, looking along the way
const FLYXZ = [[-52, -86], [-30, -86], [-10, -78], [-6, -62], [0, -46], [-2, -20], [-6, -4], [-8, 8], [-8, 24], [-6, 38], [4, 56], [12, 72], [6, 88], [-4, 98], [-3, 108], [6, 124], [10, 134]];
const FLY = new Float32Array(FLYXZ.length * 6);
FLYXZ.forEach(([x, z], i) => { const [lx, lz] = FLYXZ[min(i + 2, FLYXZ.length - 1)], ex = i > FLYXZ.length - 3 ? x + (x - FLYXZ[i - 1][0]) * 3 : lx, ez = i > FLYXZ.length - 3 ? z + (z - FLYXZ[i - 1][1]) * 3 : lz;
  FLY.set([x, groundAt(x, z) + 1.8, z, ex, groundAt(ex, ez) + 1.5, ez], i * 6); });
const FLYN = FLY.length / 6, FLYT = 60, LUTN = 1024, flyLUT = new Float32Array(LUTN + 1);
const flyPts = [];
// per-frame float state lives in one preallocated array, so the frame loop allocates no heap numbers
const F = new Float64Array(48), P6 = new Float64Array(6);
const CX = 0, CY = 1, CZ = 2, YAW = 3, PIT = 4, FX = 5, FY = 6, FZ = 7, RX = 8, RZ = 9, UX = 10, UY = 11, UZ = 12, VX = 13, VY = 14, VZ = 15, TIME = 16, FLT = 17, LAST = 18, GPU = 19, HUDT = 20, SPL = 21, MX = 22, MY = 23, MZ = 24, DT = 25, ECT = 26, LIFT = 27, PLAY = 28,
  PX = 29, PY = 30, PZ = 31, STEP = 32, AMP = 33, SWG = 34, SWV = 35, ZOOM = 36, WAKE = 37, LHOLD = 38, FADE = 39, BX = 40, BY = 41, BZ = 42, WX = 43, WZ = 44, SKIP = 45;
F[WAKE] = -1; F[FADE] = 1; F[LHOLD] = 1;
// DEV: the dev build (dev.js) sets it; FLYCAM: the old free camera (dev only), otherwise you walk
let DEV = false, FLYCAM = false;
// aim the camera from P6 = position + look-at point
function aim() {
  const dx = P6[3] - P6[0], dy = P6[4] - P6[1], dz = P6[5] - P6[2];
  F[CX] = P6[0]; F[CY] = P6[1]; F[CZ] = P6[2];
  F[YAW] = atan2(dx, -dz); F[PIT] = atan2(dy, sqrt(dx * dx + dz * dz));
}
const lookAt = (x, y, z, tx, ty, tz) => { P6[0] = x; P6[1] = y; P6[2] = z; P6[3] = tx; P6[4] = ty; P6[5] = tz; aim(); };
// camera spline (Catmull-Rom over position + look-at) at parameter F[SPL]
function flyRaw() {
  const s = F[SPL]; let i = floor(s) | 0; if (i > FLYN - 2) i = FLYN - 2;
  const u = s - i, i0 = (i > 0 ? i - 1 : 0) * 6, i1 = i * 6, i2 = (i + 1) * 6, i3 = (i + 2 < FLYN ? i + 2 : FLYN - 1) * 6;
  for (let o = 0; o < 6; o++) {
    const a = FLY[i0 + o], b = FLY[i1 + o], c = FLY[i2 + o], d = FLY[i3 + o];
    P6[o] = 0.5 * (2 * b + (c - a) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (3 * b - a - 3 * c + d) * u * u * u);
  }
  aim();
}
{ // arc-length table: flyLUT[k] = spline parameter at fraction k/LUTN of the total path length
  const M = 4096, len = new Float32Array(M + 1); let px = 0, py = 0, pz = 0;
  for (let k = 0; k <= M; k++) { F[SPL] = k / M * (FLYN - 1); flyRaw(); if (k) len[k] = len[k - 1] + hypot(F[CX] - px, F[CY] - py, F[CZ] - pz); px = F[CX]; py = F[CY]; pz = F[CZ]; }
  for (let k = 0, j = 0; k <= LUTN; k++) { const d = k / LUTN * len[M]; while (j < M - 1 && len[j + 1] < d) j++; flyLUT[k] = (j + (d - len[j]) / max(len[j + 1] - len[j], 1e-6)) / M * (FLYN - 1); }
}
// camera on the scripted path at time F[FLT]
function flyAt() {
  let s = F[FLT] / FLYT; s = s < 0 ? 0 : s > 1 ? 1 : s; s = s * s * (3 - 2 * s) * 0.25 + s * 0.75;
  s *= LUTN; let k = floor(s) | 0; if (k > LUTN - 1) k = LUTN - 1;
  F[SPL] = flyLUT[k] + (flyLUT[k + 1] - flyLUT[k]) * (s - k); flyRaw();
}
for (let t = 0; t <= FLYT; t += 0.1) { F[FLT] = t; flyAt(); flyPts.push([F[CX], F[CY], F[CZ]]); }
for (const p of POSES) flyPts.push([p[0], -40, p[2]]);

await say('Planting sagebrush and juniper…', 0.73, 2500);
const Wd = makeWorld(D, T, flyPts, POSES);
for (const p of POSES) p[1] += Wd.gy(p[0], p[2]);
// ---------------------------------------------------------------- walking: the ground, and what is in the way
const SANDM = new Uint8Array(512 * 512); for (let i = 0; i < SANDM.length; i++) SANDM[i] = Wd.gm[i * 4 + 3];
const sandAt = (x, z) => SANDM[clamp(((x + 192) / 384 * 512) | 0, 0, 511) + 512 * clamp(((z + 192) / 384 * 512) | 0, 0, 511)] / 255;
// obstacles (x, z, radius) in a 4 m grid: rocks, cacti, trunks, fallen blocks
const OBC = 96, obCell = Array.from({ length: OBC * OBC }, () => []);
for (let i = 0; i < Wd.obs.length; i += 3) { const c = clamp(((Wd.obs[i] + 192) / 4) | 0, 0, OBC - 1) + OBC * clamp(((Wd.obs[i + 1] + 192) / 4) | 0, 0, OBC - 1); obCell[c].push(Wd.obs[i], Wd.obs[i + 1], Wd.obs[i + 2]); }
// the camp: boxes (camp x, z, half sizes, yaw) and circles (x, z, radius); keep in step with meshCamp() in world.js
const CBOX = [
  [8.3, -4.2, 1.35, 2.66, 0], [8.3, 2.96, 1.4, 3.22, 0], [8.3, -1.0, 1.0, 0.85, 0],  // pickup, trailer, the hitch (reaching back to the wall)
  [1, 9.3, 1.6, 0.07, 0], [-0.5, 7.5, 0.07, 1.86, 0], [2.5, 7.5, 0.07, 1.86, 0], // tent: back and side walls
  [-0.06, 5.7, 0.54, 0.07, 0], [2.06, 5.7, 0.54, 0.07, 0],                     // tent: front wall beside the door
  [-0.15, 8.86, 0.24, 0.27, 0],                                                 // crate in the tent
  [3.4, -0.9, 0.31, 0.63, 0.25], [2.3, 2.4, 0.34, 0.2, 0.4], [-3.0, -2.55, 0.32, 0.42, 0],
  [5.83, 1.22, 0.1, 0.24, 0], [2.75, 5.3, 0.16, 0.39, 0.72], [-2.47, 5.98, 0.18, 0.14, 0],
  [PICNIC[0], PICNIC[1], 0.88, 0.94, 0], [SIGN[0], SIGN[1], 1.15, 0.1, SIGN[2]],   // picnic table, park sign
], CCIR = [[0, 0, 0.78], [-1.6, 1.1, 0.34], [-3.6, 3.9, 0.45], [-2.15, 6.05, 0.17], [CAMERA[0], CAMERA[1], 0.42]];
// push a point (qx, qz) out of a box (centre cx, cz, half sizes, yaw): the push lands in BPX, BPZ
let BPX = 0, BPZ = 0;
function boxPush(qx, qz, cx, cz, hx, hz, yw) {
  const c = cos(yw), sn = sin(yw), lx = (qx - cx) * c - (qz - cz) * sn, lz = (qx - cx) * sn + (qz - cz) * c;
  const px = clamp(lx, -hx, hx), pz = clamp(lz, -hz, hz), dx = lx - px, dz = lz - pz, d = hypot(dx, dz);
  let ox = 0, oz = 0;
  if (d > 1e-4) { if (d < PR) { ox = dx / d * (PR - d); oz = dz / d * (PR - d); } }
  else { const ex = hx - abs(lx), ez = hz - abs(lz); if (ex < ez) ox = (ex + PR) * Math.sign(lx || 1); else oz = (ez + PR) * Math.sign(lz || 1); }
  BPX = ox * c + oz * sn; BPZ = -ox * sn + oz * c;
}
D = Wd.gy = T.smp = null; // with gy goes the generator's working memory (about 200 MB)

await say('Pitching camp…', 0.94, 1200);
// mesh ids: 0-3 rocks, 4 barrel cactus, 5 hedgehog cactus, 6-7 prickly pear, 8 juniper trunk, 9 pinyon trunk,
// 10 the camp, 11 the lantern, 12 the folding chair, 13 your hand on the lantern, 14-20 rock chunks + pebbles, 21-22 unused,
// 23-25 far LOD of the large rock chunks, 26-29 the ruins' building stones, 30 the rest of the ruins, 31-33 the supper
// stages (drawn once RSTAGE reaches 1, 2, 3), 34 the traces of later visitors (ruins.js), 35-38 the building stones in
// low detail (used beyond 22 m), 39-47 single objects placed as instances (ruins.js: logs, lintel, board, old table and
// bench (stage 1), stove, park sign, trail marker)
const unused = () => { const m = new Mesh(); m.tri(m.v(0, 0, 0), m.v(0.01, 0, 0), m.v(0, 0.01, 0)); return m; };
// made things get their ambient occlusion baked in (bakeAO: contact shadows, the inside of the truck bed, under tables)
const AO = (m, o) => { const t0 = performance.now(), r = bakeAO(m, o); if (DEV) console.log('AO', m.p.length / 3, Math.round(performance.now() - t0) + ' ms'); return r; };
const meshes = [meshChunk(1, 3), meshChunk(7, 3), meshChunk(13, 3), meshChunk(22, 3), AO(meshBarrel(), { ground: 0, res: 0.015, maxD: 0.25 }), AO(meshHedgehog(), { ground: 0, res: 0.015, maxD: 0.25 }), AO(meshPear(0), { ground: 0, res: 0.015, maxD: 0.3 }), AO(meshPear(1), { ground: 0, res: 0.015, maxD: 0.3 }), Wd.trunks[0].m, Wd.trunks[1].m,
  AO(meshCamp(), { ground: -0.01 }), meshLantern(), AO(meshChair(), { ground: 0, res: 0.02 }), meshHand(),
  meshChunk(3), meshChunk(11), meshChunk(29), meshChunk(5, 3), meshChunk(17, 3), meshChunk(41, 3), meshChunk(9, 1), unused(), unused(), meshChunk(5, 2, 1), meshChunk(17, 2, 1), meshChunk(41, 2, 1),
  meshBlock(1), meshBlock(2), meshBlock(3), meshBlock(4), Wd.ruinM, Wd.stgM[0], Wd.stgM[1], Wd.stgM[2], Wd.trM,
  meshBlock(1, 1), meshBlock(2, 1), meshBlock(3, 1), meshBlock(4, 1),
  meshLog(false), meshLog(true), meshBeam(), meshBoard(), AO(meshOldTable(), { ground: 0, res: 0.02 }), AO(meshBench(), { ground: 0, res: 0.02 }), AO(meshStove(), { ground: 0, res: 0.02 }), AO(meshSign(), { ground: 0, res: 0.02 }), AO(meshMarker(), { ground: 0, res: 0.02 })].map((m) => m.build());
let nV = 0, nI = 0;
for (const m of meshes) { m.v0 = nV; m.i0 = nI; nV += m.nv; nI += m.ib.length; }
const allV = new Uint8Array(nV * 16), allI = new Uint32Array(nI);
for (const m of meshes) { allV.set(new Uint8Array(m.vb), m.v0 * 16); allI.set(m.ib, m.i0); }
const vbMesh = buf(allV, BU.VERTEX), ibMesh = buf(allI, BU.INDEX);
const vbTerrain = buf(new Uint8Array(T.vb), BU.VERTEX), ibTerrain = buf(T.ib, BU.INDEX); const nTerrIdx = T.ib.length;
const nSolid = Wd.solids.data.length / 12;
const solidData = new Float32Array((nSolid + 1) * 12); solidData.set(Wd.solids.data); solidData.set([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0], nSolid * 12);
const ibSolids = buf(solidData, BU.VERTEX);
const ibChunk = Wd.chunks.map((c) => buf(c.data, BU.VERTEX)), ibProp = Wd.props.map((c) => buf(c.data, BU.VERTEX));
const ibBig = buf(new Uint8Array(Wd.big.buf), BU.VERTEX), ibBigF = buf(new Uint8Array(Wd.bigF.buf), BU.VERTEX), ibSmall = buf(new Uint8Array(Wd.small.buf), BU.VERTEX);
const ibFireB = buf(Wd.fire, BU.VERTEX), nFire = Wd.fire.length / 8;
// the bright stars, and the satellite in the last slot (rewritten every frame)
const STARB = starData(), ibStars = buf(STARB, BU.VERTEX), nStars = STARB.length / 8, SATB = STARB.subarray((nStars - 1) * 8);
// the lantern is one instance, rewritten every frame (position, scale, rotation, material 2)
const LANT = new Float32Array([0, 0, 0, 0.78, 0, 0, 0, 1, 2, 0, 1, 0]), ibLant = buf(LANT, BU.VERTEX), LANTM = meshes[11], HANDM = meshes[13];
Q.writeTexture({ texture: tVol }, Wd.volD, { bytesPerRow: NX, rowsPerImage: NY / 2 }, [NX / 2, NY / 2, NZ / 2]);
Q.writeTexture({ texture: tMap }, Wd.gm, { bytesPerRow: 2048 }, [512, 512]);

// ---------------------------------------------------------------- one-time bakes: detail texture, shadow map
{
  const m = mod(W_DETAIL), p = device.createRenderPipeline({ layout: 'auto', vertex: { module: m, entryPoint: 'vs' }, fragment: { module: m, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] } });
  const e = device.createCommandEncoder();
  let r = e.beginRenderPass({ colorAttachments: [colorAtt(tDetail.createView({ baseMipLevel: 0, mipLevelCount: 1 }), true)] });
  r.setPipeline(p); r.draw(3); r.end();
  for (let i = 1; i < 11; i++) {
    r = e.beginRenderPass({ colorAttachments: [colorAtt(tDetail.createView({ baseMipLevel: i, mipLevelCount: 1 }), true)] });
    r.setPipeline(pMip8); r.setBindGroup(0, blitBG(tDetail.createView({ baseMipLevel: i - 1, mipLevelCount: 1 }))); r.draw(3); r.end();
  }
  Q.submit([e.finish()]);
}
// the supper stages in the ruins (0 nothing, 1 tables, 2 places set, 3 the meal): M5 moves it on; the moon's shadows are
// baked again when it changes
let RSTAGE = 0;
const solidOn = (i) => (i === W_TABLE || i === W_BENCH ? RSTAGE >= 1 : i < RUIN_STAGE || i > RUIN_STAGE + 2 || i - RUIN_STAGE < RSTAGE);
let ruinD = 0; // the camera's distance from the ruins, this frame
const solidMesh = (i) => (i >= RUIN_STONE && i < RUIN_STONE + 4 && ruinD > 22 ? meshes[i + 9] : meshes[i]);
const ruinSkip = (i, d) => ((i >= RUIN_STONE && i < TRACE_MESH) || (i >= W_LOG && i <= W_STOVE)) && d > 95;
const setRuinStage = (k) => { RSTAGE = clamp(k | 0, 0, 3); bakeMoonShadow(); };
function bakeMoonShadow() {
  const e = device.createCommandEncoder();
  const r = e.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: tShadow.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
  r.setBindGroup(0, bg0s);
  r.setPipeline(pTerrSh);
  r.setVertexBuffer(0, vbTerrain); r.setVertexBuffer(1, ibSolids); r.setIndexBuffer(ibTerrain, 'uint32');
  r.drawIndexed(nTerrIdx, 1, 0, 0, nSolid);
  r.setPipeline(pSolidSh); r.setVertexBuffer(0, vbMesh); r.setIndexBuffer(ibMesh, 'uint32');
  for (let i = 0; i < SOLN; i++) { const g = Wd.solids.ranges[i]; if (g[1] && solidOn(i)) r.drawIndexed(meshes[i].ib.length, g[1], meshes[i].i0, meshes[i].v0, g[0]); }
  // small rocks, cacti and tree trunks only on High: too much for a phone's driver
  if (!LV) for (let i = 0; i < NCHUNK; i++) { r.setVertexBuffer(1, ibChunk[i]); r.drawIndexed(meshes[14 + i].ib.length, Wd.chunks[i].n, meshes[14 + i].i0, meshes[14 + i].v0, 0); }
  if (!LV) for (let i = 0; i < 6; i++) if (Wd.props[i].n) { r.setVertexBuffer(1, ibProp[i]); r.drawIndexed(meshes[4 + i].ib.length, Wd.props[i].n, meshes[4 + i].i0, meshes[4 + i].v0, 0); }
  r.setPipeline(pLeafSh); r.setVertexBuffer(0, ibBig); r.draw(6, Wd.big.n);
  r.end();
  Q.submit([e.finish()]);
}
bakeMoonShadow();
// the GPU has its own copies now: let go of the generator's (about 300 MB)
for (const o of [Wd.big, Wd.bigF, Wd.small, ...Wd.chunks, ...Wd.props]) o.buf = o.data = 0;
Wd.obs = Wd.volD = Wd.gm = T.vb = T.ib = T.wp = T.wn = 0;

// ---------------------------------------------------------------- render targets (rebuilt on resize)
// The scene is drawn at `pix` pixels and scaled up to the window. frame() tunes it and the draw distance scale `det`
// for 60 fps; both start where the last visit left them.
const PIXMAX = 2560 * 1440, PIXMIN = mob ? 25e4 : 5e5, DETMIN = 0.4;
let W = 0, H = 0, DW = 0, DH = 0, pix = +SV[1] || (LV > 1 ? 41e4 : mob ? 1280 * 720 : PIXMAX), det = +SV[2] || 1, dynN = 0, dynT = 0, dynG = 0, dynGN = 0, dynBad = 0, dynOk = 0, dynWait = 3;
let passScene, passPost, bgPost, bgAdapt, bloomPass = [], bloomBG = [], targets = [];
const NB = 6;
function resize() {
  DW = max(2, round(canvas.clientWidth * devicePixelRatio)); DH = max(2, round(canvas.clientHeight * devicePixelRatio));
  const s = min(1, sqrt(pix / (DW * DH)));
  const w = max(2, round(DW * s) & ~1), h = max(2, round(DH * s) & ~1);
  if (w === W && h === H) return;
  dynN = dynG = dynGN = 0; dynT = -300; // let the new size settle before measuring again
  W = w; H = h; canvas.width = W; canvas.height = H;
  ctx.configure({ device, format: FMT, alphaMode: 'opaque' });
  for (const t of targets) t.destroy();
  const tMS = tex(AA > 1 ? W : 1, H, HDR, TU.RENDER_ATTACHMENT, { samples: AA }), tDp = tex(W, H, DEPTH, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING, { samples: AA });
  const tRes = tex(W, H, HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING);
  targets = [tMS, tDp, tRes];
  const bl = [];
  for (let i = 0; i < NB; i++) { const t = tex(max(1, W >> (i + 1)), max(1, H >> (i + 1)), HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING); bl.push(t); targets.push(t); }
  const vDp = tDp.createView(), vRes = tRes.createView(), vBl = bl.map((t) => t.createView());
  // without anti-aliasing (Low) the scene goes straight into the resolve target, and tMS is one unused column
  passScene = { colorAttachments: [{ view: AA > 1 ? tMS.createView() : vRes, resolveTarget: AA > 1 ? vRes : undefined, loadOp: 'clear', storeOp: AA > 1 ? 'discard' : 'store', clearValue: [0, 0, 0, 1] }],
    depthStencilAttachment: { view: vDp, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'store' } };
  passPost = { colorAttachments: [{ view: null, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] };
  bgPost = device.createBindGroup({ layout: pPost.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubo } }, { binding: 1, resource: sClamp }, { binding: 2, resource: vRes }, { binding: 3, resource: vBl[0] }, { binding: 4, resource: tAd.createView() }] });
  bgAdapt = device.createBindGroup({ layout: pAdapt.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubo } }, { binding: 1, resource: vBl[NB - 1] }, { binding: 2, resource: tAdP.createView() }] });
  bloomPass = []; bloomBG = [];
  // down: res -> b0 -> ... -> b5 ; up: b5 -> b4 (additive) ... -> b0
  for (let i = 0; i < NB; i++) { bloomPass.push({ colorAttachments: [colorAtt(vBl[i], true)] }); bloomBG.push(blitBG(i ? vBl[i - 1] : vRes)); }
  for (let i = NB - 1; i > 0; i--) { bloomPass.push({ colorAttachments: [colorAtt(vBl[i - 1], false)] }); bloomBG.push(blitBG(vBl[i])); }
  UB[52] = W; UB[53] = H; UB[54] = 1 / W; UB[55] = 1 / H;
}
resize();
addEventListener('resize', resize);

// ---------------------------------------------------------------- timing (GPU timestamp queries)
let qs, qResolve, qRead = [], tsBegin, tsEnd;
if (hasTS) {
  qs = device.createQuerySet({ type: 'timestamp', count: 2 });
  qResolve = device.createBuffer({ size: 16, usage: BU.QUERY_RESOLVE | BU.COPY_SRC });
  for (let i = 0; i < 6; i++) {
    const b = device.createBuffer({ size: 16, usage: BU.MAP_READ | BU.COPY_DST });
    const o = { b, busy: false, done: null };
    o.done = () => {
      const a = new BigInt64Array(b.getMappedRange());
      const ms = Number(a[1] - a[0]) / 1e6; F[GPU] = ms; b.unmap(); o.busy = false;
      if (dynT > 0 && ms > 0 && ms < 1e3) { dynG += ms; dynGN++; }
    };
    qRead.push(o);
  }
  tsBegin = { querySet: qs, beginningOfPassWriteIndex: 0 }; tsEnd = { querySet: qs, endOfPassWriteIndex: 1 };
}

// ---------------------------------------------------------------- the eclipse
// The total lunar eclipse of 7 November 1957, as seen from a southern California desert canyon, but one hour earlier than
// it really was (so the red moon hangs in a dark sky instead of setting at dawn). The sky itself stays at the moment
// totality begins (5:05 a.m.): the moon does not move. Only the earth's shadow moves across it.
// The game clock F[ECT] is in minutes after 3:35 a.m. and runs ECLX times faster than real time while playing:
// first bite ~3:44 (2 minutes in), totality 5:05-5:52 (20-30 minutes in), deepest at 5:26.
const ECLX = 4.5;
// the shadow centre relative to the moon in moon radii, east and north, from astro (canon.mjs in the notes): it moves
// in a straight line, 3.25, 2.18 at 3:35 to -1.03, 1.31 at 5:52. Umbra 2.67 and penumbra 4.83 moon radii.
// The parallactic angle (56.6 degrees) turns east/north into right/up on the disc as it sits low in the west.
const ECU = 2.67, ECP = 4.83, ECQ = 56.6 * PI / 180, MOON0 = [0.27, 0.254, 0.232];
const essm = (a, b, x) => { const t = x < a ? 0 : x > b ? 1 : (x - a) / (b - a); return t * t * (3 - 2 * t); };
function eclipse(m) {
  const t = F[ECT], ee = 3.25 - 0.03124 * t, nn = 2.18 - 0.00635 * t;
  const sx = -ee * cos(ECQ) + nn * sin(ECQ), sy = ee * sin(ECQ) + nn * cos(ECQ);
  // the moon's light: the disc brightness of the sky shader (pen, red) averaged over the disc, relative to uneclipsed
  let r = 0, g = 0, b = 0, n = 0;
  for (let j = 0; j < 9; j++) for (let i = 0; i < 9; i++) {
    const x = (i - 4) / 4, y = (j - 4) / 4; if (x * x + y * y > 1) continue;
    const dd = hypot(x - sx, y - sy), pen = essm(ECU - 0.12, ECP, dd), k = min(dd / ECU, 1), rd = (0.04 + 0.18 * k * k * k) * (1 - pen);
    r += pen + rd; g += pen + rd * 0.34 / 0.8; b += pen + rd * 0.12 / 0.58; n++;
  }
  r /= n; g /= n; b /= n;
  m[68] = MOON0[0] * r; m[69] = MOON0[1] * g; m[70] = MOON0[2] * b; m[71] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  m[72] = sx; m[73] = sy; m[74] = ECU; m[75] = ECP;
}

// ---------------------------------------------------------------- frame
let hud = false;
let kZoom = 0, kLift = 0, kf = 0, kb = 0, kl = 0, kr = 0, ku = 0, kd = 0, ks = 0, mdx = 0, mdy = 0, lkx = 0, lky = 0, l2x = 0, l2y = 0, hN = 0, hMax = 0, hMin = 1e9, hPer = 1e9, hLate = 0, hTot = 0, tId = -1, tN = 0, tx0 = 0, ty0 = 0, tx = 0, ty = 0;
// LANTP: the lantern light (the glass and flame are scaled back to look the same); TANH narrows for the focus zoom
const TANH0 = 0.6, NEAR = 0.1, LANTP = 4; let TANH = TANH0;
const submitList = [null];
const rowOrd = new Uint8Array(CELLS);
// Draws the cells of a cell-sorted buffer that are in view and within [minD, maxD) (scaled by `det`, but not for the
// terrain) as merged runs, nearest rows first.
function drawCells(r, start, lo, hi, mar, indexed, verts, minD, maxD) {
  const cx = F[CX], cy = F[CY], cz = F[CZ], fx = F[FX], fy = F[FY], fz = F[FZ], rx = F[RX], rz = F[RZ], ux = F[UX], uy = F[UY], uz = F[UZ];
  const ds = indexed === 1 ? 1 : det * det;
  const tx = TANH * W / H, hw = CELLW * 0.5, ex = hw + mar, min2 = minD * minD * ds, max2 = maxD * maxD * ds;
  for (let k = 0; k < CELLS; k++) {
    const rw = rowOrd[k], row = rw * CELLS, pz = OZ + (rw + 0.5) * CELLW - cz, hz = max(abs(pz) - hw, 0);
    let run = -1;
    for (let x = 0; x <= CELLS; x++) {
      const c = row + x; let v = false;
      if (x < CELLS) {
        const l = lo[c], h = hi[c];
        if (l <= h) {
          const px = OX + (x + 0.5) * CELLW - cx, py = (l + h) * 0.5 - cy, ey = (h - l) * 0.5 + mar, hx = max(abs(px) - hw, 0), h2 = hx * hx + hz * hz;
          if (h2 < max2 && h2 >= min2) {
            const lim = px * fx + py * fy + pz * fz + ex * abs(fx) + ey * abs(fy) + ex * abs(fz);
            if (lim >= 0 && abs(px * rx + pz * rz) - ex * (abs(rx) + abs(rz)) <= lim * tx) v = abs(px * ux + py * uy + pz * uz) - ex * (abs(ux) + abs(uz)) - ey * abs(uy) <= lim * TANH;
          }
        }
      }
      if (v) { if (run < 0) run = c; } else if (run >= 0) {
        const a = start[run], n = start[c] - a;
        if (n > 0) { if (indexed === 1) r.drawIndexed(n * 6, 1, a * 6, 0, nSolid); else if (indexed) r.drawIndexed(indexed.ib.length, n, indexed.i0, indexed.v0, a); else r.draw(verts, n, 0, a); }
        run = -1;
      }
    }
  }
}
function drawNear(r, start, indexed, verts, px, pz, R) {
  const c0 = clamp(floor((px - R - OX) / CELLW), 0, CELLS - 1), c1 = clamp(floor((px + R - OX) / CELLW), 0, CELLS - 1);
  const r0 = clamp(floor((pz - R - OZ) / CELLW), 0, CELLS - 1), r1 = clamp(floor((pz + R - OZ) / CELLW), 0, CELLS - 1);
  for (let rw = r0; rw <= r1; rw++) {
    const a = start[rw * CELLS + c0], n = start[rw * CELLS + c1 + 1] - a;
    if (n > 0) { if (indexed === 1) r.drawIndexed(n * 6, 1, a * 6, 0, nSolid); else if (indexed) r.drawIndexed(indexed.ib.length, n, indexed.i0, indexed.v0, a); else r.draw(verts, n, 0, a); }
  }
}
let LSHOFF = false, LPOW = 1; // dev: turn the lantern shadows off, scale the lantern (0 = out) to compare
const passLS = { colorAttachments: [], depthStencilAttachment: { view: tLShadow.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } };
function render() {
  // camera basis (right vector is horizontal)
  const cx = F[CX], cy = F[CY], cz = F[CZ], pitch = F[PIT], yaw = F[YAW];
  const cp = cos(pitch), fy = sin(pitch), rx = cos(yaw), rz = sin(yaw), fx = cp * rz, fz = -cp * rx;
  const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
  F[FX] = fx; F[FY] = fy; F[FZ] = fz; F[RX] = rx; F[RZ] = rz; F[UX] = ux; F[UY] = uy; F[UZ] = uz;
  const asp = W / H, sx = 1 / (TANH * asp), sy = 1 / TANH, m = UB;
  m[0] = rx * sx; m[4] = 0; m[8] = rz * sx; m[12] = -(rx * cx + rz * cz) * sx;
  m[1] = ux * sy; m[5] = uy * sy; m[9] = uz * sy; m[13] = -(ux * cx + uy * cy + uz * cz) * sy;
  m[2] = 0; m[6] = 0; m[10] = 0; m[14] = NEAR;
  m[3] = fx; m[7] = fy; m[11] = fz; m[15] = -(fx * cx + fy * cy + fz * cz);
  m[32] = cx; m[33] = cy; m[34] = cz; m[35] = F[TIME];
  m[36] = rx; m[37] = 0; m[38] = rz; m[39] = TANH * asp;
  m[40] = ux; m[41] = uy; m[42] = uz; m[43] = TANH;
  m[44] = fx; m[45] = fy; m[46] = fz; m[47] = NEAR;
  m[51] = LOOK.haze; m[56] = LOOK.bright; m[57] = F[DT]; m[58] = det; m[59] = F[FADE];
  eclipse(m); m[68] *= LOOK.moon; m[69] *= LOOK.moon; m[70] *= LOOK.moon;
  m[76] = LOOK.fill; m[77] = LOOK.blue; m[78] = LOOK.contrast; m[79] = F[LIFT] * F[LIFT] * (3 - 2 * F[LIFT]); // tn.w: the lantern lifted
  const t = F[TIME];
  // the breeze (same as gust() in shaders.js): in a strong gust the lantern gutters, dimming for a second or two
  const gs = t - (cx * 0.05 + cz * 0.02), gb = 0.5 + 0.5 * sin(gs * 0.37) * sin(gs * 0.23 + 1.3), gu = 0.35 + 0.65 * gb * gb;
  let gt = (gu - 0.82) / 0.18; gt = gt < 0 ? 0 : gt > 1 ? 1 : gt;
  // campfire light: low, warm, flickering
  m[60] = CAMP[0]; m[61] = CAMP[1] + 0.45; m[62] = CAMP[2];
  m[63] = 9 * (1 + 0.12 * sin(t * 9.3) + 0.08 * sin(t * 15.1 + 2) + 0.06 * sin(t * 3.7));
  // the lantern: held low on the right, swinging a little round its handle; its flame is the light.
  // Holding Space raises it high, above your head (F[LIFT] eases 0 .. 1): the flame is out of your eyes and the light
  // comes down from 2 m and more, so it reaches up the walls and lies on the ground ahead instead of skimming it
  const lu = F[LIFT] * F[LIFT] * (3 - 2 * F[LIFT]), lf = 0.8 - 0.25 * lu, lr = 0.4 - 0.1 * lu, ld = 0.37 - 0.67 * lu;
  // the swing: a damped pendulum, nudged by every step, with a little idle drift
  { const dt = F[DT]; F[SWV] += (-F[SWG] * 22 - F[SWV] * 2.2) * dt; F[SWG] += F[SWV] * dt; }
  const sw = (F[SWG] * 0.12 + sin(t * 1.1) * 0.02 + sin(t * 0.47 + 1) * 0.012) * (1 - 0.5 * lu), hx = rz, hz = -rx; // hx, hz: forward, level
  // held in the hand: follows the body, not the head bob, with its own small bounce at each step
  const hb = -abs(sin(F[STEP])) * 0.018 * F[AMP], bx = cx - F[BX], by = cy - F[BY] + hb, bz = cz - F[BZ];
  let lx = bx + fx * lf + rx * lr - ux * ld + hx * sw * 0.16, ly = by + fy * lf - uy * ld, lz = bz + fz * lf + rz * lr - uz * ld + hz * sw * 0.16;
  // standing on the tent floor by the flap until you pick it up (the opening)
  const lh = F[LHOLD] * F[LHOLD] * (3 - 2 * F[LHOLD]);
  if (lh < 1) { lx = WK_LANT[0] + (lx - WK_LANT[0]) * lh; ly = WK_LANT[1] + (ly - WK_LANT[1]) * lh; lz = WK_LANT[2] + (lz - WK_LANT[2]) * lh; }
  m[64] = lx; m[65] = ly + 0.01; m[66] = lz;
  m[67] = LANTP * LPOW * (1 + 0.05 * sin(t * 17) + 0.04 * sin(t * 23 + 1) + 0.03 * sin(t * 7.3)) * (1 - 0.55 * gt * gt * (3 - 2 * gt));
  const swl = sw * lh, yl = yaw * lh, ss2 = sin(swl / 2), cs2 = cos(swl / 2), qy = sin(-yl / 2), qw = cos(-yl / 2), qx = rx * ss2, qz = rz * ss2;
  LANT[0] = lx; LANT[1] = ly; LANT[2] = lz; LANT[4] = qx * qw - qz * qy; LANT[5] = cs2 * qy; LANT[6] = qx * qy + qz * qw; LANT[7] = cs2 * qw;
  Q.writeBuffer(ibLant, 0, LANT);
  // the reflector's aim: your facing, turned a little with the swing. Carried low it hangs from the bail and only half
  // follows your gaze up or down (tipped a little toward the ground); raised, you turn it to what you look at
  { const gp = Math.asin(clamp(fy, -1, 1)), tip = clamp((0.13 - 0.5 * gp) * (1 - lu) + (0.12 - gp) * lu, -1.2, 1.2), ay = yaw + swl * 0.7, ch = cos(tip), dx = sin(ay) * ch, dy = -sin(tip), dz = -cos(ay) * ch;
    m[96] = dx; m[97] = dy; m[98] = dz; m[99] = LSH && !LSHOFF && lh > 0.5 ? 1 : 0;
    if (LSH) { // perspective from the flame along the aim, 120 degrees wide, 0.15 .. 14 m, standard depth 0..1
      const rxl = cos(ay), rzl = sin(ay); // right (level); up = right x forward
      const ux2 = -rzl * dy, uy2 = rzl * dx - rxl * dz, uz2 = rxl * dy, ul = hypot(ux2, uy2, uz2) || 1;
      const Ux = ux2 / ul, Uy = uy2 / ul, Uz = uz2 / ul, f = 1 / Math.tan(PI / 3), n = 0.15, fr = 60, A = fr / (fr - n), B = -fr * n / (fr - n), L = UBL;
      const tx = -(rxl * lx + rzl * lz), ty = -(Ux * lx + Uy * ly + Uz * lz), tz = -(dx * lx + dy * ly + dz * lz);
      L[0] = rxl * f; L[4] = 0; L[8] = rzl * f; L[12] = tx * f;
      L[1] = Ux * f; L[5] = Uy * f; L[9] = Uz * f; L[13] = ty * f;
      L[2] = dx * A; L[6] = dy * A; L[10] = dz * A; L[14] = tz * A + B;
      L[3] = dx; L[7] = dy; L[11] = dz; L[15] = tz;
      for (let i = 0; i < 16; i++) m[80 + i] = L[i];
      L[32] = lx; L[33] = ly; L[34] = lz; L[35] = t; L[58] = 1; L[52] = 0;
      Q.writeBuffer(uboL, 0, UBL);
    }
  }
  satellite(F[PLAY], SATB); Q.writeBuffer(ibStars, (nStars - 1) * 32, SATB);
  Q.writeBuffer(ubo, 0, UB);

  { let cr = floor((cz - OZ) / CELLW) | 0; cr = cr < 0 ? 0 : cr > CELLS - 1 ? CELLS - 1 : cr; let n = 0; rowOrd[n++] = cr; for (let d = 1; d < CELLS; d++) { if (cr - d >= 0) rowOrd[n++] = cr - d; if (cr + d < CELLS) rowOrd[n++] = cr + d; } }
  const e = device.createCommandEncoder();
  let slot = null;
  if (hasTS) { for (let i = 0; i < qRead.length; i++) if (!qRead[i].busy) { slot = qRead[i]; break; } }
  passPost.timestampWrites = slot ? tsEnd : undefined;
  // the lantern's shadow map: everything within reach of its light, seen from the flame
  const lsOn = LSH && UB[99] > 0.5;
  passScene.timestampWrites = slot && !lsOn ? tsBegin : undefined;
  if (lsOn) {
    passLS.timestampWrites = slot ? tsBegin : undefined;
    const r = e.beginRenderPass(passLS), lx = UB[64], lz = UB[66];
    r.setBindGroup(0, bg0l);
    r.setPipeline(pTerrSh); r.setVertexBuffer(0, vbTerrain); r.setVertexBuffer(1, ibSolids); r.setIndexBuffer(ibTerrain, 'uint32');
    drawNear(r, T.start, 1, 0, lx, lz, 60);
    r.setPipeline(pSolidSh); r.setVertexBuffer(0, vbMesh); r.setIndexBuffer(ibMesh, 'uint32');
    // the lantern's shadows reach the ruins only from near them; it draws the same stones the view does (a coarser
    // stand-in would shadow the real one)
    const lrd = hypot(lx - RUINC[0], lz - RUINC[1]) - 40;
    for (let i = 0; i < SOLN; i++) { if (i === 11 || i === 13) continue; const g = Wd.solids.ranges[i]; if (g[1] && solidOn(i) && !ruinSkip(i, lrd + 95)) { const M = solidMesh(i); r.drawIndexed(M.ib.length, g[1], M.i0, M.v0, g[0]); } }
    for (let i = 0; i < NCHUNK; i++) { r.setVertexBuffer(1, ibChunk[i]); drawNear(r, Wd.chunks[i].start, meshes[14 + i], 0, lx, lz, 40); }
    for (let i = 0; i < 6; i++) { r.setVertexBuffer(1, ibProp[i]); drawNear(r, Wd.props[i].start, meshes[4 + i], 0, lx, lz, 40); }
    r.setPipeline(pLeafSh); r.setVertexBuffer(0, ibBig); drawNear(r, Wd.big.start, 0, 6, lx, lz, 20);
    r.setVertexBuffer(0, ibSmall); drawNear(r, Wd.small.start, 0, 6, lx, lz, 10);
    r.end();
  }
  // scene
  let r = e.beginRenderPass(passScene);
  r.setBindGroup(0, bg0);
  r.setPipeline(pTerrain); r.setVertexBuffer(0, vbTerrain); r.setVertexBuffer(1, ibSolids); r.setIndexBuffer(ibTerrain, 'uint32');
  drawCells(r, T.start, T.lo, T.hi, 1.5, 1, 0, 0, 240);
  r.setPipeline(pSolid); r.setVertexBuffer(0, vbMesh); r.setIndexBuffer(ibMesh, 'uint32');
  ruinD = hypot(F[CX] - RUINC[0], F[CZ] - RUINC[1]);
  for (let i = 0; i < SOLN; i++) { const g = Wd.solids.ranges[i]; if (g[1] && solidOn(i) && !ruinSkip(i, ruinD)) { const M = solidMesh(i); r.drawIndexed(M.ib.length, g[1], M.i0, M.v0, g[0]); } }
  r.setVertexBuffer(1, ibLant); r.drawIndexed(LANTM.ib.length, 1, LANTM.i0, LANTM.v0, 0);
  if (F[LHOLD] > 0.5 && !FLYCAM) r.drawIndexed(HANDM.ib.length, 1, HANDM.i0, HANDM.v0, 0);
  for (let i = 0; i < NCHUNK; i++) {
    const c = Wd.chunks[i], big = i > 2 && i < 6; r.setVertexBuffer(1, ibChunk[i]);
    drawCells(r, c.start, c.lo, c.hi, 3, meshes[14 + i], 0, 0, i > 5 ? 30 : big ? 40 : 96);
    if (big) drawCells(r, c.start, c.lo, c.hi, 3, meshes[20 + i], 0, 40, 150);
  }
  // cacti, then the tree trunks (seen from further away)
  for (let i = 0; i < 6; i++) { r.setVertexBuffer(1, ibProp[i]); drawCells(r, Wd.props[i].start, Wd.props[i].lo, Wd.props[i].hi, 3, meshes[4 + i], 0, 0, i > 3 ? 160 : 110); }
  // plants: 9-row blades up close, 5 rows mid-range, a decimated set far away
  r.setPipeline(pLeaf); r.setVertexBuffer(0, ibBig); drawCells(r, Wd.big.start, Wd.big.lo, Wd.big.hi, 5, false, 18, 0, 24);
  r.setPipeline(pLeaf5); drawCells(r, Wd.big.start, Wd.big.lo, Wd.big.hi, 5, false, 10, 24, 58);
  r.setPipeline(pLeafF); r.setVertexBuffer(0, ibBigF); drawCells(r, Wd.bigF.start, Wd.bigF.lo, Wd.bigF.hi, 5, false, 6, 58, 150);
  r.setPipeline(pLeafS); r.setVertexBuffer(0, ibSmall); drawCells(r, Wd.small.start, Wd.small.lo, Wd.small.hi, 1.5, false, 6, 0, 70);
  r.setPipeline(pSky); r.draw(4);
  r.setPipeline(pStars); r.setVertexBuffer(0, ibStars); r.draw(4, nStars);
  r.setPipeline(pFire); r.setVertexBuffer(0, ibFireB); r.draw(4, nFire);
  r.end();
  // bloom
  for (let i = 0; i < bloomPass.length; i++) {
    r = e.beginRenderPass(bloomPass[i]); r.setPipeline(i === 0 ? pDown0 : i < NB ? pDown : pUp); r.setBindGroup(0, bloomBG[i]); r.draw(3); r.end();
  }
  // the eye adjusting, then the composite
  r = e.beginRenderPass(passAdapt); r.setPipeline(pAdapt); r.setBindGroup(0, bgAdapt); r.draw(3); r.end();
  passPost.colorAttachments[0].view = ctx.getCurrentTexture().createView();
  r = e.beginRenderPass(passPost); r.setPipeline(pPost); r.setBindGroup(0, bgPost); r.draw(3); r.end();
  e.copyTextureToTexture({ texture: tAd }, { texture: tAdP }, [1, 1]);
  if (slot) { e.resolveQuerySet(qs, 0, 2, qResolve, 0); e.copyBufferToBuffer(qResolve, 0, slot.b, 0, 16); }
  submitList[0] = e.finish();
  Q.submit(submitList);
  if (slot) { slot.busy = true; slot.b.mapAsync(GPUMapMode.READ).then(slot.done); }
}

// CS[j] = distance to the rock (metres, < 0 in water) at the camera + CE[3j..3j+2]: the camera, then ±0.375 m on
// each axis for the gradient
const CE = new Float64Array([0, 0, 0, .375, 0, 0, -.375, 0, 0, 0, .375, 0, 0, -.375, 0, 0, 0, .375, 0, 0, -.375]), CS = new Float64Array(7);
const cv = (x, y, z) => { const b = CI[(x >> 2) + CN * ((y >> 2) + NY / 4 * (z >> 2))]; return b > 1 ? CG[b * 64 - 128 + (x & 3) + 4 * (y & 3) + 16 * (z & 3)] : b * 254 - 127; };
function sd(j) {
  const x = (F[CX] + CE[j * 3] - OX) / VS - CO, y = (F[CY] + CE[j * 3 + 1] - OY) / VS, z = (F[CZ] + CE[j * 3 + 2] - OZ) / VS - CO;
  const ix = x | 0, iy = y | 0, iz = z | 0, u = x - ix, v = y - iy, a = cv(ix, iy, iz), b = cv(ix, iy + 1, iz), c = cv(ix, iy, iz + 1), d = cv(ix, iy + 1, iz + 1);
  const p = a + (cv(ix + 1, iy, iz) - a) * u, q = b + (cv(ix + 1, iy + 1, iz) - b) * u, r = c + (cv(ix + 1, iy, iz + 1) - c) * u, s = d + (cv(ix + 1, iy + 1, iz + 1) - d) * u;
  const e = p + (q - p) * v; CS[j] = (e + (r + (s - r) * v - e) * (z - iz)) / 127;
}
// distance to the rock at a point (metres, clamped to +-1); 1 (far) outside the brick grid
function sdP(X, Y, Z) {
  const x = (X - OX) / VS - CO, y = (Y - OY) / VS, z = (Z - OZ) / VS - CO;
  if (x < 1 || z < 1 || y < 1 || x > CN * 4 - 2 || z > CN * 4 - 2 || y > NY - 2) return 1;
  const ix = x | 0, iy = y | 0, iz = z | 0, u = x - ix, v = y - iy, a = cv(ix, iy, iz), b = cv(ix, iy + 1, iz), c = cv(ix, iy, iz + 1), d = cv(ix, iy + 1, iz + 1);
  const p = a + (cv(ix + 1, iy, iz) - a) * u, q = b + (cv(ix + 1, iy + 1, iz) - b) * u, r = c + (cv(ix + 1, iy, iz + 1) - c) * u, s2 = d + (cv(ix + 1, iy + 1, iz + 1) - d) * u;
  const e = p + (q - p) * v; return (e + (r + (s2 - r) * v - e) * (z - iz)) / 127;
}
// ---------------------------------------------------------------- walking
// P.T.-like: a slow, weighty walk (1.2 m/s), the eye at 1.65 m bobbing and swaying with the steps. No running,
// jumping or crouching. Steep ground (over ~38 degrees) and everything solid stop you.
const EYE = 1.65, WALK = 1.2, RUN = 2.6, PR = 0.3; // hold Shift to run: RUN times the walking speed
// push the feet position (F[WX], F[WZ]) out of everything solid
function unblock(fy) {
  for (let it = 0; it < 3; it++) {
    let x = F[WX], z = F[WZ];
    // rock faces: at knee, waist and head height. sdP is positive inside rock, so the distance to the rock is -sdP and
    // its gradient points away from it. Only wall-like rock pushes (mostly sideways gradient): the ground under your
    // feet is the height map's job, not this.
    for (const h of [0.5, 1.0, 1.6]) {
      const y = fy + h, d = -sdP(x, y, z);
      if (d < PR + 0.05) {
        const gx = sdP(x - 0.3, y, z) - sdP(x + 0.3, y, z), gz = sdP(x, y, z - 0.3) - sdP(x, y, z + 0.3), gy = sdP(x, y - 0.3, z) - sdP(x, y + 0.3, z);
        const l = hypot(gx, gz);
        if (l > 1e-4 && l > 0.6 * abs(gy)) { const p = min(PR + 0.05 - d, 0.15); x += gx / l * p; z += gz / l * p; }
      }
    }
    // rocks, cacti, trunks
    const c0 = ((x + 192) / 4) | 0, c1 = ((z + 192) / 4) | 0;
    for (let j = c1 - 1; j <= c1 + 1; j++) for (let i = c0 - 1; i <= c0 + 1; i++) {
      if (i < 0 || j < 0 || i >= OBC || j >= OBC) continue;
      const L = obCell[i + OBC * j];
      for (let k = 0; k < L.length; k += 3) { const dx = x - L[k], dz = z - L[k + 1], r = L[k + 2] + PR, d = hypot(dx, dz); if (d < r && d > 1e-4) { x += dx / d * (r - d); z += dz / d * (r - d); } }
    }
    // camp things
    const qx = x - CAMP[0], qz = z - CAMP[2];
    if (qx * qx + qz * qz < 400) {
      for (const [cx, cz, hx, hz, yw] of CBOX) { boxPush(qx, qz, cx, cz, hx, hz, yw); x += BPX; z += BPZ; }
      for (const [cx, cz, r0] of CCIR) { const dx = x - CAMP[0] - cx, dz = z - CAMP[2] - cz, r = r0 + PR, d = hypot(dx, dz); if (d < r && d > 1e-4) { x += dx / d * (r - d); z += dz / d * (r - d); } }
    }
    // the ruins: their walls, chimneys and stoves, and the tables once they are there
    if (abs(x - RUINC[0]) < 32 && abs(z - RUINC[1]) < 32) for (const b of Wd.rbox) if (b[5] <= RSTAGE) { boxPush(x, z, b[0], b[1], b[2], b[3], b[4]); x += BPX; z += BPZ; }
    F[WX] = x; F[WZ] = z;
  }
}
function walk(dt, yaw, move) {
  const mf = move ? kf - kb : 0, mr = move ? kr - kl : 0, fx = sin(yaw), fz = -cos(yaw), rx = cos(yaw), rz = sin(yaw);
  let dx = fx * mf + rx * mr, dz = fz * mf + rz * mr; const dl = hypot(dx, dz);
  const sp = dl ? WALK * (ks && mf > 0 ? RUN : 1) * (mf < 0 ? 0.75 : 1) * (mr && !mf ? 0.85 : 1) / dl : 0; dx *= sp; dz *= sp;
  // weighty: about half a second to get going, a little less to stop
  const k = 1 - exp(-dt * (dl ? 2.6 : 3.8));
  F[VX] += (dx - F[VX]) * k; F[VZ] += (dz - F[VZ]) * k;
  const px = F[PX], pz = F[PZ], g0 = groundAt(px, pz);
  let nx = px + F[VX] * dt, nz = pz + F[VZ] * dt;
  // too steep to climb: try each axis alone (slide along the slope), else stop
  const steep = (x, z) => groundAt(x, z) - g0 > 0.78 * hypot(x - px, z - pz) + 0.015;
  if (steep(nx, nz)) { if (!steep(nx, pz)) { nz = pz; F[VZ] *= 0.5; } else if (!steep(px, nz)) { nx = px; F[VX] *= 0.5; } else { nx = px; nz = pz; F[VX] = F[VZ] = 0; } }
  F[WX] = nx; F[WZ] = nz; unblock(F[PY]);
  if (steep(F[WX], F[WZ])) { F[WX] = px; F[WZ] = pz; }
  const mx = F[WX] - px, mz = F[WZ] - pz; F[PX] = F[WX]; F[PZ] = F[WZ];
  // feet follow the ground smoothly (no snapping on bumps)
  F[PY] += (groundAt(F[PX], F[PZ]) - F[PY]) * (1 - exp(-dt * 12));
  // steps: the bob and sway follow the distance walked (one step every 0.72 m)
  const v = hypot(mx, mz) / max(dt, 1e-4); F[AMP] += (min(v / WALK, 1.6) - F[AMP]) * (1 - exp(-dt * 5));
  const s0 = F[STEP]; F[STEP] += hypot(mx, mz) / 0.72 * PI;
  if (floor(F[STEP] / PI) !== floor(s0 / PI)) {
    const rock = sandAt(F[PX], F[PZ]) < 0.5 || abs(groundAt(F[PX] + 0.5, F[PZ]) - groundAt(F[PX] - 0.5, F[PZ])) > 0.25;
    SFX.step?.(rock, F[AMP]);
    F[SWV] += (floor(F[STEP] / PI) & 1 ? 0.5 : -0.5) * F[AMP]; // each step nudges the lantern
  }
  const a = F[AMP], st = F[STEP], vb = (abs(sin(st)) - 0.64) * 0.034 * a, lat = sin(st) * 0.022 * a;
  F[BX] = rx * lat; F[BY] = vb; F[BZ] = rz * lat;
  F[CX] = F[PX] + F[BX]; F[CY] = F[PY] + EYE + vb; F[CZ] = F[PZ] + F[BZ];
}
// put the walker at x, z facing yaw
const placeAt = (x, z, yaw, pitch = 0) => { F[PX] = F[WX] = x; F[PZ] = F[WZ] = z; F[PY] = groundAt(x, z); F[VX] = F[VZ] = 0; F[YAW] = yaw; F[PIT] = pitch; F[CX] = x; F[CY] = F[PY] + EYE; F[CZ] = z; };

// ---------------------------------------------------------------- the opening: waking up in the tent
// Lying in the sleeping bag, looking up at the canvas; sit up, stand, look down at the lantern by the door flap and
// pick it up. Meanwhile the radio outside clicks on, something at camp clatters over, and the crickets go quiet.
// Times in seconds after Begin; positions in the world (tent: camp x 1, z 7.5, door toward the fire).
const WK = [ // t, eye x, y above the camp floor, z, yaw, pitch
  [0, 1.95, 0.22, 10.68, 0, 0.62], [3.5, 1.95, 0.24, 10.66, 0.05, 0.5], [6.0, 1.85, 0.9, 10.25, -0.1, -0.4],
  [8.0, 1.3, 1.65, 9.4, -0.05, -0.15], [9.0, 1.3, 1.6, 9.35, 0, -0.85], [10.2, 1.3, 1.65, 9.35, 0, -0.05]];
const WK_LANT = [1.3, CAMP[1] + 0.17, 8.05], WKEND = 10.2;
let wakeEv = 0;
function wake(dt) {
  const t = F[WAKE] += dt;
  F[FADE] = clamp(t / 2.5, 0, 1); F[FADE] *= F[FADE];
  let i = 0; while (i < WK.length - 2 && t > WK[i + 1][0]) i++;
  const a = WK[i], b = WK[i + 1], u = clamp((t - a[0]) / (b[0] - a[0]), 0, 1), e = u * u * (3 - 2 * u), m = (j) => a[j] + (b[j] - a[j]) * e;
  const br = t < 4 ? sin(t * 1.3) * 0.012 : 0; // breathing while lying
  F[CX] = CAMP[0] + m(1); F[CY] = CAMP[1] + m(2) + br; F[CZ] = CAMP[2] + m(3) - 2;
  // the mouse may look around a little once sitting up
  F[YAW] = m(4) + F[WX] * 0; F[PIT] = m(5);
  F[LHOLD] = clamp((t - 9.0) / 1.0, 0, 1);
  if (wakeEv < 1 && t > 5.0) { wakeEv = 1; SFX.radioOn?.(); }
  F[SKIP] = kLift ? F[SKIP] + dt : 0;
  if (F[SKIP] > 0.5) { const e = WK[WK.length - 1]; F[CX] = CAMP[0] + e[1]; F[CY] = CAMP[1] + e[2]; F[CZ] = CAMP[2] + e[3] - 2; F[YAW] = e[4]; F[PIT] = e[5]; if (wakeEv < 1) { wakeEv = 1; SFX.radioOn?.(); } F[WAKE] = WKEND; }
  if (F[WAKE] >= WKEND) { F[WAKE] = 1e9; placeAt(F[CX], F[CZ], F[YAW], F[PIT]); F[FADE] = 1; F[LHOLD] = 1; }
}
// the later wake events run on the play clock (after you have control): the clatter, then the crickets stop
function wakeLater() {
  const t = F[PLAY];
  if (wakeEv < 2 && t > 11.5) { wakeEv = 2; SFX.clatter?.(); }
  if (wakeEv < 3 && t > 14.5) { wakeEv = 3; SFX.cricketsStop?.(); }
}

// Moves the camera by F[MX..MZ] in steps shorter than its radius CR (so it can't pass through thin rock), pushing it
// back out after each step and dropping velocity into the rock, so it slides along.
const CR = 0.5;
function collide() {
  const n = floor(sqrt(F[MX] * F[MX] + F[MY] * F[MY] + F[MZ] * F[MZ]) / 0.4) + 1;
  for (let i = 0; i < n; i++) {
    F[CX] += F[MX] / n; F[CY] += F[MY] / n; F[CZ] += F[MZ] / n;
    for (let k = 0; k < 2; k++) {
      sd(0); const s = CS[0] + CR; if (s <= 0) break;
      for (let j = 1; j < 7; j++) sd(j);
      let gx = CS[1] - CS[2], gy = CS[3] - CS[4], gz = CS[5] - CS[6]; const l = sqrt(gx * gx + gy * gy + gz * gz);
      if (l < 0.075) break; // flat: deep in rock
      gx /= l; gy /= l; gz /= l; const vn = F[VX] * gx + F[VY] * gy + F[VZ] * gz;
      F[CX] -= gx * s; F[CY] -= gy * s; F[CZ] -= gz * s;
      if (vn > 0) { F[VX] -= gx * vn; F[VY] -= gy * vn; F[VZ] -= gz * vn; }
    }
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dtr = now - F[LAST]; F[LAST] = now;
  let dt = dtr / 1000; if (dt > 0.1) dt = 0.1;
  // Dynamic resolution for 60 fps: every second (0.4 s behind the menu) scale the load by k
  if (dtr < 1e3 && (dynT += dtr) > 0 && (dynN++, dynT > (menu ? 400 : 1000))) {
    const a = dynT / dynN, g = dynGN ? dynG / dynGN : 0; let k = 1;
    // with GPU timing: keep it between 9.8 and 13.6 ms
    if (g) { if (g > 13.6 || g < 9.8) k = 11.7 / g; }
    // without: slow for two periods in a row means fewer pixels, and twice as long before trying to go back up
    else if (a > 17.6) { dynOk = 0; if (++dynBad > 1) { k = 15 / a; dynBad = 0; dynWait = min(dynWait * 2, 60); } }
    // at the display's rate there is no telling if there is room, so try a little more now and then
    else { dynBad = 0; if (a < 12.5) k = 15 / a; else if (++dynOk > dynWait) { k = 1.17; dynOk = 0; } }
    k = k < 0.5 ? 0.5 : k > 1.7 ? 1.7 : k; const top = min(PIXMAX, DW * DH), mid = max(top / 2, PIXMIN), was = pix + det;
    // too slow: pixels down to `mid` first, then draw distance, then the remaining pixels; faster goes back the same way
    if (k < 1 ? pix > mid || det <= DETMIN : pix < mid || det >= 1) {
      const end = k < 1 ? (det > DETMIN ? mid : PIXMIN) : det < 1 ? mid : top;
      pix *= k; if (k < 1 ? pix < end : pix > end) pix = end;
    } else { det *= sqrt(k); det = det < DETMIN ? DETMIN : det > 1 ? 1 : det; }
    if (was !== pix + det) keep('abyssal', [LV, pix < top ? pix | 0 : '', det]); // nothing kept at full resolution
    dynN = dynT = dynG = dynGN = 0; resize();
  }
  F[TIME] += dt; F[DT] = dt;
  if (!menu) { F[ECT] += dt * ECLX / 60; F[PLAY] += dt; wakeLater(); }
  // focus zoom: hold the right mouse button to ease in to about 2x, release to ease back out
  F[ZOOM] += ((kZoom && !menu ? 1 : 0) - F[ZOOM]) * (1 - exp(-dt * 2.8)); TANH = TANH0 / (1 + F[ZOOM] * F[ZOOM] * (3 - 2 * F[ZOOM]));
  F[LIFT] = clamp(F[LIFT] + (kLift ? dt : -dt) / 0.45, 0, 1);
  {
    // touch: holding the finger away from where it went down keeps turning, like a joystick
    if (tId >= 0) {
      const tr = 4 / (innerWidth < innerHeight ? innerWidth : innerHeight); let jx = (tx - tx0) * tr, jy = (ty - ty0) * tr;
      jx = jx > 1 ? 1 : jx < -1 ? -1 : jx; jy = jy > 1 ? 1 : jy < -1 ? -1 : jy;
      lkx += jx * 1.5 * dt; lky += jy * dt;
    }
    // mouse look through two cascaded low-pass stages: walking, it is slower and lags a little (heavy head)
    const kq = 1 - exp(-dt * (FLYCAM ? 30 : 11)), ms = (FLYCAM ? 0.0022 : 0.0015) * TANH / TANH0; lkx += mdx * ms; lky += mdy * ms; mdx = 0; mdy = 0;
    const ax = lkx * kq, ay = lky * kq; lkx -= ax; lky -= ay; l2x += ax; l2y += ay;
    const dyw = l2x * kq, dpt = l2y * kq; l2x -= dyw; l2y -= dpt;
    const yaw = F[YAW] + dyw, pl = FLYCAM ? 1.55 : 1.3; let pitch = F[PIT] - dpt; pitch = pitch < -pl ? -pl : pitch > pl ? pl : pitch;
    if (!FLYCAM) {
      if (F[WAKE] >= 0 && F[WAKE] < WKEND) { if (!menu) wake(dt); }
      else { F[YAW] = yaw; F[PIT] = pitch; walk(dt, yaw, !menu); }
    } else {
    const sp = ks || tN > 1 ? 12 : 3.5, k = 1 - exp(-dt * 4.5), mf = tId >= 0 ? 0.7 : kf - kb, mr = kr - kl, mu = ku - kd, cp = cos(pitch), sy = sin(yaw), cw = cos(yaw);
    const vx = F[VX] + ((sy * cp * mf + cw * mr) * sp - F[VX]) * k, vy = F[VY] + ((sin(pitch) * mf + mu) * sp - F[VY]) * k, vz = F[VZ] + ((-cw * cp * mf + sy * mr) * sp - F[VZ]) * k;
    const x = F[CX] + vx * dt, y = F[CY] + vy * dt, z = F[CZ] + vz * dt;
    F[YAW] = yaw; F[PIT] = pitch; F[VX] = vx; F[VY] = vy; F[VZ] = vz; F[MX] = x - F[CX]; F[MY] = y - F[CY]; F[MZ] = z - F[CZ];
    collide();
    }
  }
  if (!FLYCAM && !menu && F[WAKE] >= WKEND) SFX.listen?.(F[CX], F[CY], F[CZ], F[YAW]);
  render();
  if (hud) {
    hN++; if (dtr > hMax) hMax = dtr; if (dtr < hMin) hMin = dtr; if (dtr > hPer * 1.5) { hLate++; hTot++; }
    F[HUDT] += dtr / 1000;
    if (F[HUDT] > 0.5) { info.textContent = `${(hN / F[HUDT]).toFixed(0)} fps  ·  worst frame ${hMax.toFixed(1)} ms  ·  late frames ${hLate} (total ${hTot})  ·  GPU ${F[GPU].toFixed(2)} ms  ·  ${W}x${H} (${W * 100 / DW | 0}%)`; F[HUDT] = 0; hPer = hMin; hN = 0; hMax = 0; hMin = 1e9; hLate = 0; }
  }
}

// ---------------------------------------------------------------- input
const key = (e, v) => {
  switch (e.code) {
    case 'KeyW': kf = v; break; case 'KeyS': kb = v; break; case 'KeyA': kl = v; break; case 'KeyD': kr = v; break;
    case 'KeyE': ku = v; break; case 'KeyQ': kd = v; break; case 'ShiftLeft': case 'ShiftRight': ks = v; break; case 'Space': kLift = v; break;
    default: if (v && !e.repeat) {
      if (e.code === 'KeyH' && DEV) { hud = !hud; hTot = 0; hPer = 1e9; info.textContent = ''; }
      else if (e.code === 'KeyM') mute();
      else if (e.code === 'Escape') ui(true);
      // dev build: 1-6 jump to the viewpoints (walking there, or as the free camera), G toggles the free camera
      else if (DEV && e.code >= 'Digit1' && e.code <= 'Digit6') { const p = POSES[e.code.charCodeAt(5) - 49]; if (FLYCAM) lookAt(...p); else { F[WAKE] = 1e9; F[FADE] = 1; F[LHOLD] = 1; placeAt(p[0], p[2], atan2(p[3] - p[0], -(p[5] - p[2]))); } }
      else if (DEV && e.code === 'KeyG') { FLYCAM = !FLYCAM; if (!FLYCAM) { F[WAKE] = 1e9; F[FADE] = 1; F[LHOLD] = 1; placeAt(F[CX], F[CZ], F[YAW], F[PIT]); } else { F[VX] = F[VY] = F[VZ] = 0; } }
    }
  }
};
// behind the menu only the stats and mute keys work
addEventListener('keydown', (e) => { if (menu && e.code !== 'KeyH' && e.code !== 'KeyM') return; sound(); key(e, 1); });
addEventListener('keyup', (e) => key(e, 0));
const release = () => { kf = kb = kl = kr = ku = kd = ks = kLift = kZoom = 0; tId = -1; tN = 0; };
const capture = () => { sound(); const p = canvas.requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch(() => canvas.requestPointerLock()).catch(() => 0); };
canvas.addEventListener('click', capture);
canvas.addEventListener('mousedown', (e) => { if (e.button === 2) kZoom = 1; });
addEventListener('mouseup', (e) => { if (e.button === 2) kZoom = 0; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('mousemove', (e) => { if (document.pointerLockElement === canvas) { mdx += e.movementX; mdy += e.movementY; } });
addEventListener('blur', release);
const touch = (e) => {
  e.preventDefault(); sound(); tN = e.touches.length;
  let f = null, first = false; for (let i = 0; i < tN; i++) if (e.touches[i].identifier === tId) f = e.touches[i];
  if (!f) { tId = -1; if (tN) { f = e.touches[0]; tId = f.identifier; first = true; } }
  if (f) {
    // the touch axes turn with the page when it lies on its side
    const x = rot.matches ? f.clientY : f.clientX, y = rot.matches ? -f.clientX : f.clientY, s = 1100 / min(innerWidth, innerHeight);
    if (first) { tx0 = x; ty0 = y; } else { mdx += (x - tx) * s; mdy += (y - ty) * s; } // the view follows the finger at once
    tx = x; ty = y;
  }
};
for (const n of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) canvas.addEventListener(n, touch, { passive: false });

// ---------------------------------------------------------------- menu
// The scene keeps rendering (blurred by CSS) behind the menu. Esc, losing the mouse or the corner button open it.
let menu = true;
const bDive = $('d');
const ui = (m) => {
  if (dead) return;
  menu = m; body.className = m ? 'm' : document.pointerLockElement ? 'g p' : 'g';
  // focus the dive button so Enter works (delayed: it can't take focus while still hidden)
  if (m) { release(); setTimeout(() => menu && bDive.focus(), 100); } else document.activeElement.blur();
};
const go = () => {
  sound(); ui(false); bDive.textContent = 'Resume';
  if (F[WAKE] < 0 && !FLYCAM) { F[WAKE] = 0; F[FADE] = 0; F[LHOLD] = 0; F[PLAY] = 0; }
  // phones: go fullscreen and ask for landscape; where that is refused the CSS rotation still applies
  if (mob) document.documentElement.requestFullscreen?.()?.then(() => screen.orientation.lock('landscape')).catch(() => 0);
  if (!mob) capture();
};
bDive.onclick = go; $('o').onclick = () => ui(true);
// detail buttons: the current level is lit, the others reload the page with theirs
$('q').querySelectorAll('button').forEach((b, i) => { if (i === 2 - LV) b.className = 'on'; else b.onclick = () => { keep('abyssal', 2 - i); location.reload(); }; });
// keepPlay (dev tools): the mouse is free for a panel, but the game keeps running behind it
let keepPlay = false;
document.addEventListener('pointerlockchange', () => ui(!document.pointerLockElement && !keepPlay));

// draw the first frame and wait for the GPU to finish it (pipelines get compiled on first use) before the reveal
lookAt(...POSES[0]); placeAt(CAMP[0] + 1.3, CAMP[2] + 7.35, 0); F[CX] = CAMP[0] + WK[0][1]; F[CY] = CAMP[1] + WK[0][2]; F[CZ] = CAMP[2] + WK[0][3] - 2; F[YAW] = WK[0][4]; F[PIT] = WK[0][5];
await say('Letting the light in…', 1, 400);
render(); await Q.onSubmittedWorkDone();
setTimeout(keep, 15e3, 'abyssalLoad', ''); // the load counts as survived after 15 s of frames
ui(true);
requestAnimationFrame((t) => { F[LAST] = t; requestAnimationFrame(frame); });
