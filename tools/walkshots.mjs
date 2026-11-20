// node walkshots.mjs prefix : walking-mode shots (lantern in hand), clock frozen, owner's look
const P = process.argv[2] || 'w';
const shots = [
  ['tripod_low', -6.0, 1.7, 0, -0.28, 0], ['tripod_up', -6.0, 1.7, 0, -0.1, 1],
  ['wood_low', -2.5, 0.9, 0.5, -0.65, 0], ['truck_low', 8.4, -7.2, Math.PI, -0.2, 0],
];
const tabs = await (await fetch('http://127.0.0.1:9333/json')).json();
const t = tabs.find((x) => x.type === 'page' && x.url.includes('8791'));
const ws = new WebSocket(t.webSocketDebuggerUrl); let id = 0; const pend = {};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend[i] = res; ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend[m.id]) pend[m.id](m); };
await new Promise((r) => (ws.onopen = r));
const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? JSON.stringify(r.result?.exceptionDetails?.exception?.description); };
await ev(`dev.play(); dev.lanternAt(); dev.freeze(100); dev.look({moon:1.15,fill:0.73,blue:1,contrast:0.88,bright:0.42,haze:1.4}); 1`);
for (const [n, x, z, yaw, pit, lift] of shots) {
  console.log(n, await ev(`(async()=>{ dev.walkTo(${x}, ${z}, ${yaw}, ${pit}); const iv = setInterval(() => dev.lift(${lift}), 30); await new Promise(r=>setTimeout(r, 3500)); clearInterval(iv); return await dev.shot('${P}_${n}.png'); })()`));
}
ws.close();
