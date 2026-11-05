async function chunkSha256(blob) {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// La synchronisation est injectée pour tester les pannes sans microphone ni données réelles.
export function createAudioSessionSynchronizer({
  pendingAudioChunks,
  clearFinalizedAudioChunks,
  forgetAudioSession,
  uploadMeetingAudioChunk,
  getMeetingAudioChunksStatus,
  finalizeMeetingAudioChunks
}) {
  return async function syncAudioSession(session) {
    if (!session?.finalizedCapture) {
      throw new Error("Capture incomplète : les fragments restent conservés.");
    }
    const { sessionId, projectName, meetingDirName, count } = session;
    if (!sessionId || !projectName || !meetingDirName ||
        !Number.isSafeInteger(count) || count < 1) {
      throw new Error("Session audio invalide.");
    }
    const pending = await pendingAudioChunks(sessionId);
    const state = await getMeetingAudioChunksStatus({ projectName, meetingDirName });
    const remote = new Set(state.received || []);
    const descriptors = new Map((state.chunks || []).map((chunk) => [chunk.index, chunk]));
    const seen = new Set();
    for (const chunk of pending) {
      if (!Number.isSafeInteger(chunk.index) || chunk.index < 0 || chunk.index >= count ||
          seen.has(chunk.index) || !(chunk.blob instanceof Blob) || chunk.blob.size === 0) {
        throw new Error("Fragments locaux invalides : nettoyage refusé.");
      }
      seen.add(chunk.index);
      const descriptor = descriptors.get(chunk.index);
      if (remote.has(chunk.index) && descriptor) {
        if (descriptor.size !== chunk.blob.size || descriptor.sha256 !== await chunkSha256(chunk.blob)) {
          throw new Error("Un fragment distant diffère de la copie locale : les deux sources sont conservées.");
        }
        continue;
      }
      // Ancien serveur sans empreintes : réenvoyer pour déclencher sa comparaison
      // idempotente au lieu de considérer un numéro de bloc comme preuve d'intégrité.
      await uploadMeetingAudioChunk({ projectName, meetingDirName, index: chunk.index, blob: chunk.blob });
    }
    // Seul le serveur peut attester une finalisation complète.
    const result = await finalizeMeetingAudioChunks({ projectName, meetingDirName, count });
    if (!["ok", "already-finalized"].includes(result.status)) {
      throw new Error("La finalisation audio n'est pas confirmée.");
    }
    await clearFinalizedAudioChunks(sessionId);
    forgetAudioSession(sessionId);
    return result;
  };
}
