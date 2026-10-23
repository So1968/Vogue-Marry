import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

test("diagnostic permissions : signale fichiers publics et ne modifie rien", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vogue-audit-permissions-"));
  try {
    const root = path.join(home, "VOGUE-MERRY-DONNEES");
    fs.mkdirSync(root, { mode: 0o700 });
    const privateFile = path.join(root, "prive.txt");
    fs.writeFileSync(privateFile, "ficitif", { mode: 0o600 });
    const publicFile = path.join(root, "public.txt");
    fs.writeFileSync(publicFile, "fictif", { mode: 0o644 });
    fs.chmodSync(publicFile, 0o644);
    const command = spawnSync(process.execPath, ["scripts/audit-local-permissions.mjs"], {
      env: { ...process.env, HOME: home }, encoding: "utf8"
    });
    assert.equal(command.status, 2);
    const report = JSON.parse(command.stdout);
    assert.equal(report.files, 2);
    assert.equal(report.filesAccessibleOutsideOwner, 1);
    assert.equal(fs.statSync(publicFile).mode & 0o777, 0o644);
    assert.doesNotMatch(command.stdout, /public.txt|fictif|prive.txt/u);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
