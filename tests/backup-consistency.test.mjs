import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { sourceManifest, requireUnchangedSource } from "../scripts/lib/backup-consistency.mjs";

function setup(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vogue-backup-consistency-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const source = path.join(home, "VOGUE-MERRY-DONNEES");
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, "source-fictive.txt"), "AAA");
  return { home, source };
}

test("sauvegarde : même taille, ajout ou retrait de fichier changent le manifeste", async (t) => {
  const { source } = setup(t);
  const before = await sourceManifest(source);
  fs.writeFileSync(path.join(source, "source-fictive.txt"), "BBB");
  await assert.rejects(requireUnchangedSource(source, before), /Données modifiées/u);
  fs.writeFileSync(path.join(source, "source-fictive.txt"), "AAA");
  fs.writeFileSync(path.join(source, "nouveau-fictif.txt"), "NOUVEAU");
  await assert.rejects(requireUnchangedSource(source, before), /Données modifiées/u);
  fs.unlinkSync(path.join(source, "nouveau-fictif.txt"));
  fs.unlinkSync(path.join(source, "source-fictive.txt"));
  await assert.rejects(requireUnchangedSource(source, before), /Données modifiées/u);
});

for (const script of ["scripts/backup-local-data.mjs", "scripts/backup-encrypted-local-data.mjs"]) {
  test(`sauvegarde : mutation après archivage interdit la publication (${path.basename(script)})`, (t) => {
    const { home, source } = setup(t);
    const bin = path.join(home, "bin");
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "tar"), '#!/bin/sh\n/usr/bin/tar "$@"\nresult=$?\ncase "$*" in *--create*|*-czf*) printf BBB > "$VOGUE_TEST_SOURCE";; esac\nexit "$result"\n', { mode: 0o700 });
    const run = spawnSync(process.execPath, [script], { encoding: "utf8", env: {
      ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`,
      VOGUE_TEST_SOURCE: path.join(source, "source-fictive.txt"), VOGUE_BACKUP_PASSPHRASE: "SecretFictifLongPourTests2026"
    } });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /Archive différente|Données modifiées/u);
    assert.equal(fs.readFileSync(path.join(source, "source-fictive.txt"), "utf8"), "BBB", "Ne pas revenir sur les écritures de l'utilisateur.");
    assert.deepEqual(fs.readdirSync(path.join(home, "VOGUE-MERRY-SAUVEGARDES")), [], "Aucune sortie finale ou partielle après refus.");
  });
}
