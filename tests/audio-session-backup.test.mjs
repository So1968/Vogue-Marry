import test from "node:test";
import assert from "node:assert/strict";
import {
  rememberAudioSession,
  recoverAudioSession,
  forgetAudioSession
} from "../src/lib/audio-chunk-queue.js";

function withLocalStorage(run) {
  const saved = new Map();
  const previous = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => { saved.set(key, value); },
    removeItem: (key) => { saved.delete(key); }
  };
  try {
    run(saved);
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
}

test("session audio : une session concurrente ne peut pas être effacée par une ancienne reprise", () => {
  withLocalStorage(() => {
    rememberAudioSession({ sessionId: "session-a", count: 2 });
    assert.equal(recoverAudioSession().sessionId, "session-a");

    forgetAudioSession("session-b");
    assert.equal(recoverAudioSession().sessionId, "session-a");

    forgetAudioSession("session-a");
    assert.equal(recoverAudioSession(), null);
  });
});

test("session audio : la suppression explicite sans identifiant reste disponible", () => {
  withLocalStorage(() => {
    rememberAudioSession({ sessionId: "session-a" });
    forgetAudioSession();
    assert.equal(recoverAudioSession(), null);
  });
});
