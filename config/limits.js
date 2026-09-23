// Change the limit here or via MAX_FILE_KB in .env
const MAX_FILE_KB = Number(process.env.MAX_FILE_KB) || 50;
module.exports = { MAX_FILE_KB, MAX_FILE_BYTES: MAX_FILE_KB * 1024 };