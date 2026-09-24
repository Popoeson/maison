const listEl = $('list');
const summaryEl = $('summary');
const searchEl = $('search');
const filterEl = $('filter');

let submissions = [];
const busy = new Set();
const progress = new Map();

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let toastTimer;
function toast(text, isErr = false) {
  const t = $('toast');
  t.textContent = text;
  t.className = 'toast' + (isErr ? ' err' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), isErr ? 6000 : 3000);
}

function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

// ---------- data ----------
function replaceSubmission(updated) {
  const i = submissions.findIndex((s) => s._id === updated._id);
  if (i >= 0) submissions[i] = updated;
}

async function loadList(silent = false) {
  let data;
  try {
    const res = await fetch(API_BASE + '/api/submissions', { cache: 'no-store' });
    if (!res.ok) throw new Error('Server error');
    data = await res.json();
  } catch (e) {
    if (!silent) toast('Could not load submissions. Check your connection and tap Refresh.', true);
    return;
  }

  // keep only records created by this system
  submissions = (Array.isArray(data) ? data : []).filter(
    (s) => s && s._id && s.folderName && Array.isArray(s.documents)
  );

  try {
    render();
  } catch (e) {
    console.error('Render error:', e);
    if (!silent) toast('Loaded, but could not display the list. See console.', true);
  }
}

// Tells the server the student was downloaded. Survives browser download
// interruptions (keepalive) and retries once.
async function markDownloaded(s) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(`${API_BASE}/api/submissions/${s._id}/downloaded`, {
        method: 'PATCH',
        keepalive: true
      });
      if (r.ok) return await r.json();
    } catch (e) {
      console.error('Mark downloaded failed:', e);
    }
    await sleep(1000);
  }
  return null;
}

// ---------- render ----------
function visible() {
  const q = searchEl.value.trim().toLowerCase();
  const f = filterEl.value;
  return submissions.filter((s) =>
    (f === 'all' || s.status === f) &&
    (!q || s.folderName.toLowerCase().includes(q))
  );
}

function card(s) {
  const isBusy = busy.has(s._id);
  const label = { submitted: 'New', downloaded: 'Downloaded', deleted: 'Deleted' }[s.status] || s.status;
  const when = new Date(s.submittedAt).toLocaleString();
  const dl = s.downloadedAt ? ` · Downloaded ${new Date(s.downloadedAt).toLocaleString()}` : '';
  const times = s.downloadCount > 1 ? ` (${s.downloadCount}x)` : '';

  let actions = '';
  if (s.status !== 'deleted') {
    const dlText = isBusy
      ? (progress.get(s._id) || 'Working...')
      : (s.status === 'downloaded' ? 'Download again' : 'Download');
    actions = `
      <button class="btn small ${s.status === 'downloaded' ? '' : 'blue'}" data-act="download" data-id="${s._id}" ${isBusy ? 'disabled' : ''}>${dlText}</button>
      <button class="btn small danger" data-act="delete" data-id="${s._id}" ${isBusy ? 'disabled' : ''}>Delete</button>`;
  }

  const docs = s.status === 'deleted' ? '' : `
    <div class="docs">
      ${s.documents.map((d, i) => `
        <figure class="doc" data-act="view" data-id="${s._id}" data-i="${i}">
          <img loading="lazy" src="${esc(d.url)}" alt="${esc(d.type)}">
          <figcaption>${esc(d.type)}<br>${d.sizeKB} KB</figcaption>
        </figure>`).join('')}
    </div>`;

  return `
    <div class="sub">
      <div class="sub-top">
        <div>
          <div class="sub-name">${esc(s.folderName)}<span class="badge ${s.status}">${label}${times}</span></div>
          <div class="sub-meta">${s.documents.length} documents · Submitted ${when}${dl}</div>
        </div>
        <div class="sub-actions">${actions}</div>
      </div>
      ${docs}
    </div>`;
}

