import fs from "node:fs";
import path from "node:path";
import { createDecipheriv } from "node:crypto";
import { spawnTar } from "./tar-runtime.mjs";
import { pipeline } from "node:stream/promises";
import { sha256File } from "./backup-safety.mjs";

export async function sourceManifest(source) {
  const entries = [];
  async function walk(file, relative) {
    const before = fs.lstatSync(file, { bigint: true });
    if (before.isDirectory()) {
      entries.push({ path: relative, type: "directory", mode: Number(before.mode & 0o777n) });
      for (const name of fs.readdirSync(file).sort()) await walk(path.join(file, name), `${relative}/${name}`);
    } else if (before.isFile()) {
      entries.push({ path: relative, type: "file", size: String(before.size),
        mode: Number(before.mode & 0o777n), sha256: await sha256File(file) });
    } else throw new Error("Source non sauvegardable : lien ou fichier spécial interdit.");
    const after = fs.lstatSync(file, { bigint: true });
    if (before.ino !== after.ino || before.size !== after.size ||
        before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) {
      throw new Error("Données modifiées pendant le contrôle de sauvegarde. Arrêter les écritures puis réessayer.");
    }
  }
  await walk(source, ".");
  return entries;
}

export async function requireUnchangedSource(source, before) {
  const after = await sourceManifest(source);
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error("Données modifiées pendant la sauvegarde. Archive non publiée ; arrêter les écritures puis réessayer.");
  }
}

// Comparaison des octets archivés avec la source, sans extraction ni fichier clair
// intermédiaire, y compris pour la sauvegarde AES-GCM directement chiffrée.
export async function compareBackupToSource(source, archive, encryption = null) {
  const tar = spawnTar(["--compare", "--gzip", "--file", "-", "--directory", path.dirname(source)], {
    stdio: ["pipe", "ignore", "pipe"]
  });
  let stderr = "";
  tar.stderr.on("data", (buffer) => { stderr = (stderr + String(buffer)).slice(-4096); });
  const stopped = new Promise((resolve, reject) => {
    tar.on("error", reject);
    tar.on("close", resolve);
  });
  const timeout = setTimeout(() => tar.kill("SIGKILL"), 120_000);
  timeout.unref();
  try {
    let transfer;
    if (encryption) {
      const size = fs.statSync(archive).size;
      const decipher = createDecipheriv("aes-256-gcm", encryption.key, encryption.header.subarray(24, 36));
      decipher.setAAD(encryption.header);
      decipher.setAuthTag(encryption.tag);
      transfer = pipeline(fs.createReadStream(archive, { start: 36, end: size - 17 }), decipher, tar.stdin);
    } else transfer = pipeline(fs.createReadStream(archive), tar.stdin);
    const [, code] = await Promise.all([transfer, stopped]);
    if (code !== 0) throw new Error("Archive différente des données sources ou contrôle impossible : " + stderr);
  } catch (error) {
    tar.kill("SIGKILL");
    throw error;
  } finally { clearTimeout(timeout); }
}
