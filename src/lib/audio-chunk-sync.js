import { pendingAudioChunks, clearFinalizedAudioChunks, forgetAudioSession } from "./audio-chunk-queue.js";
import { uploadMeetingAudioChunk, getMeetingAudioChunksStatus, finalizeMeetingAudioChunks } from "./local-api.js";

// N'efface jamais les fragments locaux avant confirmation de l'assemblage serveur.
export async function syncAudioSession(session) {
  if (!session.finalizedCapture) throw new Error("Capture incomplète : les fragments restent conservés.");
  const { sessionId, projectName, meetingDirName } = session;
  const pending = await pendingAudioChunks(sessionId);
  if (!pending.length) throw new Error("Aucun fragment audio disponible localement.");
  const state = await getMeetingAudioChunksStatus({ projectName, meetingDirName });
  const remote = new Set(state.received || []);
  for (const chunk of pending) {
    if (remote.has(chunk.index)) continue;
    await uploadMeetingAudioChunk({ projectName, meetingDirName, index: chunk.index, blob: chunk.blob });
  }
  // Attention : la contiguïté est vérifiée côté serveur, ainsi que l'absence d'écrasement.
  const result = await finalizeMeetingAudioChunks({
    projectName, meetingDirName, count: session.count
  });
  if (!["ok", "already-finalized"].includes(result.status)) throw new Error("La finalisation audio n'est pas confirmée.");
  await clearFinalizedAudioChunks(sessionId);
  forgetAudioSession();
  return result;
}
