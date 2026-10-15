export function startupPage(stage = 'idle') {
  const initialStage = JSON.stringify(String(stage)).replaceAll('<', '\\u003c');
  const squares = Array.from({length: 16}, (_, i) => '<span class="square' + ((Math.floor(i / 4) + i % 4) % 2 ? ' dark' : '') + '"></span>').join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark light">
<meta name="theme-color" content="#121813">
<title>Getting ready · Chess</title>
<style>
:root{color-scheme:dark;--bg:#121813;--card:#1a221c;--ink:#f3f3e9;--muted:#a3afa4;--line:#ffffff12;--accent:#c6e99b;--tile-dark:#384b3b;--tile-light:#829875;--tile:44px;--danger:#efb4a3;--soft:#101811;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;min-height:100svh;display:grid;place-items:center;padding:32px 20px;background:radial-gradient(ellipse at 50% 30%,#52724a20,transparent 65%),var(--bg);color:var(--ink);-webkit-font-smoothing:antialiased}
button,a{-webkit-tap-highlight-color:transparent}
.shell{width:100%;max-width:460px}
.brand{display:flex;justify-content:center;align-items:center;gap:9px;margin-bottom:23px;font-size:13px;font-weight:700;letter-spacing:.17em;text-transform:uppercase;color:var(--accent)}
.brand svg{width:21px;height:25px}
.card{position:relative;overflow:hidden;text-align:center;padding:32px 32px 27px;border:1px solid var(--line);border-radius:28px;background:linear-gradient(145deg,#ffffff03,transparent 65%),var(--card);box-shadow:0 24px 80px #00000025}
.label{display:inline-flex;align-items:center;gap:8px;font-size:11px;font-weight:650;letter-spacing:.11em;text-transform:uppercase;color:var(--muted)}
.dot{width:6px;height:6px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 4px #c6e99b0c;animation:breathe 2s ease-in-out infinite}
.scene{position:relative;width:calc(var(--tile)*4);height:calc(var(--tile)*4);margin:29px auto 27px;isolation:isolate}
.scene:after{content:"";position:absolute;z-index:-1;inset:0;border-radius:50%;background:var(--accent);filter:blur(50px);opacity:.055}
.board{position:absolute;inset:0;border-radius:14px;display:grid;grid-template:repeat(4,1fr)/repeat(4,1fr);box-shadow:0 10px 24px #00000022,inset 0 0 0 1px #ffffff0c;overflow:hidden}
.square{background:var(--tile-light)}.square.dark{background:var(--tile-dark)}
.tile-glow{position:absolute;width:var(--tile);height:var(--tile);border-radius:5px;background:#d3f5a675;left:var(--tile);top:calc(var(--tile)*2);animation:tile-glow 8s ease-in-out infinite}
.piece{position:absolute;left:0;top:0;width:var(--tile);height:var(--tile);display:grid;place-items:center;animation:knight-tour 8s cubic-bezier(.45,0,.2,1) infinite;filter:drop-shadow(0 4px 2px #17211880)}
.piece svg{width:33px;height:40px;overflow:visible}
.piece-shadow{position:absolute;width:28px;height:7px;border-radius:50%;background:#15201655;bottom:3px;left:8px}
h1{font-size:clamp(25px,6vw,31px);line-height:1.17;letter-spacing:-.045em;font-weight:620;margin:0 0 11px;text-wrap:balance}
.intro{color:var(--muted);font-size:14px;line-height:1.65;margin:0 auto;max-width:32ch;text-wrap:pretty}
.status-box{margin-top:27px;padding-top:22px;border-top:1px solid var(--line)}
.status-row{display:flex;justify-content:space-between;align-items:center;gap:12px;text-align:left}
#status{font-size:13px;font-weight:550;line-height:1.5}
.spinner{width:14px;height:14px;flex:none;border:1.5px solid #c6e99b25;border-top-color:var(--accent);border-radius:50%;animation:spin 1s linear infinite}
.steps{display:flex;align-items:flex-start;justify-content:space-between;margin-top:20px;gap:12px;text-align:left}
.step{flex:1;min-width:0;color:var(--muted);font-size:11px}
.step-line{height:3px;border-radius:5px;background:var(--line);margin-bottom:8px;position:relative;overflow:hidden}
.step.active .step-line{background:#c6e99b24}
.step.active .step-line:after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent,var(--accent),transparent);animation:shimmer 2s ease-in-out infinite}
.step.done .step-line{background:var(--accent)}
.step.active,.step.done{color:var(--ink)}
.step span:first-of-type{opacity:.55;margin-right:5px;font-variant-numeric:tabular-nums}
.footnote{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:18px 5px 0;font-size:11px;color:var(--muted)}
.auto{display:flex;align-items:center;gap:6px}
.auto svg{width:13px;height:13px;opacity:.7}
#elapsed{white-space:nowrap;font-variant-numeric:tabular-nums;opacity:.8}
#retry{border:0;border-radius:10px;padding:12px 22px;font-size:13px;font-weight:600;font-family:inherit;background:var(--accent);color:#192417;margin:20px 0 0;cursor:pointer}
#retry:hover{filter:brightness(1.07)}
#retry:focus-visible,summary:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:4px}
details{margin-top:17px;text-align:left;color:var(--muted);font-size:12px}
summary{cursor:pointer;width:fit-content;margin:auto;padding:3px}
pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--soft);padding:13px;border:1px solid var(--line);border-radius:9px;font-size:11px;line-height:1.6;max-height:130px;overflow:auto}
[hidden]{display:none!important}
body[data-state=error] .dot{background:var(--danger);animation:none}
body[data-state=error] .spinner{display:none}
body[data-state=error] #status{color:var(--danger)}
body[data-state=error] .piece,body[data-state=error] .tile-glow{animation-play-state:paused}
body[data-state=error] .step.active .step-line:after{animation:none;opacity:0}
noscript{display:block;margin-top:16px;font-size:12px;line-height:1.7;color:var(--muted)}
noscript a{color:var(--accent)}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes breathe{50%{opacity:.35}}
@keyframes shimmer{from{transform:translateX(-100%)}to{transform:translateX(100%)}}
@keyframes tile-glow{0%,18%,100%{opacity:0}25%,38%{opacity:1}45%,68%{opacity:0}75%,88%{opacity:1}}
@keyframes knight-tour{0%,15%,100%{transform:translate(0,0)}25%,40%{transform:translate(var(--tile),calc(var(--tile)*2))}50%,65%{transform:translate(calc(var(--tile)*3),calc(var(--tile)*3))}75%,90%{transform:translate(calc(var(--tile)*2),var(--tile))}}
@media(prefers-color-scheme:light){:root{color-scheme:light;--bg:#f0f1e9;--card:#fafbf5;--ink:#293529;--muted:#707d6b;--line:#243b2614;--accent:#4d713a;--tile-dark:#8fa485;--tile-light:#d2ddbf;--soft:#eef1e7;--danger:#a34c36}.card{box-shadow:0 24px 70px #334d2710}.scene:after{opacity:.08}.step.active .step-line{background:#4d713a24}.spinner{border-color:#4d713a25;border-top-color:var(--accent)}#retry{color:#fff}.dot{box-shadow:0 0 0 4px #4d713a0b}}
@media(max-width:380px){body{padding:20px 16px}.card{padding:27px 23px 23px}.brand{margin-bottom:19px}.scene{--tile:40px;margin:24px auto}.piece svg{width:30px;height:36px}.piece-shadow{width:24px;left:8px}.footnote{font-size:10px}}
@media(max-height:700px){body{padding-top:20px;padding-bottom:20px}.brand{margin-bottom:16px}.card{padding-top:25px;padding-bottom:23px}.scene{--tile:32px;margin:19px auto}.piece svg{width:28px;height:33px}.piece-shadow{width:22px;left:7px}.status-box{margin-top:22px;padding-top:18px}}
@media(max-height:620px){.card{padding-top:22px;padding-bottom:20px}.scene{--tile:28px;margin:16px auto}.status-box{margin-top:18px;padding-top:14px}.brand{margin-bottom:13px}.footnote{margin-top:14px}.step{font-size:10px;white-space:nowrap}}
@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important}.piece{transform:translate(var(--tile),calc(var(--tile)*2))}.tile-glow{opacity:.35}.step.active .step-line:after{background:var(--accent);opacity:.5}.spinner{border-style:dotted}}
</style>
</head>
<body data-state="loading">
<main class="shell">
  <div class="brand"><svg viewBox="0 0 40 48" aria-hidden="true"><path d="M8 43h26M11 38h20l-2-12c-1-6-6-8-10-8l4-6-7 2-4-7-2 10-7 10 7 4 7-8" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg> Chess</div>
  <section class="card" aria-labelledby="heading">
    <div class="label"><span class="dot"></span><span id="badge">Your board is waking up</span></div>
    <div class="scene" aria-hidden="true"><div class="board">${squares}<div class="tile-glow"></div></div><div class="piece"><span class="piece-shadow"></span><svg viewBox="0 0 40 48"><path d="M8 43h26v-4H8zM11 36h20l-2-10c-1-6-6-8-10-8l4-6-7 2-4-7-2 10-7 10 7 4 7-8c2 3 2 7-1 13z" fill="#f7f3df" stroke="#34412f" stroke-width="1.6" stroke-linejoin="round"/><circle cx="12" cy="20" r="1.5" fill="#34412f"/></svg></div></div>
    <h1 id="heading">Getting your board ready.</h1>
    <p class="intro" id="intro">Your board will open as soon as it is ready.</p>
    <div class="status-box">
      <div class="status-row"><span id="status" role="status" aria-live="polite">Waking up the server…</span><span class="spinner" aria-hidden="true"></span></div>
      <div class="steps" aria-label="Startup stages">
        <div class="step active" data-step="0" aria-current="step"><div class="step-line"></div><span>01</span><span>Wake up</span></div>
        <div class="step" data-step="1"><div class="step-line"></div><span>02</span><span>Restore</span></div>
        <div class="step" data-step="2"><div class="step-line"></div><span>03</span><span>Get ready</span></div>
      </div>
    </div>
    <button type="button" id="retry" hidden>Try again</button>
    <details id="details" hidden><summary>Show details</summary><pre id="error"></pre></details>
    <noscript>Automatic refresh needs JavaScript. <a href="">Reload this page</a> to check again.</noscript>
  </section>
  <div class="footnote"><span class="auto"><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M12.8 6A5 5 0 1 0 13 9M10 5.5h3.5V2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg><span id="auto-label">Opens automatically when ready</span></span><span id="elapsed">00:00</span></div>
</main>
<script>
const initialStage = ${initialStage};
const stages = {
  'idle': [0, 'Waking up the server…'],
  'container-port': [0, 'Waking up the server…'],
  'database-ready': [0, 'Preparing saved games…'],
  'backup-load': [1, 'Finding saved games…'],
  'database-restore': [1, 'Restoring saved games…'],
  'application-initialize': [2, 'Setting up your board…'],
  'initial-backup': [2, 'Saving a fresh checkpoint…'],
  'final-backup': [2, 'Saving your progress…'],
  'idle-shutdown': [2, 'Finishing the previous session…'],
  'ready': [3, 'Your board is ready.'],
};
const failures = ['failed', 'container-error', 'missing-secrets', 'request-failed'];
const el = id => document.getElementById(id);
let timer;
let restartTimer;
let checking = false;
const began = Date.now();

function render(stage, error) {
  const failed = failures.includes(stage) || (stage === 'stopped' && Boolean(error));
  document.body.dataset.state = failed ? 'error' : 'loading';
  el('heading').textContent = failed ? 'The board needs a moment.' : 'Getting your board ready.';
  el('intro').textContent = failed ? 'The server could not finish starting. You can try again below.' : 'Your board will open as soon as it is ready.';
  el('badge').textContent = failed ? 'Startup paused' : 'Your board is waking up';
  el('retry').hidden = !failed;
  el('details').hidden = !failed || !error;
  el('error').textContent = error || '';
  el('auto-label').textContent = failed ? 'Waiting for the server to recover' : 'Opens automatically when ready';
  const [phase, message] = stages[stage] || [0, 'Connecting to the server…'];
  el('status').textContent = failed ? 'Unable to start the server.' : message;
  for (const step of document.querySelectorAll('[data-step]')) {
    const index = Number(step.dataset.step);
    step.classList.toggle('done', index < phase);
    step.classList.toggle('active', index === phase);
    if (index === phase) step.setAttribute('aria-current', 'step');
    else step.removeAttribute('aria-current');
  }
}

async function check() {
  if (checking || document.hidden) return;
  checking = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch('/healthz', {cache: 'no-store', signal: controller.signal});
    if (!response.ok) throw new Error('Status unavailable');
    const state = await response.json();
    if (state.ready) {
      render('ready');
      location.reload();
      return;
    }
    render(typeof state.stage === 'string' ? state.stage : 'idle', typeof state.error === 'string' ? state.error : '');
    // Resume after a normal sleep; display a startup failure instead of a reload loop.
    if (!state.error && (state.stage === 'stopped' || state.stage === 'idle')) {
      if (!restartTimer) restartTimer = setTimeout(() => location.reload(), 5000);
    } else {
      clearTimeout(restartTimer);
      restartTimer = undefined;
    }
  } catch {
    el('status').textContent = 'Reconnecting to the server…';
    el('auto-label').textContent = 'We will check again automatically';
  } finally {
    clearTimeout(timeout);
    checking = false;
    if (!document.hidden) timer = setTimeout(check, 3000);
  }
}

el('retry').addEventListener('click', () => location.reload());
document.addEventListener('visibilitychange', () => {
  clearTimeout(timer);
  clearTimeout(restartTimer);
  restartTimer = undefined;
  if (!document.hidden) void check();
});
setInterval(() => {
  const seconds = Math.floor((Date.now() - began) / 1000);
  el('elapsed').textContent = String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
}, 1000);
render(initialStage);
void check();
</script>
</body>
</html>`;
}
