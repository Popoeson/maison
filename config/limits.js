// Passport gets a stricter limit; everything else shares the general one.
// Change these two numbers if the requirement changes again.
const PASSPORT_MAX_KB = 15;
const OTHER_MAX_KB = 50;

function limitForType(type) {
  return (type || '').trim().toLowerCase() === 'passport' ? PASSPORT_MAX_KB : OTHER_MAX_KB;
}

module.exports = {
  PASSPORT_MAX_KB,
  OTHER_MAX_KB,
  limitForType,
  MAX_FILE_KB: OTHER_MAX_KB,               // used by multer as the largest any single file may be
  MAX_FILE_BYTES: OTHER_MAX_KB * 1024
};