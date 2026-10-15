import test from "node:test";
import assert from "node:assert/strict";
import { RESUME_KEY, readLastPosition, saveLastPosition } from "../src/features/projects/last-position.js";

function memoryStorage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test("reprendre la dernière rubrique après interruption", () => {
  const storage = memoryStorage();
  assert.equal(readLastPosition(storage), null);
  assert.equal(saveLastPosition(storage, "ile_projet_1", "manoeuvres"), true);
  assert.deepEqual(readLastPosition(storage), { slug: "ile_projet_1", section: "manoeuvres" });
  assert.equal(saveLastPosition(storage, "ile_projet_1", "journal"), true);
  assert.deepEqual(readLastPosition(storage), { slug: "ile_projet_1", section: "journal" });
});

test("ne pas accepter les positions falsifiées ou corrompues", () => {
  const storage = memoryStorage();
  storage.setItem(RESUME_KEY, "{invalide");
  assert.equal(readLastPosition(storage), null);
  for (const value of [
    { slug: "../autre", section: "carte" },
    { slug: "projet", section: "inconnue" },
    { slug: "", section: "cap" },
    { slug: ["a"], section: "carte" },
  ]) {
    storage.setItem(RESUME_KEY, JSON.stringify(value));
    assert.equal(readLastPosition(storage), null);
  }
  assert.equal(saveLastPosition(storage, "../invalide", "carte"), false);
  assert.equal(saveLastPosition(storage, "valide", "autre"), false);
});

test("reste utilisable quand le stockage local est bloqué", () => {
  const storage = { getItem() { throw new Error("bloqué"); }, setItem() { throw new Error("bloqué"); } };
  assert.equal(readLastPosition(storage), null);
  assert.equal(saveLastPosition(storage, "ile_test", "carte"), false);
});
