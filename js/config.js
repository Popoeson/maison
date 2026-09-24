// Your Render backend URL (no trailing slash)
const API_BASE = 'https://your-backend.onrender.com';

// Must match MAX_FILE_KB on the server. Change both together.
const MAX_FILE_KB = 50;

// Aim slightly under the limit so the server never rejects a file
const TARGET_FRACTION = 0.92;