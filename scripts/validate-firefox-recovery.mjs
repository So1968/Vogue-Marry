import { firefox } from "playwright";

function fail(message) {
  console.error(message);
  process.exit(1);
}

const origin = "http://127.0.0.1:5173";
const browser = await firefox.launch({
  headless: true,
  firefoxUserPrefs: {
    "media.navigator.streams.fake": true,
    "media.navigator.permission.disabled": true
  }
});

try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(origin, { waitUntil: "domcontentloaded" });

  const captured = await page.evaluate(async () => {
    localStorage.clear();
    await new Promise((resolve) => {
      const request = indexedDB.deleteDatabase("vogue-mary-audio-queue");
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    });

    const api = await import("/src/lib/local-api.js");
    const queue = await import("/src/lib/audio-chunk-queue.js");

    const projectName = "Validation Firefox " + Date.now();
    await api.createProject({ name: projectName, description: "Données CI fictives" });
    const meeting = await api.exportMeeting({
      projectName,
      meetingDate: "2026-10-22",
      meetingType: "réunion",
      title: "Validation récupération Firefox",
      participants: "Intervenant fictif",
      context: "Test automatisé sans donnée réelle",
      rawNotes: ""
    });

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    const session = {
      sessionId: crypto.randomUUID(),
      projectName,
      projectSlug: meeting.projectSlug,
      meetingDirName: meeting.meetingDirName,
      count: 0,
      finalizedCapture: false
    };
    queue.rememberAudioSession(session);

    let writes = Promise.resolve();
    let writeError = null;
    recorder.addEventListener("dataavailable", (event) => {
      if (!event.data.size) return;
      const index = session.count++;
      queue.rememberAudioSession(session);
      writes = writes.then(() => queue.keepAudioChunk(session.sessionId, index, event.data))
        .catch((error) => { writeError = error; });
    });

    const stopped = new Promise((resolve) => recorder.addEventListener("stop", resolve, { once: true }));
    recorder.start(1000);
    await new Promise((resolve) => setTimeout(resolve, 3250));
    recorder.stop();
    await stopped;
    stream.getTracks().forEach((track) => track.stop());
    await writes;
    if (writeError) throw writeError;

    session.finalizedCapture = true;
    queue.rememberAudioSession(session);
    const pending = await queue.pendingAudioChunks(session.sessionId);
    return {
      session,
      pendingCount: pending.length,
      types: pending.map((chunk) => chunk.blob.type),
      sizes: pending.map((chunk) => chunk.blob.size)
    };
  });

  if (captured.pendingCount < 3) fail("La capture n'a pas persisté assez de fragments.");
  if (!captured.types.every((type) => String(type).startsWith("audio/ogg"))) {
    fail("Firefox n'a pas conservé ses fragments Ogg dans IndexedDB : " + JSON.stringify(captured.types));
  }

  // Simule un onglet fermé/rechargé après la fin de capture, avant transfert serveur.
  await page.reload({ waitUntil: "domcontentloaded" });
  const recovered = await page.evaluate(async () => {
    const queue = await import("/src/lib/audio-chunk-queue.js");
    const sync = await import("/src/lib/audio-chunk-sync.js");
    const api = await import("/src/lib/local-api.js");

    const session = queue.recoverAudioSession();
    if (!session) throw new Error("Session audio perdue après rechargement.");
    const before = await queue.pendingAudioChunks(session.sessionId);
    const result = await sync.syncAudioSession(session);
    const after = await queue.pendingAudioChunks(session.sessionId);
    const inbox = await api.loadInbox();
    const row = inbox.find((item) => item.meetingDirName === session.meetingDirName);
    return {
      session,
      beforeCount: before.length,
      afterCount: after.length,
      activeSession: queue.recoverAudioSession(),
      result,
      inbox: row || null
    };
  });

  if (recovered.beforeCount !== captured.pendingCount) {
    fail("IndexedDB n'a pas conservé tous les fragments après rechargement.");
  }
  if (recovered.afterCount !== 0) fail("Les fragments locaux n'ont pas été nettoyés après confirmation serveur.");
  if (recovered.activeSession !== null) fail("La session active n'a pas été effacée après finalisation.");
  if (!["ok", "already-finalized"].includes(recovered.result?.status)) fail("Finalisation serveur non confirmée.");
  if (recovered.result?.audioFileName !== "audio_original.ogg") {
    fail("Le conteneur Firefox final n'est pas Ogg : " + JSON.stringify(recovered.result));
  }
  if (!recovered.inbox?.hasAudio) fail("L'escale finalisée n'est pas reconnue comme ayant un audio.");

  console.log(JSON.stringify({
    captured: {
      pendingCount: captured.pendingCount,
      types: captured.types,
      sizes: captured.sizes
    },
    recovered: {
      beforeCount: recovered.beforeCount,
      afterCount: recovered.afterCount,
      audioFileName: recovered.result.audioFileName,
      inboxHasAudio: recovered.inbox.hasAudio
    }
  }, null, 2));
} finally {
  await browser.close();
}
