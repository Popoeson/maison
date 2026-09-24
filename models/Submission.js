const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema({
  type: String,        // e.g. "Passport"
  fileName: String,    // e.g. "Passport.jpg"
  url: String,
  publicId: String,
  sizeKB: Number
}, { _id: false });

const submissionSchema = new mongoose.Schema({
  studentName: { type: String, required: true },
  folderName: { type: String, required: true },
  documents: [documentSchema],
  status: { type: String, enum: ['submitted', 'downloaded', 'deleted'], default: 'submitted' },
  submittedAt: { type: Date, default: Date.now },
  downloadedAt: Date,
  downloadCount: { type: Number, default: 0 },
  deletedAt: Date
});

// Case-insensitive uniqueness (Windows folders are case-insensitive)
submissionSchema.index(
  { folderName: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } }
);

module.exports = mongoose.model('Submission', submissionSchema);