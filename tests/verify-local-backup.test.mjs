import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

test("restauration de contrôle : accepte archive intacte et rejette falsification", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vogue-restore-test-"));
  try {
    const folder = path.join(home, "VOGUE-MERRY-DONNEES");
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, "fictif.txt"), "exemple");
    const backup = spawnSync(process.execPath, ["scripts/backup-local-data.mjs"], {
      env: { ...process.env, HOME: home }, encoding: "utf8"
    });
    assert.equal(backup.status, 0, backup.stderr);
    const file = JSON.parse(backup.stdout).archive;
    const valid = spawnSync(process.execPath, ["scripts/verify-local-backup.mjs", file], { encoding: "utf8" });
    assert.equal(valid.status, 0, valid.stderr);
    assert.equal(JSON.parse(valid.stdout).status, "restorable");
    assert.equal(fs.readFileSync(path.join(folder, "fictif.txt"), "utf8"), "exemple");
    fs.appendFileSync(file, "altération");
    const invalid = spawnSync(process.execPath, ["scripts/verify-local-backup.mjs", file], { encoding: "utf8" });
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /SHA-256 différent/u);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
