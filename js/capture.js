const DOC_TYPES = ['Passport', 'OLevel', 'JAMB', 'Birth Certificate', 'Indigene Certificate', 'Other'];
const MAX_DOCS = 10;
const DEFAULT_COUNT = 5;

const nameInput = $('studentName');
const countSelect = $('docCount');
const slotsEl = $('slots');
const submitBtn = $('submitBtn');
const statusEl = $('status');

let slots = [];
let uploading = false;

// ---------- image helpers ----------
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read this photo')); };
    img.src = url;
  });
}

const toBlob = (canvas, q) =>
  new Promise((res) => canvas.toBlob(res, 'image/jpeg', q));

// Finds the highest quality (>= minQ) that fits under limit for this canvas
async function bestUnder(canvas, limit, minQ) {
  const top = await toBlob(canvas, 0.9);
  if (top && top.size <= limit) return top;

  let best = await toBlob(canvas, minQ);
  if (!best || best.size > limit) return null;

  let lo = minQ, hi = 0.9;
  for (let i = 0; i < 5; i++) {
    const mid = (lo + hi) / 2;
    const b = await toBlob(canvas, mid);
    if (b && b.size <= limit) { best = b; lo = mid; } else { hi = mid; }
  }
  return best;
}

// Keeps the largest dimensions possible while staying readable,
// only dropping quality below 0.5 if nothing else fits.
async function compressToLimit(file) {
  const img = await loadImage(file);
  const limit = MAX_FILE_KB * 1024 * TARGET_FRACTION;
  const w0 = img.naturalWidth, h0 = img.naturalHeight;
  const dims = [1600, 1400, 1200, 1000, 850, 700, 600, 500, 400, 320];

  for (const minQ of [0.5, 0.3]) {
    const tried = new Set();
    for (const maxDim of dims) {
      const scale = Math.min(1, maxDim / Math.max(w0, h0));
      const w = Math.round(w0 * scale), h = Math.round(h0 * scale);
      if (tried.has(w)) continue;
      tried.add(w);

      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);

      const blob = await bestUnder(canvas, limit, minQ);
      if (blob) return blob;
    }
  }
  return null;
}

// ---------- slots ----------
function docLabel(slot) {
  return slot.type === 'Other' ? slot.custom.trim() : slot.type;
}

function createSlot(index) {
  const slot = { type: index === 0 ? 'Passport' : '', custom: '', blob: null, previewUrl: null, busy: false };

  const el = document.createElement('div');
  el.className = 'slot';
  el.innerHTML = `
    <div class="slot-head">Document ${index + 1}</div>
    <select class="type"></select>
    <input type="text" class="custom" placeholder="Type document name" hidden>
    <div class="slot-body">
      <div class="thumb">No photo</div>
      <div class="slot-info">
        <div class="btn-row">
          <button type="button" class="btn cap">📷 Camera</button>
          <button type="button" class="btn pick">📁 Choose file</button>
        </div>
        <p class="msg"></p>
      </div>
    </div>
    <input type="file" accept="image/*" capture="environment" class="f-cam" hidden>
    <input type="file" accept="image/*" class="f-pick" hidden>
  `;

  const select = el.querySelector('.type');
  select.innerHTML = '<option value="">Select document…</option>' +
    DOC_TYPES.map((t) => `<option value="${t}">${t}</option>`).join('');
  select.value = slot.type;

  const custom = el.querySelector('.custom');
  const camInput = el.querySelector('.f-cam');
  const pickInput = el.querySelector('.f-pick');
  const capBtn = el.querySelector('.cap');
  const pickBtn = el.querySelector('.pick');
  const thumb = el.querySelector('.thumb');
  const msg = el.querySelector('.msg');

  slot.el = el;
  slot.setMsg = (text, cls = '') => { msg.textContent = text; msg.className = 'msg ' + cls; };
  slot.setLocked = (locked) => {
    select.disabled = custom.disabled = capBtn.disabled = pickBtn.disabled = locked;
  };
  slot.clear = () => {
    if (slot.previewUrl) URL.revokeObjectURL(slot.previewUrl);
    slot.blob = null; slot.previewUrl = null;
    thumb.classList.remove('has-photo');
  };

  // Tap the thumbnail to view the photo full screen
  thumb.onclick = () => {
    if (slot.previewUrl) {
      openViewer(slot.previewUrl, `${docLabel(slot) || 'Document'} · ${(slot.blob.size / 1024).toFixed(1)} KB`);
    }
  };

  select.onchange = () => {
    slot.type = select.value;
    custom.hidden = slot.type !== 'Other';
    updateSubmit();
  };
  custom.oninput = () => { slot.custom = custom.value; updateSubmit(); };

  capBtn.onclick = () => { camInput.value = ''; camInput.click(); };
  pickBtn.onclick = () => { pickInput.value = ''; pickInput.click(); };

  // Same processing for a camera photo or a chosen file
  async function handleFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      slot.setMsg('Please choose an image (JPG, PNG or a photo).', 'err');
      return;
    }
    slot.busy = true;
    slot.clear();
    thumb.textContent = '...';
    thumb.style.background = '';
    slot.setMsg('Compressing...');
    updateSubmit();

    try {
      const blob = await compressToLimit(file);
      if (!blob) {
        slot.setMsg(`Could not get under ${MAX_FILE_KB} KB. Please try a clearer or smaller image.`, 'err');
        thumb.textContent = 'No photo';
      } else {
        slot.blob = blob;
        slot.previewUrl = URL.createObjectURL(blob);
        thumb.textContent = '';
        thumb.style.background = `url(${slot.previewUrl}) center/cover`;
        thumb.classList.add('has-photo');
        slot.setMsg(`${(blob.size / 1024).toFixed(1)} KB ✓  Tap the photo to view it`, 'ok');
      }
    } catch (e) {
      slot.setMsg(e.message || 'Something went wrong. Please try again.', 'err');
      thumb.textContent = 'No photo';
    }
    slot.busy = false;
    updateSubmit();
  }

  camInput.onchange = () => handleFile(camInput.files[0]);
  pickInput.onchange = () => handleFile(pickInput.files[0]);

  return slot;
}

