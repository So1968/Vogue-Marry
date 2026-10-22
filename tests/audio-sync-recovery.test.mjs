import test from "node:test";
import assert from "node:assert/strict";
import { createAudioSessionSynchronizer } from "../src/lib/audio-session-sync-core.js";

const session = {
  sessionId: "fiction-1", projectName: "Projet fictif",
  meetingDirName: "reunion-fictive", count: 3, finalizedCapture: true
};
const chunks = [0, 1, 2].map((index) => ({ index, blob: new Blob(["bloc-" + index]) }));

function harness({ local = chunks, remote = [], finalized = "ok", failUpload = -1, failFinalize = false } = {}) {
  const calls = { uploads: [], cleared: [], forgotten: [], finalized: 0 };
  const sync = createAudioSessionSynchronizer({
    pendingAudioChunks: async () => local,
    getMeetingAudioChunksStatus: async () => ({ received: remote }),
    uploadMeetingAudioChunk: async ({ index }) => {
      if (index === failUpload) throw new Error("Réseau interrompu");
      calls.uploads.push(index);
    },
    finalizeMeetingAudioChunks: async () => {
      calls.finalized++;
      if (failFinalize) throw new Error("Confirmation indisponible");
      return { status: finalized };
    },
    clearFinalizedAudioChunks: async (id) => { calls.cleared.push(id); },
    forgetAudioSession: (id) => { calls.forgotten.push(id); }
  });
  return { sync, calls };
}

test("audio : ne transfère que les blocs absents du serveur", async () => {
  const { sync, calls } = harness({ remote: [0, 2] });
  assert.equal((await sync(session)).status, "ok");
  assert.deepEqual(calls.uploads, [1]);
  assert.deepEqual(calls.cleared, [session.sessionId]);
  assert.deepEqual(calls.forgotten, [session.sessionId]);
});

test("audio : réseau interrompu conserve la copie locale et la session", async () => {
  const { sync, calls } = harness({ failUpload: 1 });
  await assert.rejects(sync(session), /Réseau interrompu/);
  assert.equal(calls.finalized, 0);
  assert.deepEqual(calls.cleared, []);
  assert.deepEqual(calls.forgotten, []);
});

test("audio : confirmation de finalisation perdue conserve les blocs", async () => {
  const { sync, calls } = harness({ failFinalize: true });
  await assert.rejects(sync(session), /Confirmation indisponible/);
  assert.deepEqual(calls.cleared, []);
  assert.deepEqual(calls.forgotten, []);
});

test("audio : relance après confirmation serveur déjà obtenue", async () => {
  const { sync, calls } = harness({ local: [], remote: [0, 1, 2], finalized: "already-finalized" });
  assert.equal((await sync(session)).status, "already-finalized");
  assert.deepEqual(calls.uploads, []);
  assert.deepEqual(calls.cleared, [session.sessionId]);
});

test("audio : une réponse ambiguë n'autorise jamais le nettoyage", async () => {
  const { sync, calls } = harness({ finalized: "pending" });
  await assert.rejects(sync(session), /n'est pas confirmée/);
  assert.deepEqual(calls.cleared, []);
  assert.deepEqual(calls.forgotten, []);
});

test("audio : une capture incomplète ou session invalide est bloquée", async () => {
  const { sync, calls } = harness();
  await assert.rejects(sync({ ...session, finalizedCapture: false }), /Capture incomplète/);
  await assert.rejects(sync({ ...session, count: 0 }), /Session audio invalide/);
  assert.equal(calls.finalized, 0);
});
