const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Shows the spinner until GET /api/health returns 200.
// Retries every 3 seconds; after 90 seconds shows a Retry button.
async function waitForServer() {
  const gate = $('gate'), text = $('gateText'), retry = $('gateRetry');
  const spinner = gate.querySelector('.spinner');

  gate.hidden = false;
  spinner.hidden = false;
  retry.hidden = true;
  text.textContent = 'Connecting to server...';

  const start = Date.now();
  while (Date.now() - start < 90000) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(API_BASE + '/api/health', { signal: ctrl.signal, cache: 'no-store' });
      clearTimeout(timer);
     if (res.ok) {
        gate.hidden = true;
        window.dispatchEvent(new Event('server-ready'));
        return true;
      }

  spinner.hidden = true;
  text.textContent = 'Server not responding.';
  retry.hidden = false;
  retry.onclick = waitForServer;
  return false;
}

waitForServer();

// ---------- Full-screen image viewer (shared by both pages) ----------
function openViewer(src, caption) {
  $('viewerImg').src = src;
  $('viewerCap').textContent = caption || '';
  $('viewerStage').classList.remove('zoomed');
  $('viewerStage').scrollTo(0, 0);
  $('viewer').hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeViewer() {
  $('viewer').hidden = true;
  $('viewerImg').removeAttribute('src');
  document.body.style.overflow = '';
}

$('viewerClose').onclick = closeViewer;
$('viewerImg').onclick = () => $('viewerStage').classList.toggle('zoomed');
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('viewer').hidden) closeViewer();
});