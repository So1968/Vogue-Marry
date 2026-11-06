import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { atomicWriteText, preserveOriginalTranscript } from "../backend/lib/transcription-history.js";

test("transcription : original immuable et nettoyage du temporaire après erreur d'écriture", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vogue-transcription-history-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "transcription.json");
  atomicWriteText(file, '{"text":"original fictif"}');
  preserveOriginalTranscript(dir);
  atomicWriteText(file, '{"text":"correction fictive"}');
  preserveOriginalTranscript(dir);
  assert.equal(fs.readFileSync(path.join(dir, "transcription_originale.json"), "utf8"), '{"text":"original fictif"}');
  assert.equal(fs.statSync(file).mode & 0o077, 0);
  const destination = path.join(dir, "destination-invalide");
  fs.mkdirSync(destination);
  assert.throws(() => atomicWriteText(destination, "ne pas publier"));
  assert.equal(fs.readdirSync(dir).some((name) => name.endsWith(".tmp")), false);
  assert.equal(fs.readFileSync(file, "utf8"), '{"text":"correction fictive"}');
});
