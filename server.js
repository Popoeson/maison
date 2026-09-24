require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const submissionRoutes = require('./routes/submissions');

const app = express();

const origins = (process.env.FRONTEND_ORIGIN || '*').split(',').map(s => s.trim());
app.use(cors({ origin: origins.includes('*') ? true : origins }));
app.use(express.json());

// Health check: returns 200 only when the database is connected.
// The frontend spinner keeps retrying until it gets 200.
app.get('/api/health', (req, res) => {
  const dbReady = mongoose.connection.readyState === 1;
  res.status(dbReady ? 200 : 503).json({ ok: dbReady });
});

app.use('/api/submissions', submissionRoutes);

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'A file is larger than the allowed size.' });
  }
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));