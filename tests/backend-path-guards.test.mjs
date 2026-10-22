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
