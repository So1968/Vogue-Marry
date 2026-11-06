import fs from "node:fs";
import { createHash } from "node:crypto";

const BUFFER_SIZE = 1024 * 1024;
function openSource(file) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  if (!fs.fstatSync(fd).isFile()) {
    fs.closeSync(fd);
    throw new Error("Fragment audio non régulier.");
  }
  return fd;
}

export function audioFileDigest(file) {
  const fd = openSource(file);
  const hash = createHash("sha256");
  const buffer = Buffer.alloc(BUFFER_SIZE);
  let size = 0;
  try {
    let bytes;
    while ((bytes = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytes));
      size += bytes;
    }
    return { size, sha256: hash.digest("hex") };
  } finally { fs.closeSync(fd); }
}

export function appendAudioFile(outputFd, file) {
  const fd = openSource(file);
  const buffer = Buffer.alloc(BUFFER_SIZE);
  try {
    let bytes;
    while ((bytes = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      let written = 0;
      while (written < bytes) {
        const size = fs.writeSync(outputFd, buffer, written, bytes - written);
        if (!size) throw new Error("Écriture audio interrompue.");
        written += size;
      }
    }
  } finally { fs.closeSync(fd); }
}

// Comparaison exacte, avec une mémoire bornée quelle que soit la durée de réunion.
export function audioMatchesChunks(original, chunks) {
  const fd = openSource(original);
  const actual = Buffer.alloc(BUFFER_SIZE);
  const expected = Buffer.alloc(BUFFER_SIZE);
  try {
    let offset = 0;
    for (const file of chunks) {
      const chunkFd = openSource(file);
      try {
        let bytes;
        while ((bytes = fs.readSync(chunkFd, expected, 0, expected.length, null)) > 0) {
          let read = 0;
          while (read < bytes) {
            const size = fs.readSync(fd, actual, read, bytes - read, offset + read);
            if (!size) return false;
            read += size;
          }
          if (!actual.subarray(0, bytes).equals(expected.subarray(0, bytes))) return false;
          offset += bytes;
        }
      } finally { fs.closeSync(chunkFd); }
    }
    return fs.fstatSync(fd).size === offset;
  } finally { fs.closeSync(fd); }
}
