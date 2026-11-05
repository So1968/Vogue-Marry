import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

function physicalPath(candidate) {
  try { return fs.realpathSync(candidate); } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const parent = path.dirname(candidate);
    if (parent === candidate) throw error;
    return path.join(physicalPath(parent), path.basename(candidate));
  }
}

export function assertOutsideDirectory(source, destination) {
  const realSource = physicalPath(path.resolve(source));
  const realDestination = physicalPath(path.resolve(destination));
  if (realDestination === realSource || realDestination.startsWith(realSource + path.sep)) {
    throw new Error("La sauvegarde ou restauration doit être placée en dehors des données originales, même via un lien symbolique.");
  }
}

export function prepareBackupDestination(source, destination) {
  assertOutsideDirectory(source, destination);
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  assertOutsideDirectory(source, destination);
}

// Le vérificateur de restauration refuse ces types : ne pas annoncer une
// sauvegarde récupérable lorsqu'elle contiendrait des liens ou fichiers spéciaux.
export function checkBackupSource(source) {
  const stat = fs.lstatSync(source);
  if (stat.isFile()) return;
  if (!stat.isDirectory()) throw new Error("Source non sauvegardable : lien ou fichier spécial interdit.");
  for (const name of fs.readdirSync(source)) checkBackupSource(path.join(source, name));
}

export async function sha256File(file) {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

// link échoue si la destination existe, même si elle apparaît après le contrôle.
export function publishBackup(temporary, target) {
  fs.linkSync(temporary, target);
  fs.unlinkSync(temporary);
}