function updateSubmit() {
  const ready =
    !uploading &&
    nameInput.value.trim() &&
    slots.length > 0 &&
    slots.every((s) => !s.busy && s.blob && docLabel(s));
  submitBtn.disabled = !ready;

  const done = slots.filter((s) => s.blob).length;
  submitBtn.textContent = uploading ? 'Uploading...' : `Submit (${done}/${slots.length} captured)`;
}

function setCount(n) {
  while (slots.length > n) {
    const s = slots.pop();
    s.clear();
    s.el.remove();
  }
  while (slots.length < n) {
    const s = createSlot(slots.length);
    slots.push(s);
    slotsEl.appendChild(s.el);
  }
  updateSubmit();
}

// ---------- submit ----------
function submit() {
  uploading = true;
  statusEl.className = 'status';
  statusEl.textContent = 'Uploading 0%';
  nameInput.disabled = countSelect.disabled = true;
  slots.forEach((s) => s.setLocked(true));
  updateSubmit();

  const fd = new FormData();
  fd.append('studentName', nameInput.value.trim());
  slots.forEach((s, i) => {
    fd.append('types', docLabel(s));
    fd.append('files', s.blob, `doc${i + 1}.jpg`);
  });

  const xhr = new XMLHttpRequest();
  xhr.open('POST', API_BASE + '/api/submissions');
  xhr.timeout = 180000;

  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) statusEl.textContent = `Uploading ${Math.round((e.loaded / e.total) * 100)}%`;
  };

  const fail = (text) => {
    uploading = false;
    nameInput.disabled = countSelect.disabled = false;
    slots.forEach((s) => s.setLocked(false));
    statusEl.className = 'status err';
    statusEl.textContent = text;
    updateSubmit();
  };

  xhr.onload = () => {
    let body = {};
    try { body = JSON.parse(xhr.responseText); } catch (e) {}
    if (xhr.status === 201) {
      uploading = false;
      $('doneText').textContent = `Saved as folder: ${body.folderName} (${body.documents} documents)`;
      $('done').hidden = false;
    } else {
      fail((body.error || 'Upload failed.') + ' Your photos are still here, tap Submit to try again.');
    }
  };
  xhr.onerror = () => fail('Network problem. Your photos are still here, tap Submit to try again.');
  xhr.ontimeout = () => fail('Upload timed out. Your photos are still here, tap Submit to try again.');

  xhr.send(fd);
}

function resetForm() {
  slots.forEach((s) => { s.clear(); s.el.remove(); });
  slots = [];
  nameInput.value = '';
  nameInput.disabled = countSelect.disabled = false;
  statusEl.textContent = '';
  $('done').hidden = true;
  setCount(Number(countSelect.value));
  window.scrollTo(0, 0);
}

// ---------- init ----------
for (let i = 1; i <= MAX_DOCS; i++) {
  countSelect.insertAdjacentHTML('beforeend', `<option value="${i}">${i}</option>`);
}
countSelect.value = DEFAULT_COUNT;
countSelect.onchange = () => setCount(Number(countSelect.value));
nameInput.oninput = updateSubmit;
submitBtn.onclick = submit;
$('nextBtn').onclick = resetForm;
setCount(DEFAULT_COUNT);