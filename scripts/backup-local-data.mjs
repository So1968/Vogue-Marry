#!/usr/bin/env node
// Sauvegarde non destructive des données locales. Aucune archive dans Git.
// Usage : node scripts/backup-local-data.mjs [dossier-destination]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const source = path.join(os.homedir(), "VOGUE-MERRY-DONNEES");
const destination = path.resolve(process.argv[2] || path.join(os.homedir(), "VOGUE-MERRY-SAUVEGARDES"));
if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
  throw new Error("Dossier de données Vogue Merry introuvable : " + source);
}
if (destination === source || destination.startsWith(source + path.sep)) {
  throw new Error("La sauvegarde doit être placée en dehors des données originales.");
}
fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const target = path.join(destination, "vogue-merry-" + stamp + ".tar.gz");
const temporary = target + ".partial";
try {
  const proc = spawnSync("tar", [
    "--create", "--gzip", "--file", temporary,
    "--directory", path.dirname(source), path.basename(source)
  ], { encoding: "utf8", timeout: 120_000 });
  if (proc.status !== 0) throw new Error("Archive impossible : " + (proc.stderr || proc.error?.message || proc.status));
  const check = spawnSync("tar", ["--list", "--gzip", "--file", temporary], { encoding: "utf8", timeout: 120_000 });
  if (check.status !== 0 || !check.stdout.includes("VOGUE-MERRY-DONNEES/")) {
    throw new Error("Archive illisible ou contenu inattendu.");
  }
  const sha256 = createHash("sha256").update(fs.readFileSync(temporary)).digest("hex");
  fs.renameSync(temporary, target);
  fs.chmodSync(target, 0o600);
  const checksumFile = target + ".sha256";
  fs.writeFileSync(checksumFile, sha256 + "  " + path.basename(target) + "\n", { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ status: "verified", archive: target, sha256, checksumFile, originalUntouched: true }, null, 2));
} finally {
  if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
}
