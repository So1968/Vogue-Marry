import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { spawnTarSync } from "../scripts/lib/tar-runtime.mjs";

const password = "Phrase-Fictive-Recette-2026-Longue";

test("sauvegardes : GNU tar absent ou incompatible refuse avant création de destination", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vogue-tar-missing-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  for (const script of ["backup-local-data.mjs", "backup-encrypted-local-data.mjs"]) {
    const result = spawnSync(process.execPath, ["scripts/" + script], { encoding: "utf8", env: {
      ...process.env, HOME: home, USERPROFILE: home, VOGUE_TAR_PATH: process.execPath,
      VOGUE_BACKUP_PASSPHRASE: password
    } });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /GNU tar est requis/u);
    assert.deepEqual(fs.readdirSync(home), []);
  }
});

test("sauvegardes natives : archive, chiffrement, refus altération et restauration sur chemin avec espaces", { timeout: 120000 }, (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vogue backup fictif "));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const source = path.join(home, "VOGUE-MERRY-DONNEES");
  const project = path.join(source, "01_PROJETS", "Projet fictif");
  fs.mkdirSync(project, { recursive: true });
  const bytes = Buffer.from([0, 255, 1, 128, 42]);
  fs.writeFileSync(path.join(project, "audio-fictif.bin"), bytes);
  fs.writeFileSync(path.join(project, "réunion fictive.md"), "Décision fictive — aucun participant réel.\n");
  const env = { ...process.env, HOME: home, USERPROFILE: home, VOGUE_BACKUP_PASSPHRASE: password };
  const run = (script, args = [], overrides = {}) => spawnSync(process.execPath, ["scripts/" + script, ...args], {
    env: { ...env, ...overrides }, encoding: "utf8", timeout: 60000
  });
  const plain = run("backup-local-data.mjs");
  assert.equal(plain.status, 0, plain.stderr);
  const plainFile = JSON.parse(plain.stdout).archive;
  const plainCheck = run("verify-local-backup.mjs", [plainFile]);
  assert.equal(plainCheck.status, 0, plainCheck.stderr);
  const encrypted = run("backup-encrypted-local-data.mjs");
  assert.equal(encrypted.status, 0, encrypted.stderr);
  const encryptedFile = JSON.parse(encrypted.stdout).archive;
  const output = encryptedFile.replace(/\.enc$/u, "") + ".decrypted";
  const wrong = run("crypt-local-backup.mjs", ["decrypt", encryptedFile], { VOGUE_BACKUP_PASSPHRASE: password + "incorrect" });
  assert.notEqual(wrong.status, 0);
  assert.equal(fs.existsSync(output), false);
  const altered = encryptedFile + ".altered.enc";
  const data = fs.readFileSync(encryptedFile);
  data[40] ^= 1;
  fs.writeFileSync(altered, data);
  assert.notEqual(run("crypt-local-backup.mjs", ["decrypt", altered]).status, 0);
  assert.equal(fs.existsSync(altered.replace(/\.enc$/u, "") + ".decrypted"), false);
  const decrypted = run("crypt-local-backup.mjs", ["decrypt", encryptedFile]);
  assert.equal(decrypted.status, 0, decrypted.stderr);
  const restoredArchive = path.join(home, "restauration fictive.tar.gz");
  fs.copyFileSync(output, restoredArchive);
  fs.writeFileSync(restoredArchive + ".sha256", createHash("sha256").update(fs.readFileSync(output)).digest("hex"));
  const restored = run("verify-local-backup.mjs", [restoredArchive]);
  assert.equal(restored.status, 0, restored.stderr);
  assert.equal(JSON.parse(restored.stdout).status, "restorable");
  const recovered = spawnTarSync(["-xOzf", restoredArchive, "VOGUE-MERRY-DONNEES/01_PROJETS/Projet fictif/audio-fictif.bin"]);
  assert.equal(recovered.status, 0, String(recovered.stderr));
  assert.deepEqual(recovered.stdout, bytes, "Les octets récupérés correspondent à l'original fictif.");
  assert.deepEqual(fs.readFileSync(path.join(project, "audio-fictif.bin")), bytes);
  assert.equal(fs.readFileSync(path.join(project, "réunion fictive.md"), "utf8"), "Décision fictive — aucun participant réel.\n");
  assert.equal(fs.readdirSync(path.dirname(encryptedFile)).some((name) => name.endsWith(".partial") || name.startsWith(".vogue-crypt-")), false);
});
