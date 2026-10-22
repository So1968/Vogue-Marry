#!/usr/bin/env node
// Crée directement une archive chiffrée sans .tar.gz temporaire en clair.
// Format compatible avec crypt-local-backup.mjs decrypt.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes, scryptSync, createCipheriv } from "node:crypto";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";

const passphrase = process.env.VOGUE_BACKUP_PASSPHRASE || "";
if (passphrase.length < 16) throw new Error("VOGUE_BACKUP_PASSPHRASE doit contenir au moins 16 caractères.");
const source = path.join(os.homedir(), "VOGUE-MERRY-DONNEES");
const destination = path.resolve(process.argv[2] || path.join(os.homedir(), "VOGUE-MERRY-SAUVEGARDES"));
if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) throw new Error("Données absentes : " + source);
if (destination === source || destination.startsWith(source + path.sep)) throw new Error("Destination à l'intérieur des données interdite.");
fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
const timestamp = new Date().toISOString().replace(/[:.]/gu, "-");
const target = path.join(destination, "vogue-merry-" + timestamp + ".tar.gz.enc");
const temp = target + ".partial";
if (fs.existsSync(target) || fs.existsSync(temp)) throw new Error("Destination existante.");
const header = Buffer.concat([Buffer.from("VMBACK01"), randomBytes(16), randomBytes(12)]);
const key = scryptSync(passphrase, header.subarray(8, 24), 32);
const cipher = createCipheriv("aes-256-gcm", key, header.subarray(24, 36));
cipher.setAAD(header);
const tar = spawn("tar", ["-czf", "-", "-C", path.dirname(source), path.basename(source)], {
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
  await pipeline(tar.stdout, cipher, fs.createWriteStream(temp, { flags: "a", mode: 0o600 }));
  await stopped;
  if (exitCode !== 0) throw new Error("Échec création archive : " + stderr);
  fs.appendFileSync(temp, cipher.getAuthTag());
  fs.renameSync(temp, target);
  fs.chmodSync(target, 0o600);
  console.log(JSON.stringify({ status: "encrypted", archive: target, unencryptedIntermediate: false, sourceUntouched: true }));
} catch (error) {
  tar.kill();
  throw error;
} finally {
  if (fs.existsSync(temp)) fs.unlinkSync(temp);
}
