#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const sourceDefault = path.join(os.homedir(), "VOGUE-MERRY-DONNEES");
const [command, first, second] = process.argv.slice(2);

function fail(message) { throw new Error(message); }
function hash(file) {
  const digest = crypto.createHash("sha256");
  const descriptor = fs.openSync(file, "r");
  const buffer = Buffer.alloc(1024 * 1024);
  try {
    let bytes;
    while ((bytes = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) {
      digest.update(buffer.subarray(0, bytes));
    }
  } finally { fs.closeSync(descriptor); }
  return digest.digest("hex");
}
function inspect(root) {
  const files = [];
  function walk(dir, prefix = "") {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relative = path.posix.join(prefix, entry.name);
      const absolute = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) fail(`Lien symbolique non sauvegardé : ${relative}`);
      if (entry.isDirectory()) walk(absolute, relative);
      else if (entry.isFile()) files.push({ path: relative, size: fs.statSync(absolute).size, sha256: hash(absolute) });
      else fail(`Entrée non prise en charge : ${relative}`);
    }
  }
  walk(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
function ensureNewDirectory(destination) {
  if (fs.existsSync(destination)) fail("Destination déjà existante : refus d'écraser des données.");
  fs.mkdirSync(destination, { recursive: false, mode: 0o700 });
}
function ensureNestedParent(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}
function manifestAt(backup) {
  const manifest = JSON.parse(fs.readFileSync(path.join(backup, "manifest.json"), "utf8"));
  if (manifest.version !== 1 || !Array.isArray(manifest.files)) fail("Manifeste non reconnu.");
  const seen = new Set();
  for (const f of manifest.files) {
    if (typeof f.path !== "string" || !f.path || path.isAbsolute(f.path) ||
        f.path.split("/").some((part) => !part || part === "." || part === "..") ||
        typeof f.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(f.sha256) ||
        !Number.isSafeInteger(f.size) || f.size < 0 || seen.has(f.path)) fail("Manifeste invalide.");
    seen.add(f.path);
  }
  return manifest;
}
function verify(backup) {
  const manifest = manifestAt(backup);
  const actual = inspect(path.join(backup, "donnees"));
  if (JSON.stringify(actual) !== JSON.stringify(manifest.files)) fail("Intégrité de la sauvegarde non vérifiée.");
  return manifest;
}
try {
  if (command === "backup-next") {
    if (!first || !second) fail("Usage : backup-next <source> <dossier-parent>");
    const source = path.resolve(first);
    const parent = path.resolve(second);
    if (!fs.statSync(source).isDirectory()) fail("Source introuvable.");
    if (parent === source || parent.startsWith(source + path.sep)) fail("Destination à placer hors de la source.");
    const files = inspect(source);
    fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
    const prefix = new Date().toISOString().replace(/[:.]/g, "-");
    const destination = fs.mkdtempSync(path.join(parent, `sauvegarde_${prefix}_`));
    fs.cpSync(source, path.join(destination, "donnees"), { recursive: true, errorOnExist: true, force: false, dereference: false });
    fs.writeFileSync(path.join(destination, "manifest.json"), JSON.stringify({ version: 1, files }, null, 2));
    verify(destination);
    console.log(`Sauvegarde vérifiée : ${files.length} fichier(s). ${destination}`);
  } else if (command === "backup") {
    const source = path.resolve(first || sourceDefault);
    const destination = second && path.resolve(second);
    if (!destination) fail("Usage : backup [source] <destination-nouvelle>");
    if (destination === source || destination.startsWith(source + path.sep)) fail("Destination à placer hors de la source.");
    if (!fs.statSync(source).isDirectory()) fail("Source introuvable.");
    const original = inspect(source);
    ensureNestedParent(path.dirname(destination));
    ensureNewDirectory(destination);
    const copyRoot = path.join(destination, "donnees");
    fs.cpSync(source, copyRoot, { recursive: true, errorOnExist: true, force: false, dereference: false });
    fs.writeFileSync(path.join(destination, "manifest.json"), JSON.stringify({ version: 1, files: original }, null, 2));
    verify(destination);
    console.log(`Sauvegarde vérifiée : ${original.length} fichier(s). ${destination}`);
  } else if (command === "verify") {
    if (!first) fail("Usage : verify <dossier-sauvegarde>");
    const manifest = verify(path.resolve(first));
    console.log(`Sauvegarde intègre : ${manifest.files.length} fichier(s).`);
  } else if (command === "restore") {
    if (!first || !second) fail("Usage : restore <dossier-sauvegarde> <destination-nouvelle>");
    const backup = path.resolve(first);
    const destination = path.resolve(second);
    if (destination === sourceDefault || destination.startsWith(sourceDefault + path.sep)) fail("Restauration dans les données actives interdite.");
    if (destination === backup || destination.startsWith(backup + path.sep)) fail("Restauration dans la sauvegarde interdite.");
    const manifest = verify(backup);
    ensureNestedParent(path.dirname(destination));
    ensureNewDirectory(destination);
    fs.cpSync(path.join(backup, "donnees"), destination, { recursive: true, force: false, errorOnExist: true });
    if (JSON.stringify(inspect(destination)) !== JSON.stringify(manifest.files)) fail("Vérification de restauration échouée.");
    console.log(`Restauration vérifiée : ${manifest.files.length} fichier(s). ${destination}`);
  } else fail("Commandes : backup-next, backup, verify, restore");
} catch (error) {
  console.error(`ERREUR : ${error.message}`);
  process.exitCode = 1;
}
