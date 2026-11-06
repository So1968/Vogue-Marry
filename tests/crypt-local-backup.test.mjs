import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

test("chiffrement sauvegarde : aller-retour, mauvais secret, corruption et sources intactes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vogue-crypto-test-"));
  try {
    const file = path.join(root, "fictif.tar.gz");
    const data = Buffer.from("AUDIO_FICTIF_" + "12345".repeat(10000));
    fs.writeFileSync(file, data);
    const env = { ...process.env, VOGUE_BACKUP_PASSPHRASE: "SecretDeTestLongEtFictif2026!" };
    const run = (op, target, settings = env) => spawnSync(process.execPath,
      ["scripts/crypt-local-backup.mjs", op, target], { env: settings, encoding: "utf8" });
    assert.equal(run("encrypt", file).status, 0);
    const encrypted = file + ".enc";
    assert.ok(fs.existsSync(encrypted));
    assert.notDeepEqual(fs.readFileSync(encrypted), data);
    const wrong = run("decrypt", encrypted, { ...env, VOGUE_BACKUP_PASSPHRASE: "AutreSecretLongEtFictif2026!" });
    assert.notEqual(wrong.status, 0);
    assert.equal(fs.existsSync(file + ".decrypted"), false);
    assert.equal(run("decrypt", encrypted).status, 0);
    assert.deepEqual(fs.readFileSync(file + ".decrypted"), data);
    const altered = path.join(root, "altered.enc");
    const bytes = fs.readFileSync(encrypted);
    bytes[48] ^= 1;
    fs.writeFileSync(altered, bytes);
    assert.notEqual(run("decrypt", altered).status, 0);
    assert.equal(fs.existsSync(path.join(root, "altered.decrypted")), false);
    assert.deepEqual(fs.readFileSync(file), data);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("chiffrement : fichier vide, en-tête altéré et troncature sans sortie partielle", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vogue-crypto-vide-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "vide");
  fs.writeFileSync(file, "");
  const env = { ...process.env, VOGUE_BACKUP_PASSPHRASE: "SecretFictifPourTestsSeulement2026" };
  const run = (operation, target) => spawnSync(process.execPath, ["scripts/crypt-local-backup.mjs", operation, target], { env, encoding: "utf8" });
  assert.equal(run("encrypt", file).status, 0);
  assert.equal(run("decrypt", file + ".enc").status, 0);
  assert.equal(fs.statSync(file + ".decrypted").size, 0);
  const bytes = fs.readFileSync(file + ".enc");
  for (const [index, altered] of [bytes.subarray(0, 40), Buffer.from(bytes)].entries()) {
    if (index === 1) altered[10] ^= 1;
    const corrupt = path.join(root, `corrompu-${index}.enc`);
    fs.writeFileSync(corrupt, altered);
    assert.notEqual(run("decrypt", corrupt).status, 0);
    assert.equal(fs.existsSync(corrupt.replace(/\.enc$/u, ".decrypted")), false);
  }
  assert.equal(fs.readdirSync(root).some((name) => name.startsWith(".vogue-crypt-")), false);
});
