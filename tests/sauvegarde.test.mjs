import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const script = path.resolve("scripts/sauvegarde-donnees.mjs");
function run(...args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
}

test("sauvegarde SHA256, contrôle, restauration et refus des écrasements", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vogue-save-"));
  try {
    const source = path.join(root, "source");
    const backup = path.join(root, "backup");
    const restored = path.join(root, "restored");
    fs.mkdirSync(path.join(source, "01_PROJETS", "alpha"), { recursive: true });
    fs.writeFileSync(path.join(source, "01_PROJETS", "alpha", "texte.md"), "Mémoire de Mateo");
    fs.writeFileSync(path.join(source, "01_PROJETS", "alpha", "audio.bin"), Buffer.from([0, 1, 42, 255]));
    assert.equal(run("backup", source, backup).status, 0);
    assert.equal(run("verify", backup).status, 0);
    assert.notEqual(run("backup", source, backup).status, 0);
    assert.equal(run("restore", backup, restored).status, 0);
    assert.equal(fs.readFileSync(path.join(restored, "01_PROJETS", "alpha", "texte.md"), "utf8"), "Mémoire de Mateo");
    assert.deepEqual(fs.readFileSync(path.join(restored, "01_PROJETS", "alpha", "audio.bin")), Buffer.from([0, 1, 42, 255]));
    assert.notEqual(run("restore", backup, restored).status, 0);
    assert.notEqual(run("restore", backup, path.join(backup, "restauration-interdite")).status, 0);
    assert.equal(fs.existsSync(path.join(backup, "restauration-interdite")), false);
    fs.writeFileSync(path.join(backup, "donnees", "01_PROJETS", "alpha", "texte.md"), "Altération");
    assert.notEqual(run("verify", backup).status, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("sauvegardes successives : deux copies restent distinctes et restaurables", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vogue-save-next-"));
  try {
    const source = path.join(root, "source");
    const parent = path.join(root, "archives");
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, "memo.txt"), "version une");
    assert.equal(run("backup-next", source, parent).status, 0);
    fs.writeFileSync(path.join(source, "memo.txt"), "version deux");
    assert.equal(run("backup-next", source, parent).status, 0);
    const backups = fs.readdirSync(parent).sort().map((name) => path.join(parent, name));
    assert.equal(backups.length, 2);
    for (const backup of backups) assert.equal(run("verify", backup).status, 0);
    const contents = backups.map((backup) => fs.readFileSync(path.join(backup, "donnees", "memo.txt"), "utf8")).sort();
    assert.deepEqual(contents, ["version deux", "version une"]);
    assert.notEqual(run("backup-next", source, path.join(source, "archives")).status, 0);
    assert.equal(fs.existsSync(path.join(source, "archives")), false);
    const restored = path.join(root, "restauration");
    assert.equal(run("restore", backups[0], restored).status, 0);
    assert.ok(contents.includes(fs.readFileSync(path.join(restored, "memo.txt"), "utf8")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
