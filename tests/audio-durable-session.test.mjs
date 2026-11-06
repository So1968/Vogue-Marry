import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import {
  rememberDurableAudioSession, recoverDurableAudioSession, keepCapturedAudioChunk,
  pendingAudioChunks, clearFinalizedAudioChunks, forgetDurableAudioSession,
  rememberAudioSession
} from "../src/lib/audio-chunk-queue.js";

const session = { sessionId: "session-fictive", projectName: "Projet fictif", projectSlug: "ile_fictive",
  meetingDirName: "escale_fictive", count: 0, finalizedCapture: false };
function setup(t, storage = {}) {
  const priorDb = globalThis.indexedDB;
  const priorStorage = globalThis.localStorage;
  globalThis.indexedDB = new IDBFactory();
  const values = new Map();
  globalThis.localStorage = { getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key), ...storage };
  t.after(() => {
    if (priorDb === undefined) delete globalThis.indexedDB; else globalThis.indexedDB = priorDb;
    if (priorStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = priorStorage;
  });
  return values;
}

test("audio durable : reprise sans localStorage et conservation du dernier fragment", async (t) => {
  setup(t, { getItem: () => { throw new Error("Accès interdit"); },
    setItem: () => { throw new Error("Quota dépassé"); }, removeItem: () => { throw new Error("Accès interdit"); } });
  await rememberDurableAudioSession(session);
  assert.equal((await recoverDurableAudioSession()).count, 0);
  await keepCapturedAudioChunk({ ...session, count: 99 }, 0, new Blob(["bloc-fictif"]));
  assert.equal((await recoverDurableAudioSession()).count, 1, "Le compteur suit le bloc validé, pas l'état mutable en mémoire.");
  await keepCapturedAudioChunk(session, 1, new Blob(["dernier-bloc-fictif"]));
  assert.equal((await recoverDurableAudioSession()).count, 2);
  assert.deepEqual(await Promise.all((await pendingAudioChunks(session.sessionId)).map((chunk) => chunk.blob.text())),
    ["bloc-fictif", "dernier-bloc-fictif"]);
  await rememberDurableAudioSession({ ...session, count: 2, finalizedCapture: true });
  assert.equal((await recoverDurableAudioSession()).finalizedCapture, true);
});

test("audio durable : une transaction avortée ne fait pas avancer le compteur", async (t) => {
  setup(t);
  await rememberDurableAudioSession(session);
  await keepCapturedAudioChunk(session, 0, new Blob(["original-fictif"]));
  await assert.rejects(keepCapturedAudioChunk(session, 0, new Blob(["autre-fictif"])), { name: "ConstraintError" });
  assert.equal((await recoverDurableAudioSession()).count, 1);
  // Le dernier événement doit encore pouvoir être conservé après un échec antérieur.
  await keepCapturedAudioChunk(session, 1, new Blob(["final-fictif"]));
  assert.equal((await recoverDurableAudioSession()).count, 2);
  assert.equal(await (await pendingAudioChunks(session.sessionId))[0].blob.text(), "original-fictif");
});

test("audio durable : un miroir périmé ne ressuscite pas une session finalisée", async (t) => {
  setup(t);
  await rememberDurableAudioSession(session);
  await keepCapturedAudioChunk(session, 0, new Blob(["fictif"]));
  globalThis.localStorage.removeItem = () => { throw new Error("Suppression interdite"); };
  await clearFinalizedAudioChunks(session.sessionId);
  await forgetDurableAudioSession(session.sessionId);
  assert.equal(await recoverDurableAudioSession(), null);
  const next = { ...session, sessionId: "session-suivante-fictive" };
  await rememberDurableAudioSession(next);
  await forgetDurableAudioSession(session.sessionId);
  assert.equal((await recoverDurableAudioSession()).sessionId, next.sessionId);
});

test("audio durable : migration v1 conserve les fragments et reprend le miroir historique", async (t) => {
  setup(t);
  const legacy = await new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open("vogue-mary-audio-queue", 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore("chunks", { keyPath: "id" });
      store.createIndex("session", "sessionId");
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  const tx = legacy.transaction("chunks", "readwrite");
  tx.objectStore("chunks").add({ id: `${session.sessionId}:000000000`, sessionId: session.sessionId,
    index: 0, blob: new Blob(["bloc-historique-fictif"]) });
  await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
  legacy.close();
  rememberAudioSession({ ...session, count: 1 });
  assert.equal((await recoverDurableAudioSession()).count, 1);
  assert.equal(await (await pendingAudioChunks(session.sessionId))[0].blob.text(), "bloc-historique-fictif");
  await rememberDurableAudioSession({ ...session, count: 1, finalizedCapture: true });
  assert.equal((await recoverDurableAudioSession()).finalizedCapture, true);
});
