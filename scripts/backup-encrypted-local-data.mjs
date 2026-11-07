#!/usr/bin/env node
// Crée directement une archive chiffrée sans .tar.gz temporaire en clair.
// Format compatible avec crypt-local-backup.mjs decrypt.
import fs from "node:fs";
import { sourceManifest, requireUnchangedSource, compareBackupToSource } from "./lib/backup-consistency.mjs";
import os from "node:os";
import path from "node:path";
import { randomUUID, randomBytes, scryptSync, createCipheriv } from "node:crypto";
import { spawnTar, tarRuntime } from "./lib/tar-runtime.mjs";
import { pipeline } from "node:stream/promises";
import { prepareBackupDestination, checkBackupSource, publishBackup } from "./lib/backup-safety.mjs";

const passphrase = process.env.VOGUE_BACKUP_PASSPHRASE || "";
if (passphrase.length < 16) throw new Error("VOGUE_BACKUP_PASSPHRASE doit contenir au moins 16 caractères.");
tarRuntime();
const source = path.join(os.homedir(), "VOGUE-MERRY-DONNEES");
const destination = path.resolve(process.argv[2] || path.join(os.homedir(), "VOGUE-MERRY-SAUVEGARDES"));
if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) throw new Error("Données absentes : " + source);
checkBackupSource(source);
prepareBackupDestination(source, destination);
const before = await sourceManifest(source);
const timestamp = new Date().toISOString().replace(/[:.]/gu, "-");
const target = path.join(destination, "vogue-merry-" + timestamp + "-" + randomUUID() + ".tar.gz.enc");
const temp = target + ".partial";
if (fs.existsSync(target) || fs.existsSync(temp)) throw new Error("Destination existante.");
const header = Buffer.concat([Buffer.from("VMBACK01"), randomBytes(16), randomBytes(12)]);
const key = scryptSync(passphrase, header.subarray(8, 24), 32);
const cipher = createCipheriv("aes-256-gcm", key, header.subarray(24, 36));
cipher.setAAD(header);
const tar = spawnTar(["--hard-dereference", "-czf", "-", "-C", path.dirname(source), path.basename(source)], {
  stdio: ["ignore", "pipe", "pipe"]
});
let stderr = "";
tar.stderr.on("data", (buffer) => { stderr += String(buffer); });
let exitCode = null;
const stopped = new Promise((resolve, reject) => {
  tar.on("error", reject);
  tar.on("close", (code) => { exitCode = code; resolve(); });
});
try {
  fs.writeFileSync(temp, header, { flag: "wx", mode: 0o600 });
  await Promise.all([
    pipeline(tar.stdout, cipher, fs.createWriteStream(temp, { flags: "a", mode: 0o600 })),
    stopped
  ]);
  if (exitCode !== 0) throw new Error("Échec création archive : " + stderr);
  const tag = cipher.getAuthTag();
  fs.appendFileSync(temp, tag);
  await compareBackupToSource(source, temp, { key, header, tag });
  await requireUnchangedSource(source, before);
  publishBackup(temp, target);
  fs.chmodSync(target, 0o600);
  console.log(JSON.stringify({ status: "encrypted", archive: target, unencryptedIntermediate: false, sourceUntouched: true }));
} catch (error) {
  tar.kill();
  throw error;
} finally {
  if (fs.existsSync(temp)) fs.unlinkSync(temp);
}
