#!/usr/bin/env node
// Vérification de restauration : contrôle SHA-256 puis extraction vers dossier de test vide.
// N'écrase jamais ~/VOGUE-MERRY-DONNEES.
// Usage : node scripts/verify-local-backup.mjs /chemin/archive.tar.gz
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const file = path.resolve(process.argv[2] || "");
if (!process.argv[2] || !fs.existsSync(file) || !file.endsWith(".tar.gz")) {
  throw new Error("Indiquer une archive .tar.gz existante.");
}
const expectedFile = file + ".sha256";
if (!fs.existsSync(expectedFile)) throw new Error("Empreinte SHA-256 absente.");
const expectedLine = fs.readFileSync(expectedFile, "utf8").trim();
const expected = expectedLine.split(/\s+/u)[0];
if (!/^[a-f0-9]{64}$/u.test(expected)) throw new Error("Empreinte invalide.");
const actual = await new Promise((resolve, reject) => {
  const hash = createHash("sha256");
  const input = fs.createReadStream(file);
  input.on("data", (chunk) => hash.update(chunk));
  input.on("error", reject);
  input.on("end", () => resolve(hash.digest("hex")));
});
if (actual !== expected) throw new Error("Archive altérée : SHA-256 différent.");
const names = spawnSync("tar", ["-tzf", file], { encoding: "utf8" });
if (names.status !== 0) throw new Error("Archive illisible.");
const entries = names.stdout.trim().split("\n").filter(Boolean);
if (!entries.length || entries.some((name) => !name.startsWith("VOGUE-MERRY-DONNEES/") ||
  name.includes("..") || path.isAbsolute(name))) {
  throw new Error("Archive contient des chemins inattendus.");
}
// Une archive peut cacher un lien symbolique vers une cible extérieure.
// Refuser les liens et les fichiers spéciaux avant toute extraction.
const detailed = spawnSync("tar", ["-tvzf", file], { encoding: "utf8" });
if (detailed.status !== 0) throw new Error("Inventaire détaillé de l'archive impossible.");
for (const line of detailed.stdout.split("\n").filter(Boolean)) {
  const kind = line[0];
  if (kind !== "-" && kind !== "d") {
    throw new Error("Archive dangereuse : lien ou type de fichier spécial interdit.");
  }
}
for (const name of entries) {
  const components = name.split("/");
  if (components.some((part) => part === ".." || part === ".")) {
    throw new Error("Archive dangereuse : chemin relatif interdit.");
  }
}
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "vogue-restore-verify-"));
try {
  const extraction = spawnSync("tar", ["-xzf", file, "-C", workspace, "--no-same-owner"], { encoding: "utf8" });
  if (extraction.status !== 0) throw new Error("Extraction de contrôle impossible : " + extraction.stderr);
  const root = path.join(workspace, "VOGUE-MERRY-DONNEES");
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error("Dossier de données absent.");
  console.log(JSON.stringify({ status: "restorable", archive: file, entries: entries.length, originalUntouched: true }));
} finally {
  fs.rmSync(workspace, { recursive: true, force: true });
}