function render() {
  const items = visible();
  const count = (st) => submissions.filter((s) => s.status === st).length;
  summaryEl.textContent =
    `${submissions.length} total · ${count('submitted')} new · ${count('downloaded')} downloaded · ${count('deleted')} deleted`;
  $('downloadAll').disabled = !submissions.some((s) => s.status === 'submitted') || busy.size > 0;

  listEl.innerHTML = items.length
    ? items.map(card).join('')
    : '<p class="empty">No submissions to show.</p>';
}

// ---------- actions ----------
// Builds a ZIP that extracts to "<Student Name>/<documents>"
async function downloadZip(list, zipName) {
  list.forEach((s) => { busy.add(s._id); progress.set(s._id, 'Preparing...'); });
  render();

  try {
    const zip = new JSZip();
    for (const s of list) {
      for (let i = 0; i < s.documents.length; i++) {
        const d = s.documents[i];
        progress.set(s._id, `Fetching ${i + 1}/${s.documents.length}...`);
        render();
        const res = await fetch(d.url, { cache: 'no-store' });
        if (!res.ok) throw new Error(`Could not fetch ${d.fileName} for ${s.folderName}`);
        zip.file(`${s.folderName}/${d.fileName}`, await res.blob());
      }
    }

    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    saveBlob(blob, zipName);

    let failed = 0;
    for (const s of list) {
      const updated = await markDownloaded(s);
      if (updated) replaceSubmission(updated); else failed++;
    }
    if (failed) {
      toast(`ZIP downloaded, but the status of ${failed} student(s) could not be updated. Tap Refresh to check.`, true);
    }
    return true;
  } catch (e) {
    console.error('Download failed:', e);
    toast(e.message || 'Download failed.', true);
    return false;
  } finally {
    list.forEach((s) => { busy.delete(s._id); progress.delete(s._id); });
    render();
  }
}

async function deleteOne(s) {
  const warning = s.status === 'downloaded'
    ? ''
    : '\n\nWARNING: this student has NOT been downloaded yet. The files cannot be recovered.';
  if (!confirm(`Delete ${s.folderName} permanently?${warning}`)) return;

  busy.add(s._id);
  progress.set(s._id, 'Deleting...');
  render();
  try {
    const r = await fetch(`${API_BASE}/api/submissions/${s._id}`, { method: 'DELETE' });
    if (!r.ok) throw new Error('Delete failed.');
    submissions = submissions.filter((x) => x._id !== s._id);
    toast(`${s.folderName} deleted.`);
  } catch (e) {
    toast(`${s.folderName}: ${e.message}`, true);
  } finally {
    busy.delete(s._id);
    progress.delete(s._id);
    render();
  }
}

async function downloadAllNew() {
  const pending = visible().filter((s) => s.status === 'submitted');
  if (!pending.length) return toast('No new submissions to download.');
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const ok = await downloadZip(pending, `New students ${stamp}.zip`);
  if (ok) toast(`Downloaded ${pending.length} students in one ZIP.`);
}

// ---------- events ----------
listEl.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const s = submissions.find((x) => x._id === el.dataset.id);
  if (!s) return;

  if (el.dataset.act === 'view') {
    const d = s.documents[Number(el.dataset.i)];
    openViewer(d.url, `${s.folderName} · ${d.type} · ${d.sizeKB} KB`);
  } else if (el.dataset.act === 'download') {
    downloadZip([s], `${s.folderName}.zip`);
  } else if (el.dataset.act === 'delete') {
    deleteOne(s);
  }
});

$('refreshBtn').onclick = () => loadList();
$('downloadAll').onclick = downloadAllNew;
searchEl.oninput = render;
filterEl.onchange = render;

// ---------- init ----------
(function init() {
  const b = $('unsupported');
  if (b) {
    b.className = 'banner info';
    b.textContent = "Each student downloads as a ZIP file. Extract it to get the student's folder.";
    b.hidden = false;
  }
  const box = document.querySelector('.folder-box');
  if (box) box.hidden = true;
})();

// Load the list once the server is live, then refresh quietly every 20 seconds
window.addEventListener('server-ready', () => loadList());
setInterval(() => {
  if (!$('gate').hidden || !$('viewer').hidden || busy.size > 0) return;
  loadList(true);
}, 20000);