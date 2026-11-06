import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { publishBackup } from "../scripts/lib/backup-safety.mjs";

const scripts = ["scripts/backup-local-data.mjs", "scripts/backup-encrypted-local-data.mjs"];
function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vogue-backup-safety-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const source = path.join(home, "VOGUE-MERRY-DONNEES");
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, "source-fictive.txt"), "SOURCE_FICTIVE_INTACTE");
  const env = { ...process.env, HOME: home, VOGUE_BACKUP_PASSPHRASE: "SecretFictifPourTestsSeulement2026" };
  return { home, source, env };
}

test("sauvegardes : refus des destinations cachées dans les données via un lien", (t) => {
  const { home, source, env } = fixture(t);
  const alias = path.join(home, "alias-donnees");
  fs.symlinkSync(source, alias, "dir");
  for (const script of scripts) {
    for (const destination of [alias, path.join(alias, "nouveau", "sous-dossier")]) {
      const run = spawnSync(process.execPath, [script, destination], { env, encoding: "utf8" });
      assert.notEqual(run.status, 0);
      assert.match(run.stderr, /en dehors des données originales/u);
      assert.deepEqual(fs.readdirSync(source), ["source-fictive.txt"]);
    }
  }
});

test("sauvegardes : refus des liens et fichiers spéciaux avant création d'archive", (t) => {
  const { home, source, env } = fixture(t);
  const link = path.join(source, "lien-fictif");
  fs.symlinkSync("source-fictive.txt", link);
  for (const script of scripts) {
    const run = spawnSync(process.execPath, [script], { env, encoding: "utf8" });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /lien ou fichier spécial interdit/u);
    assert.equal(fs.existsSync(path.join(home, "VOGUE-MERRY-SAUVEGARDES")), false);
  }
  fs.unlinkSync(link);
  const fifo = path.join(source, "tube-fictif");
  assert.equal(spawnSync("mkfifo", [fifo]).status, 0);
  for (const script of scripts) {
    const run = spawnSync(process.execPath, [script], { env, encoding: "utf8", timeout: 5000 });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /lien ou fichier spécial interdit/u);
  }
});

test("publication : ne remplace jamais une archive apparue entre contrôle et publication", (t) => {
  const { home } = fixture(t);
  const temporary = path.join(home, "nouvelle.partial");
  const target = path.join(home, "existante.enc");
  fs.writeFileSync(temporary, "NOUVELLE");
  fs.writeFileSync(target, "ARCHIVE_PRECEDENTE");
  assert.throws(() => publishBackup(temporary, target), { code: "EEXIST" });
  assert.equal(fs.readFileSync(target, "utf8"), "ARCHIVE_PRECEDENTE");
  assert.equal(fs.readFileSync(temporary, "utf8"), "NOUVELLE");
});

test("archive claire : temporaire privé dès sa création et liens physiques restaurables", (t) => {
  const { home, source, env } = fixture(t);
  fs.linkSync(path.join(source, "source-fictive.txt"), path.join(source, "copie-physique.txt"));
  fs.writeFileSync(path.join(source, "notes..md"), "Nom valide avec deux points");
  const bin = path.join(home, "bin");
  fs.mkdirSync(bin);
  const modeFile = path.join(home, "mode-temporaire");
  // Observer les droits avant l'écriture de tar, pas seulement ceux du résultat final.
  fs.writeFileSync(path.join(bin, "tar"), '#!/bin/sh\nif [ "$1" = "--create" ]; then stat -c %a "$5" > "$VOGUE_TEST_MODE_FILE"; fi\nexec /usr/bin/tar "$@"\n', { mode: 0o700 });
  const run = spawnSync(process.execPath, [scripts[0]], {
    env: { ...env, PATH: `${bin}:${env.PATH}`, VOGUE_TEST_MODE_FILE: modeFile }, encoding: "utf8"
  });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(fs.readFileSync(modeFile, "utf8").trim(), "600");
  const { archive } = JSON.parse(run.stdout);
  const verify = spawnSync(process.execPath, ["scripts/verify-local-backup.mjs", archive], { env, encoding: "utf8" });
  assert.equal(verify.status, 0, verify.stderr);
  assert.equal(fs.readFileSync(path.join(source, "source-fictive.txt"), "utf8"), "SOURCE_FICTIVE_INTACTE");
});

test("restauration : un alias ne permet pas d'écrire dans les données actives", (t) => {
  const { home, source, env } = fixture(t);
  const backup = path.join(home, "sauvegarde-fictive");
  const script = "scripts/sauvegarde-donnees.mjs";
  const saved = spawnSync(process.execPath, [script, "backup", source, backup], { env, encoding: "utf8" });
  assert.equal(saved.status, 0, saved.stderr);
  const alias = path.join(home, "alias-source");
  fs.symlinkSync(source, alias, "dir");
  const restored = spawnSync(process.execPath, [script, "restore", backup, path.join(alias, "nouveau")], { env, encoding: "utf8" });
  assert.notEqual(restored.status, 0);
  assert.match(restored.stderr, /en dehors des données originales/u);
  assert.deepEqual(fs.readdirSync(source), ["source-fictive.txt"]);
  for (const command of ["backup", "backup-next"]) {
    const denied = spawnSync(process.execPath, [script, command, source, path.join(alias, "nouveau")], { env, encoding: "utf8" });
    assert.notEqual(denied.status, 0);
    assert.deepEqual(fs.readdirSync(source), ["source-fictive.txt"]);
  }
});
