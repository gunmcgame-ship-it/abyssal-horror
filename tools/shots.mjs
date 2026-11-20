// node shots.mjs <list.json>: each entry [name, eyeX, eyeYrel, eyeZ, tX, tY, tZ, opts?]; eye y is above the ground, target y absolute
import fs from 'node:fs';
const list = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const tabs = await (await fetch('http://127.0.0.1:9333/json')).json();
const t = tabs.find((x) => x.type === 'page' && x.url.includes('8791'));
const ws = new WebSocket(t.webSocketDebuggerUrl); let id = 0; const pend = {};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend[i] = res; ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend[m.id]) pend[m.id](m); };
await new Promise((r) => (ws.onopen = r));
const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? JSON.stringify(r.result?.exceptionDetails?.exception?.description); };
const W = +(process.argv[3] || 2560), H = +(process.argv[4] || 1440);
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
console.log(await ev(`dev.play(); dev.res(${W * H}); new Promise(r=>setTimeout(r,1500)).then(()=>dev.state().size)`));
for (const [name, ex, ey, ez, tx, ty, tz, o = {}] of list) {
  const pre = o.js || '';
  const r = await ev(`(async()=>{ ${pre}; const iv = setInterval(() => { ${pre}; }, 50); const ge = dev.probe(${ex}, ${ez}).g, gt = dev.probe(${tx}, ${tz}).g; dev.view(${ex}, ge + ${ey}, ${ez}, ${tx}, gt + ${ty}, ${tz}); await new Promise(r=>setTimeout(r, ${o.wait || 2500})); clearInterval(iv); clearInterval(iv); return await dev.shot('${name}.png'); })()`);
  console.log(name, r);
}
ws.close();
