const express = require('express');
const multer = require('multer');
const mongoose = require('mongoose');
const cloudinary = require('../config/cloudinary');
const Submission = require('../models/Submission');
const { MAX_FILE_KB, MAX_FILE_BYTES } = require('../config/limits');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 20 }
});

// Remove characters Windows/macOS don't allow in folder or file names
function cleanName(s = '') {
  return String(s)
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 80);
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'doc';
}

async function uniqueFolderName(base) {
  let name = base;
  let n = 1;
  while (await Submission.exists({ folderName: name }).collation({ locale: 'en', strength: 2 })) {
    n++;
    name = `${base} (${n})`;
  }
  return name;
}

function uploadBuffer(buffer, folder, publicId) {
  return new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        { folder, public_id: publicId, resource_type: 'image', overwrite: true },
        (err, result) => (err ? reject(err) : resolve(result))
      )
      .end(buffer);
  });
}

async function removeFromCloudinary(publicIds, folder) {
  if (publicIds.length) {
    await cloudinary.api.delete_resources(publicIds, { invalidate: true });
  }
  if (folder) {
    try { await cloudinary.api.delete_folder(folder); } catch (e) { /* folder may not be empty/exist */ }
  }
}

// ---------- CREATE ----------
router.post('/', upload.array('files', 20), async (req, res, next) => {
  const uploaded = [];
  const id = new mongoose.Types.ObjectId();
  const cloudFolder = `student-docs/${id}`;

  try {
    const studentName = cleanName(req.body.studentName);
    if (!studentName) return res.status(400).json({ error: 'Student name is required.' });

    const files = req.files || [];
    let types = req.body.types;
    if (!Array.isArray(types)) types = types ? [types] : [];

    if (!files.length || files.length !== types.length) {
      return res.status(400).json({ error: 'Each document needs a type and a file.' });
    }
    for (const f of files) {
      if (f.mimetype !== 'image/jpeg') {
        return res.status(400).json({ error: 'Only JPG files are accepted.' });
      }
      if (f.size > MAX_FILE_BYTES) {
        return res.status(400).json({ error: `Each file must be ${MAX_FILE_KB} KB or less.` });
      }
    }

    const folderName = await uniqueFolderName(studentName);
    const usedLabels = new Map();
    const documents = [];

    for (let i = 0; i < files.length; i++) {
      const label = cleanName(types[i]) || `Document ${i + 1}`;
      const key = label.toLowerCase();
      const count = (usedLabels.get(key) || 0) + 1;
      usedLabels.set(key, count);
      const fileName = (count > 1 ? `${label} (${count})` : label) + '.jpg';

      const result = await uploadBuffer(files[i].buffer, cloudFolder, `${slug(label)}-${i + 1}`);
      uploaded.push(result.public_id);

      documents.push({
        type: label,
        fileName,
        url: result.secure_url,
        publicId: result.public_id,
        sizeKB: Math.round((result.bytes / 1024) * 10) / 10
      });
    }

    await Submission.create({ _id: id, studentName, folderName, documents });
    res.status(201).json({ id, folderName, documents: documents.length });
  } catch (err) {
    // Roll back anything already uploaded so we never leave orphan files
    try { await removeFromCloudinary(uploaded, cloudFolder); } catch (e) { console.error('Cleanup failed', e); }
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Another submission just used this name. Please submit again.' });
    }
    next(err);
  }
});

// ---------- LIST ----------
router.get('/', async (req, res, next) => {
  try {
    const submissions = await Submission.find().sort({ submittedAt: -1 }).lean();
    res.json(submissions);
  } catch (err) { next(err); }
});

// ---------- MARK DOWNLOADED ----------
router.patch('/:id/downloaded', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id.' });
    const doc = await Submission.findOneAndUpdate(
      { _id: req.params.id, status: { $ne: 'deleted' } },
      { status: 'downloaded', downloadedAt: new Date(), $inc: { downloadCount: 1 } },
      { new: true }
    );
    if (!doc) return res.status(404).json({ error: 'Submission not found or already deleted.' });
    res.json(doc);
  } catch (err) { next(err); }
});

// ---------- DELETE FILES (keeps the record, frees Cloudinary storage) ----------
router.delete('/:id', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id.' });
    const doc = await Submission.findById(req.params.id);
    if (!doc) return res.json({ ok: true, id: req.params.id }); // already gone

    // If Cloudinary fails, this throws and the record is kept, so nothing is orphaned
    await removeFromCloudinary(doc.documents.map(d => d.publicId), `student-docs/${doc._id}`);
    await doc.deleteOne();

    res.json({ ok: true, id: req.params.id });
  } catch (err) { next(err); }
});

module.exports = router;