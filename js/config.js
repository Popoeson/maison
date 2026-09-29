// Your Render backend URL (no trailing slash)
const API_BASE = 'https://maison-90o3.onrender.com';

// Must match config/limits.js on the server. Change both together.
const PASSPORT_MAX_KB = 15;
const OTHER_MAX_KB = 50;

// Aim slightly under the limit so the server never rejects a file
const TARGET_FRACTION = 0.92;

function limitKBFor(type) {
  return (type || '').trim().toLowerCase() === 'passport' ? PASSPORT_MAX_KB : OTHER_MAX_KB;
}