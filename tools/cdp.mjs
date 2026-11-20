// usage: node cdp.mjs "<js expression>"  -> evaluates in the game tab (awaits promises), prints result
const expr = process.argv[2];
const tabs = await (await fetch('http://127.0.0.1:9333/json')).json();
let t = tabs.find((x) => x.type === 'page' && x.url.includes('8791'));
if (!t) t = tabs.find((x) => x.type === 'page');
const ws = new WebSocket(t.webSocketDebuggerUrl); let id = 0; const pend = {};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend[i] = res; ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend[m.id]) pend[m.id](m); };
await new Promise((r) => (ws.onopen = r));
const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
console.log(JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails ?? r, null, 1).slice(0, 4000));
ws.close();
