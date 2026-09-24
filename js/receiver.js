const listEl = $('list');
const summaryEl = $('summary');
const searchEl = $('search');
const filterEl = $('filter');

let submissions = [];
let rootHandle = null;
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

// ---------- remember the chosen folder (IndexedDB) ----------
function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('receiver-db', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function dbGet(key) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const q = db.transaction('kv').objectStore('kv').get(key);
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}
async function dbSet(key, value) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

function showFolder() {
  $('folderLabel').textContent = rootHandle ? rootHandle.name : 'No folder chosen';
}

async function chooseFolder() {
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'student-docs' });
    rootHandle = handle;
    await dbSet('root', handle);
    showFolder();
    return true;
  } catch (e) {
    if (e.name !== 'AbortError') toast('Could not open that folder: ' + e.message, true);
    return false;
  }
}

// Makes sure we have a folder and permission to write into it
async function ensureRoot() {
  if (!rootHandle) return chooseFolder();
  let perm = await rootHandle.queryPermission({ mode: 'readwrite' });
  if (perm !== 'granted') perm = await rootHandle.requestPermission({ mode: 'readwrite' });
  return perm === 'granted' ? true : chooseFolder();
}

// ---------- data ----------
async function loadList(silent = false) {
  try {
    const res = await fetch(API_BASE + '/api/submissions', { cache: 'no-store' });
    if (!res.ok) throw new Error('Server error');
    submissions = await res.json();
    render();
  } catch (e) {
    if (!silent) toast('Could not load submissions. Check your connection and tap Refresh.', true);
  }
}

function replaceSubmission(updated) {
  const i = submissions.findIndex((s) => s._id === updated._id);
  if (i >= 0) submissions[i] = updated;
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
  const label = { submitted: 'New', downloaded: 'Downloaded', deleted: 'Deleted' }[s.status];
  const when = new Date(s.submittedAt).toLocaleString();
  const dl = s.downloadedAt ? ` · Downloaded ${new Date(s.downloadedAt).toLocaleString()}` : '';
  const times = s.downloadCount > 1 ? ` (${s.downloadCount}x)` : '';

  let actions = '';
  if (s.status !== 'deleted') {
    const dlText = isBusy ? (progress.get(s._id) || 'Working...') : (s.status === 'downloaded' ? 'Download again' : 'Download');
    actions = `
      <button class="btn small ${s.status === 'downloaded' ? '' : 'blue'}" data-act="download" data-id="${s._id}" ${isBusy ? 'disabled' : ''}>${dlText}</button>
      <button class="btn small danger" data-act="delete" data-id="${s._id}" ${isBusy ? 'disabled' : ''}>Delete files</button>`;
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
async function downloadOne(s) {
  if (!(await ensureRoot())) return false;

  busy.add(s._id);
  progress.set(s._id, 'Starting...');
  render();

  try {
    const dir = await rootHandle.getDirectoryHandle(s.folderName, { create: true });

    for (let i = 0; i < s.documents.length; i++) {
      const d = s.documents[i];
      progress.set(s._id, `Saving ${i + 1}/${s.documents.length}...`);
      render();

      const res = await fetch(d.url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Could not fetch ${d.fileName}`);
      const blob = await res.blob();

      const fileHandle = await dir.getFileHandle(d.fileName, { create: true });
      const w = await fileHandle.createWritable();
      await w.write(blob);
      await w.close();
    }

    const r = await fetch(`${API_BASE}/api/submissions/${s._id}/downloaded`, { method: 'PATCH' });
    if (!r.ok) throw new Error('Files saved, but the status could not be updated.');
    replaceSubmission(await r.json());
    return true;
  } catch (e) {
    const msg = e.name === 'NotFoundError'
      ? 'The download folder is no longer available. Please choose it again.'
      : e.message;
    if (e.name === 'NotFoundError') { rootHandle = null; showFolder(); }
    toast(`${s.folderName}: ${msg}`, true);
    return false;
  } finally {
    busy.delete(s._id);
    progress.delete(s._id);
    render();
  }
}

async function deleteOne(s) {
  const warning = s.status === 'downloaded'
    ? ''
    : '\n\nWARNING: this student has NOT been downloaded yet. The files cannot be recovered.';
  if (!confirm(`Delete ${s.folderName}'s files from cloud storage?${warning}`)) return;

  busy.add(s._id);
  progress.set(s._id, 'Deleting...');
  render();
  try {
    const r = await fetch(`${API_BASE}/api/submissions/${s._id}`, { method: 'DELETE' });
    if (!r.ok) throw new Error('Delete failed.');
    replaceSubmission(await r.json());
    toast(`${s.folderName}: files deleted.`);
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
  if (!(await ensureRoot())) return;

  let ok = 0;
  for (const s of pending) {
    if (await downloadOne(s)) ok++;
  }
  toast(`Downloaded ${ok} of ${pending.length} students.`, ok !== pending.length);
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
    downloadOne(s);
  } else if (el.dataset.act === 'delete') {
    deleteOne(s);
  }
});

$('pickFolder').onclick = chooseFolder;
$('refreshBtn').onclick = () => loadList();
$('downloadAll').onclick = downloadAllNew;
searchEl.oninput = render;
filterEl.onchange = render;

// ---------- init ----------
(async function init() {
  if (!window.showDirectoryPicker) {
    $('unsupported').hidden = false;
    $('pickFolder').disabled = true;
    $('downloadAll').disabled = true;
  } else {
    try { rootHandle = (await dbGet('root')) || null; } catch (e) { rootHandle = null; }
    showFolder();
  }
})();

// Load the list once the server is live, then refresh quietly every 20 seconds
window.addEventListener('server-ready', () => loadList());
setInterval(() => {
  if (!$('gate').hidden || !$('viewer').hidden || busy.size > 0) return;
  loadList(true);
}, 20000);