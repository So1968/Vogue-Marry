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
    for (const chunk of pending) {
      if (remote.has(chunk.index)) continue;
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
