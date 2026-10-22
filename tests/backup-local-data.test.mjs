import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

test("sauvegarde : archive vérifiée hors source et fichier d'origine inchangé", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vogue-backup-test-"));
  try {
    const source = path.join(home, "VOGUE-MERRY-DONNEES");
    fs.mkdirSync(source);
    const original = path.join(source, "memoire-fictive.txt");
    fs.writeFileSync(original, "Contenu fictif pour vérification.");
    const output = spawnSync(process.execPath, ["scripts/backup-local-data.mjs"], {
      cwd: process.cwd(), env: { ...process.env, HOME: home }, encoding: "utf8"
    });
    assert.equal(output.status, 0, output.stderr);
    const info = JSON.parse(output.stdout);
    assert.equal(info.status, "verified");
    assert.ok(fs.existsSync(info.archive));
    assert.equal(fs.readFileSync(original, "utf8"), "Contenu fictif pour vérification.");
    assert.equal(createHash("sha256").update(fs.readFileSync(info.archive)).digest("hex"), info.sha256);
    const listing = spawnSync("tar", ["-tzf", info.archive], { encoding: "utf8" });
    assert.equal(listing.status, 0);
    assert.match(listing.stdout, /VOGUE-MERRY-DONNEES\/memoire-fictive\.txt/u);
    const invalid = spawnSync(process.execPath, ["scripts/backup-local-data.mjs", source], {
      cwd: process.cwd(), env: { ...process.env, HOME: home }, encoding: "utf8"
    });
    assert.notEqual(invalid.status, 0, "Sauvegarder sur le dossier source doit être refusé.");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
