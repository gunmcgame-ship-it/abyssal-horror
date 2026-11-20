BACKUP COPY of C:\Users\Bacon\abyssal_tools (taken 2026-11-20, when the project was paused). The scripts expect to
run from that folder (reload.sh and the commands below use its absolute paths). If it's gone, copy this folder back
there. Not included: the Chrome profile folders (chrome, chrome_headless: browser data, made fresh on first launch)
and the renders (shots_*, tel_*, diff_*: about 1.3 GB).

Render + art-critic tooling for abyssal_horror ("Ground Observer, 1957")

1. Build:   cd C:\Users\Bacon\abyssal_horror\source && node build.mjs --dev      (writes ..\dev.html)
2. Server:  node server.mjs "C:/Users/Bacon/abyssal_horror" "C:/Users/Bacon/abyssal_tools/shots_latest"
            (port 8791; 8765 is taken by another app. Serves dev.html, POST /save?name=x.png writes into the shots dir)
3. Chrome:  "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9333
            --user-data-dir=C:\Users\Bacon\abyssal_tools\chrome --enable-unsafe-webgpu --disable-background-timer-throttling --disable-renderer-backgrounding
            --disable-backgrounding-occluded-windows --no-startup-window-focus --window-size=1600,950 http://127.0.0.1:8791/
            wait until `node cdp.mjs "typeof dev"` prints "object" (shader compile takes ~1 min); then `node cdp.mjs "dev.play(); 1"`
4. Shots:   node shots.mjs final.json            (17 critic shots at 2560x1440; reload.sh reloads the page after a rebuild)
            entry: [name, eyeX, eyeY(above ground), eyeZ, targetX, targetY(above ground), targetZ, {js, wait}]
            camp coords -> world: x same, z + 2. Ground at camp is y -45.

shots_v1\      round-1 renders (critic scored avg 3.65/10)
shots_latest\  renders after art pass 1 (commit b4a6e5d)

Never bring the test window to the front (it steals focus from the owner's typing); with the flags above it renders
in the background. Profiling: dev.freeze(100); dev.res(pix); dev.prof(90, skipBits). A/B shots: dev.skip(bits).

HEADLESS (preferred, never shows a window; the owner minimizes the windowed one, which stops rendering):
  "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --remote-debugging-port=9333
    --user-data-dir=C:\Users\Bacon\abyssal_tools\chrome_headless --enable-unsafe-webgpu --enable-gpu --ignore-gpu-blocklist
    --use-angle=d3d11 --disable-background-timer-throttling --disable-renderer-backgrounding --window-size=1984,1002
    http://127.0.0.1:8791/dev.html
  Renders 1966x850 on the NVIDIA GPU. After load: dev.play(), then dev.walkTo(x, z) once so the lantern is in hand.
