import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
test("sauvegarde chiffrée directe : aucune archive claire et restauration possible", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vogue-encrypted-backup-"));
  try {
    const source = path.join(home, "VOGUE-MERRY-DONNEES");
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, "essai-fictif.txt"), "contenu fictif");
    const env = { ...process.env, HOME: home, VOGUE_BACKUP_PASSPHRASE: "PhraseDeTestFictiveLongue2026" };
    const make = spawnSync(process.execPath, ["scripts/backup-encrypted-local-data.mjs"], { env, encoding: "utf8" });
    assert.equal(make.status, 0, make.stderr);
    const info = JSON.parse(make.stdout);
    assert.equal(info.unencryptedIntermediate, false);
    const files = fs.readdirSync(path.dirname(info.archive));
    assert.equal(files.length, 1);
    assert.ok(files[0].endsWith(".enc"));
    assert.equal(fs.statSync(info.archive).mode & 0o077, 0,
      "La sauvegarde chiffrée doit être privée des autres utilisateurs Linux.");
    const restore = spawnSync(process.execPath, ["scripts/crypt-local-backup.mjs", "decrypt", info.archive], {
      env, encoding: "utf8"
    });
    assert.equal(restore.status, 0, restore.stderr);
    const restored = JSON.parse(restore.stdout).file;
    const listing = spawnSync("tar", ["-tzf", restored], { encoding: "utf8" });
    assert.equal(listing.status, 0, listing.stderr);
    assert.match(listing.stdout, /essai-fictif\.txt/u);
    assert.equal(fs.readFileSync(path.join(source, "essai-fictif.txt"), "utf8"), "contenu fictif");
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
