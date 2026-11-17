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
        FLYCAM = true; flying = true; bench = e.code === 'KeyB'; F[FLT] = 0; last = F[LAST]; nFrame = nGpu = 0;
        // a benchmark hides the stats line and holds the resolution: dynT at -Infinity keeps frame() from tuning it
        if (bench) { hud = false; info.textContent = ''; dynT = -Infinity; }
      }
    } else if (/Digit[1-6]/.test(e.code)) stop();
  });
  // T: the night-look sliders (LOOK in main.js), live; the line under them is the setting to copy
  { const p = document.createElement('div'); p.style.cssText = 'position:fixed;left:12px;top:12px;z-index:9;background:rgba(0,0,0,.72);color:#ddd;font:13px monospace;padding:10px 12px;border-radius:6px;display:none;line-height:1.9';
    const out = document.createElement('div');
    const rows = [['moon', 'Moonlight', 0, 1.5], ['fill', 'Shadow fill', 0, 2], ['blue', 'Blue', 0, 1], ['contrast', 'Contrast', 0, 1], ['bright', 'Brightness', 0.2, 1.6]];
    const show = () => { out.textContent = 'LOOK = ' + JSON.stringify(LOOK); };
    // keyboard, so the mouse keeps looking around: Up/Down picks a slider, Left/Right moves it (hold Shift for big steps)
    let sel = 0; const ui2 = [];
    const set = (i, x) => { const [k, , a, b] = rows[i]; LOOK[k] = Math.min(b, Math.max(a, Math.round(x * 100) / 100)); ui2[i].r.value = LOOK[k]; ui2[i].v.textContent = LOOK[k].toFixed(2); show(); };
    const mark = () => ui2.forEach((u, i) => { u.l.style.color = i === sel ? '#ffd27a' : '#ddd'; });
    rows.forEach(([k, name, a, b], i) => {
      const l = document.createElement('label'), r = document.createElement('input'), v = document.createElement('span');
      r.type = 'range'; r.min = a; r.max = b; r.step = 0.01; r.value = LOOK[k]; r.style.cssText = 'width:220px;vertical-align:middle;margin:0 8px';
      v.textContent = LOOK[k].toFixed(2); r.oninput = () => set(i, +r.value);
      l.append(name.padEnd(12, ' '), r, v); l.style.display = 'block'; l.style.whiteSpace = 'pre'; p.append(l); ui2.push({ l, r, v });
    });
    const help = document.createElement('div'); help.textContent = 'Mouse: drag sliders, click scene to look   Keys: Up/Down pick, Left/Right change   T: free mouse / hide'; help.style.color = '#999';
    // Copy: puts the LOOK line on the clipboard, and (through the local dev server, if it is running) saves it as
    // look.json next to the screenshots, so Claude can read it directly
    const copy = document.createElement('button'); copy.textContent = 'Copy settings';
    copy.style.cssText = 'margin-top:6px;font:13px monospace;padding:4px 10px;cursor:pointer';
    copy.onclick = async () => {
      const t = out.textContent; let ok = false;
      const sending = fetch('/save?name=look.json', { method: 'POST', body: JSON.stringify(LOOK) }).then((r) => r.ok, () => false);
      // the old way first (works without permissions), then the clipboard API with a time limit (it can hang unfocused)
      const ta = document.createElement('textarea'); ta.value = t; document.body.append(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; } ta.remove();
      if (!ok) ok = await Promise.race([navigator.clipboard.writeText(t).then(() => true, () => false), new Promise((r) => setTimeout(r, 1000, false))]);
      const sent = await sending;
      copy.textContent = (ok ? 'Copied' : 'Select the line above and copy it') + (sent ? ' + sent to Claude' : '');
      setTimeout(() => { copy.textContent = 'Copy settings'; }, 3000);
    };
    out.style.userSelect = 'text';
    p.append(out, copy, help); show(); mark(); document.body.append(p);
    for (const e of ['pointerdown', 'mousedown', 'click']) p.addEventListener(e, (ev) => ev.stopPropagation());
    addEventListener('keydown', (e) => {
      // T: show the panel and free the mouse (drag the sliders; click the scene to look around again, the panel stays);
      // T with the mouse already free hides the panel
      if (e.code === 'KeyT' && !e.repeat) {
        if (p.style.display === 'none' || document.pointerLockElement) { p.style.display = 'block'; keepPlay = true; document.exitPointerLock(); }
        else { p.style.display = 'none'; keepPlay = false; }
        return;
      }
      if (p.style.display === 'none') return;
      if (e.code === 'ArrowUp' || e.code === 'ArrowDown') { sel = (sel + (e.code === 'ArrowUp' ? rows.length - 1 : 1)) % rows.length; mark(); e.preventDefault(); }
      else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') { set(sel, LOOK[rows[sel][0]] + (e.code === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 0.1 : 0.02)); e.preventDefault(); }
    });
  }
  // for screenshots from the browser console: dev.view(x, y, z, lookX, lookY, lookZ) places the camera, dev.play() hides the menu
  DEV = true;
  // the camera functions switch to the free camera (G switches back to walking)
  window.dev = { view: (...a) => { FLYCAM = true; lookAt(...a); }, play: () => ui(false), pose: (i) => { FLYCAM = true; lookAt(...POSES[i]); },
    // dev.bench() starts the benchmark flight; dev.state() says how far it got (and the report once it is done)
    bench: () => { ui(false); FLYCAM = true; flying = bench = true; F[FLT] = 0; last = F[LAST]; nFrame = nGpu = 0; hud = false; info.textContent = ''; dynT = -Infinity; },
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
    flyTo: (t) => { FLYCAM = true; flying = false; F[FLT] = t; flyAt(); },
    // dev.walkTo(x, z, yaw): stand there, walking
    walkTo: (x, z, yaw = 0) => { FLYCAM = false; F[WAKE] = 1e9; F[FADE] = 1; F[LHOLD] = 1; placeAt(x, z, yaw); },
    // dev.wake(): play the opening again
    wake: () => { FLYCAM = false; F[WAKE] = 0; F[FADE] = 0; F[LHOLD] = 0; F[PLAY] = 0; wakeEv = 0; },
    // dev.clock(m): the eclipse clock, in game minutes after 3:35 a.m. (9 first bite, 90 totality, 111 deepest)
    clock: (m) => (F[ECT] = m),
    // dev.playTime(s): seconds of play (the satellite passes run on it: one pass, overhead at about 1670)
    playTime: (s) => (F[PLAY] = s),
    // dev.look({ bright: 2 }): change the night look from the console (same keys as the sliders)
    look: (o) => Object.assign(LOOK, o),
    state: () => ({ pos: [F[PX], F[PY], F[PZ]].map((v) => +v.toFixed(2)), cam: [F[CX], F[CY], F[CZ]].map((v) => +v.toFixed(2)), flycam: FLYCAM, flying, t: F[FLT], frames: nFrame, gpu: F[GPU], size: W + 'x' + H, report: info.textContent }) };
}
