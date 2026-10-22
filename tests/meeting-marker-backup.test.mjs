import test from "node:test";
import assert from "node:assert/strict";
import { keepLocalMarkers, recoverLocalMarkers, clearLocalMarkers } from "../src/lib/meeting-marker-backup.js";

test("marqueurs : écrire, relire et supprimer uniquement après confirmation", () => {
  const saved = new Map();
  const previous = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => { saved.set(key, value); },
    removeItem: (key) => { saved.delete(key); }
  };
  try {
    const markers = [{ id: "marker-test", type: "decision", timeSeconds: 11 }];
    keepLocalMarkers("escale-fictive", markers);
    assert.deepEqual(recoverLocalMarkers("escale-fictive"), markers);
    assert.deepEqual(recoverLocalMarkers("autre-escale"), []);
    clearLocalMarkers("escale-fictive");
    assert.deepEqual(recoverLocalMarkers("escale-fictive"), []);
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
});

test("marqueurs : un refus du stockage ne doit pas être présenté comme une sauvegarde", () => {
  const previous = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => { throw new Error("QuotaExceededError"); },
    removeItem: () => {}
  };
  try {
    assert.throws(
      () => keepLocalMarkers("escale-fictive", [{ id: "test" }]),
      /QuotaExceededError/u
    );
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
});
