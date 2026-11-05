import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { audioFileDigest, appendAudioFile, audioMatchesChunks } from "../backend/lib/audio-files.js";

test("audio disque : assemblage, reprise et corruption au-delà de plusieurs buffers", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vogue-audio-buffers-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const parts = [Buffer.alloc(1024 * 1024 + 17, 42), Buffer.alloc(2 * 1024 * 1024 + 3, 84)];
  const chunks = parts.map((part, index) => {
    const file = path.join(dir, `bloc-${index}.part`);
    fs.writeFileSync(file, part);
    assert.deepEqual(audioFileDigest(file), { size: part.length, sha256: createHash("sha256").update(part).digest("hex") });
    return file;
  });
  const original = path.join(dir, "original-fictif.bin");
  const fd = fs.openSync(original, "wx");
  try { for (const chunk of chunks) appendAudioFile(fd, chunk); } finally { fs.closeSync(fd); }
  assert.deepEqual(fs.readFileSync(original), Buffer.concat(parts));
  assert.equal(audioMatchesChunks(original, chunks), true);
  const mutationFd = fs.openSync(original, "r+");
  try { fs.writeSync(mutationFd, Buffer.from([0]), 0, 1, 2 * 1024 * 1024); } finally { fs.closeSync(mutationFd); }
  assert.equal(audioMatchesChunks(original, chunks), false);
  fs.writeFileSync(original, Buffer.concat(parts));
  fs.appendFileSync(original, "octets-en-trop");
  assert.equal(audioMatchesChunks(original, chunks), false);
  fs.truncateSync(original, 1024);
  assert.equal(audioMatchesChunks(original, chunks), false);
  assert.deepEqual(fs.readFileSync(chunks[0]), parts[0]);
  const link = path.join(dir, "raccourci.part");
  fs.symlinkSync(chunks[0], link);
  assert.throws(() => audioFileDigest(link), { code: "ELOOP" });
  assert.throws(() => audioMatchesChunks(original, [link]), { code: "ELOOP" });
});
