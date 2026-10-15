import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const script = path.resolve("scripts/sauvegarde-donnees.mjs");
function run(...args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8", timeout: 15000 });
}

test("copie, vérification et restauration sur données fictives exclusivement", () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "vogue-restore-test-"));
  try {
    const source = path.join(sandbox, "source-fictive");
    const backup = path.join(sandbox, "sauvegarde-fictive");
    const restored = path.join(sandbox, "restauration-fictive");
    fs.mkdirSync(path.join(source, "01_PROJETS", "ile_test"), { recursive: true });
    fs.writeFileSync(path.join(source, "01_PROJETS", "ile_test", "notes.md"), "Projet fictif\n", "utf8");
    const copied = run("backup", source, backup);
    assert.equal(copied.status, 0, copied.stderr);
    const verified = run("verify", backup);
    assert.equal(verified.status, 0, verified.stderr);
    const restoredResult = run("restore", backup, restored);
    assert.equal(restoredResult.status, 0, restoredResult.stderr);
    assert.equal(fs.readFileSync(path.join(restored, "01_PROJETS", "ile_test", "notes.md"), "utf8"), "Projet fictif\n");
    const secondRestore = run("restore", backup, restored);
    assert.notEqual(secondRestore.status, 0, "Ne doit jamais écraser une restauration existante");
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});
