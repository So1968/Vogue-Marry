import { safePathInside } from "./path-guards.js";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export function atomicWriteText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.transcription-${randomUUID()}.tmp`);
  try {
    const fd = fs.openSync(temporary, "wx", 0o600);
    try {
      fs.writeFileSync(fd, text, "utf8");
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, file);
  } finally { fs.rmSync(temporary, { force: true }); }
}

export function preserveOriginalTranscript(dir) {
  const source = path.join(dir, "transcription.json");
  const original = path.join(dir, "transcription_originale.json");
  try { fs.copyFileSync(source, original, fs.constants.COPYFILE_EXCL); } catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (!fs.lstatSync(original).isFile()) throw new Error("Transcription originale non régulière.", { cause: error });
  }
}

// Snapshot avant toute correction : si une copie échoue, ne pas commencer les écrits.
export function snapshotTranscript({ dir, meetingDir, reason }) {
  const root = safePathInside(dir, "99_versions");
  fs.mkdirSync(root, { recursive: true });
  const snapshot = fs.mkdtempSync(path.join(root, "transcription-"));
  try {
    const groups = [
      [dir, "moteur", ["transcription.json", "transcription.md", "status.json"]],
      [meetingDir, "escale", ["transcription_v6.json", "transcription_v6.md", "journal_de_bord_exporte.md", "donnees_escale.json"]]
    ];
    for (const [sourceDir, label, files] of groups) {
      if (!sourceDir) continue;
      const destination = path.join(snapshot, label);
      fs.mkdirSync(destination);
      for (const file of files) {
        const source = path.join(sourceDir, file);
        if (!fs.existsSync(source)) continue;
        if (!fs.lstatSync(source).isFile()) throw new Error("Source de transcription non régulière.");
        fs.copyFileSync(source, path.join(destination, file), fs.constants.COPYFILE_EXCL);
      }
    }
    atomicWriteText(path.join(snapshot, "version.json"), JSON.stringify({ reason, createdAt: new Date().toISOString() }));
    return snapshot;
  } catch (error) {
    fs.rmSync(snapshot, { recursive: true, force: true });
    throw error;
  }
}
