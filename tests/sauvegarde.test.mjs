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
