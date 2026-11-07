import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { safeSegment, safePathInside } from "../backend/lib/path-guards.js";

test("un segment local valide est préservé sans réécriture", () => {
  assert.equal(safeSegment("ile_test"), "ile_test");
  assert.equal(safeSegment("  ile_test  "), "ile_test");
  assert.equal(safeSegment("nom de dossier"), "nom de dossier");
});

test("refuse les traversées et segments dangereux", () => {
  for (const value of ["", ".", "..", "../secret", "ile/secret", "ile\\secret", "ile..secret", "ile\0secret"]) {
    assert.equal(safeSegment(value), "", JSON.stringify(value));
  }
});

test("les chemins restent strictement à l'intérieur du répertoire autorisé", () => {
  const root = path.join(os.tmpdir(), "vogue-racine-test");
  assert.equal(safePathInside(root, "ile_test", "journal.md"), path.join(root, "ile_test", "journal.md"));
  assert.throws(() => safePathInside(root, "..", "secret.txt"), /Chemin de données invalide/u);
  assert.throws(() => safePathInside(root, ".."), /Chemin de données invalide/u);
  assert.throws(() => safePathInside(root), /Chemin de données invalide/u);
});

test("refuse les traversées Unicode qui deviennent dangereuses après NFKC", () => {
  for (const candidate of [
    "\uFF0E\uFF0E",
    "\uFF0E\uFF0E/secret",
    "\uFF0E\uFF0E\uFF0Fsecret",
    "ile\uFF0Fsecret",
    "ile\uFF3Csecret",
    "ile\u2024\u2024secret"
  ]) {
    assert.equal(safeSegment(candidate), "", JSON.stringify(candidate));
  }
});

test("préserve les noms Unicode normaux et accents existants", () => {
  for (const candidate of ["Réunion d’équipe", "Île-test", "équipage", "会議"]) {
    assert.equal(safeSegment(candidate), candidate);
  }
});

test("refuse les caractères de contrôle et de direction bidi", () => {
  for (const candidate of [
    "ile\u0001test",
    "ile\u001Ftest",
    "ile\u007Ftest",
    "ile\u202Etest",
    "ile\u202Atest",
    "ile\u2066test",
    "ile\u2069test"
  ]) {
    assert.equal(safeSegment(candidate), "", JSON.stringify(candidate));
  }
});

test("confinement physique : dossiers liés, jonctions Windows et chemins non créés", async (t) => {
  const fs = await import("node:fs");
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "vogue-path-physique-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, "racine");
  const outside = path.join(base, "hors-racine");
  fs.mkdirSync(root); fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(root, "alias"), process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => safePathInside(root, "alias", "nouveau", "journal.md"), /Chemin de données invalide/u);
  assert.throws(() => safePathInside(root, "alias"), /Chemin de données invalide/u);
  assert.equal(safePathInside(root, "nouveau", "journal.md"), path.join(root, "nouveau", "journal.md"));
  assert.equal(fs.existsSync(path.join(outside, "nouveau")), false);
});

test("confinement physique : liens de fichiers et liens cassés refusés sans toucher aux sources", {
  skip: process.platform === "win32"
}, async (t) => {
  const fs = await import("node:fs");
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "vogue-path-fichier-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, "racine"); fs.mkdirSync(root);
  const outside = path.join(base, "original-fictif.txt"); fs.writeFileSync(outside, "ORIGINAL_FICTIF");
  fs.symlinkSync(outside, path.join(root, "journal.md"));
  fs.symlinkSync(path.join(base, "absent"), path.join(root, "casse"));
  assert.throws(() => safePathInside(root, "journal.md"), /Chemin de données invalide/u);
  assert.throws(() => safePathInside(root, "casse", "nouveau.md"), /Chemin de données invalide/u);
  assert.equal(fs.readFileSync(outside, "utf8"), "ORIGINAL_FICTIF");
});

test("confinement physique : les alias internes et une racine explicitement liée restent utilisables", async (t) => {
  const fs = await import("node:fs");
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "vogue-path-alias-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, "racine"); fs.mkdirSync(root);
  const folder = path.join(root, "dossier"); fs.mkdirSync(folder);
  const kind = process.platform === "win32" ? "junction" : "dir";
  fs.symlinkSync(folder, path.join(root, "alias"), kind);
  assert.equal(safePathInside(root, "alias", "futur.md"), path.join(root, "alias", "futur.md"));
  fs.symlinkSync(root, path.join(base, "racine-liee"), kind);
  assert.equal(safePathInside(path.join(base, "racine-liee"), "dossier", "futur.md"), path.join(base, "racine-liee", "dossier", "futur.md"));
});

test("les partitions de mémoire ne peuvent pas se rediriger entre elles", async (t) => {
  const fs = await import("node:fs");
  const { createDataPath } = await import("../backend/lib/path-guards.js");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vogue-partitions-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const projects = path.join(root, "projets"); const incoming = path.join(root, "entree");
  fs.mkdirSync(projects); fs.mkdirSync(incoming);
  fs.symlinkSync(incoming, path.join(projects, "alias"), process.platform === "win32" ? "junction" : "dir");
  const guarded = createDataPath(root, ["projets", "entree"]);
  assert.throws(() => guarded(projects, "alias", "futur.md"), /Chemin de données invalide/u);
  assert.equal(guarded(incoming, "futur.md"), path.join(incoming, "futur.md"));
});
