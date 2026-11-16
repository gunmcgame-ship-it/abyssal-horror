// ============================================================================
// development tools: only in dev.html (npm run build:dev), never in index.html
// ============================================================================
//   F    fly the camera along the scripted path (FLY in main.js), one minute through the whole world
//   B    the same flight as a benchmark: the resolution stays fixed, every frame is timed, the result is shown at the end
//   F, B or 1-6 during a flight stop it
{
  const LOGN = 1 << 16, logFrame = new Float32Array(LOGN), logGpu = new Float32Array(LOGN);
  let flying = false, bench = false, last = 0, nFrame = 0, nGpu = 0;
  const stop = () => { flying = bench = false; dynT = 0; };
  const report = () => {
    const st = (a, n) => { const s = Array.from(a.subarray(0, n)).sort((x, y) => x - y); let sum = 0; for (const v of s) sum += v; return { n, avg: sum / n, p99: s[min(n - 1, floor(n * 0.99))], max: s[n - 1] }; };
    const fm = (o) => `avg ${o.avg.toFixed(2)}  p99 ${o.p99.toFixed(2)}  max ${o.max.toFixed(2)} ms`;
    const f = st(logFrame, nFrame);
    info.textContent = `Fly-through ${W}x${H}, ${f.n} frames\nframe  ${fm(f)}\nGPU    ${nGpu ? fm(st(logGpu, nGpu)) : 'timestamp-query unavailable'}`;
  };
  // frame() moves the free camera and then calls render(): step in between and put the camera on the path instead
  const draw = render;
  render = () => {
    if (flying) {
      const dtr = F[LAST] - last; last = F[LAST];
      F[FLT] += min(dtr / 1000, 0.1); flyAt();
      if (bench) { if (nFrame < LOGN) logFrame[nFrame++] = dtr; if (F[GPU] > 0 && nGpu < LOGN) logGpu[nGpu++] = F[GPU]; }
      if (F[FLT] >= FLYT) { if (bench) report(); stop(); }
    }
    draw();
  };
  addEventListener('keydown', (e) => {
    if (menu || e.repeat) return;
    if (e.code === 'KeyF' || e.code === 'KeyB') {
      if (flying) stop();
      else {
        flying = true; bench = e.code === 'KeyB'; F[FLT] = 0; last = F[LAST]; nFrame = nGpu = 0;
        // a benchmark hides the stats line and holds the resolution: dynT at -Infinity keeps frame() from tuning it
        if (bench) { hud = false; info.textContent = ''; dynT = -Infinity; }
      }
    } else if (/Digit[1-6]/.test(e.code)) stop();
  });
  // for screenshots from the browser console: dev.view(x, y, z, lookX, lookY, lookZ) places the camera, dev.play() hides the menu
  window.dev = { view: lookAt, play: () => ui(false), pose: (i) => lookAt(...POSES[i]),
    // dev.bench() starts the benchmark flight; dev.state() says how far it got (and the report once it is done)
    bench: () => { ui(false); flying = bench = true; F[FLT] = 0; last = F[LAST]; nFrame = nGpu = 0; hud = false; info.textContent = ''; dynT = -Infinity; },
    res: (p) => { pix = p; W = 0; resize(); return W + 'x' + H; }, // hold the render size at p pixels (a benchmark keeps it there)
    // dev.shot('name.png'): the next frame, read back at render size and sent to the local dev server (which saves it)
    shot: async (name) => {
      ctx.configure({ device, format: FMT, alphaMode: 'opaque', usage: TU.RENDER_ATTACHMENT | TU.COPY_SRC });
      draw(); const t = ctx.getCurrentTexture(), bpr = Math.ceil(W * 4 / 256) * 256, b = device.createBuffer({ size: bpr * H, usage: BU.MAP_READ | BU.COPY_DST });
      const e = device.createCommandEncoder(); e.copyTextureToBuffer({ texture: t }, { buffer: b, bytesPerRow: bpr }, [W, H]); Q.submit([e.finish()]);
      await b.mapAsync(GPUMapMode.READ); const src = new Uint8Array(b.getMappedRange()), cv = new OffscreenCanvas(W, H), c2 = cv.getContext('2d'), img = c2.createImageData(W, H), sw = FMT === 'bgra8unorm';
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * bpr + x * 4, o = (y * W + x) * 4; img.data[o] = src[i + (sw ? 2 : 0)]; img.data[o + 1] = src[i + 1]; img.data[o + 2] = src[i + (sw ? 0 : 2)]; img.data[o + 3] = 255; }
      b.unmap(); b.destroy(); c2.putImageData(img, 0, 0);
      return (await fetch('/save?name=' + name, { method: 'POST', body: await cv.convertToBlob({ type: name.endsWith('.jpg') ? 'image/jpeg' : 'image/png', quality: 0.92 }) })).text();
    },
    // put the benchmark camera at time t of the flight (for frames of the fly-through)
    flyTo: (t) => { flying = false; F[FLT] = t; flyAt(); },
    // dev.clock(m): the eclipse clock, in game minutes after 3:35 a.m. (9 first bite, 90 totality, 111 deepest)
    clock: (m) => (F[ECT] = m),
    state: () => ({ flying, t: F[FLT], frames: nFrame, gpu: F[GPU], size: W + 'x' + H, report: info.textContent }) };
}
