import { pendingAudioChunks, clearFinalizedAudioChunks, forgetDurableAudioSession } from "./audio-chunk-queue.js";
import { uploadMeetingAudioChunk, getMeetingAudioChunksStatus, finalizeMeetingAudioChunks } from "./local-api.js";
import { createAudioSessionSynchronizer } from "./audio-session-sync-core.js";

// N'efface jamais les fragments locaux avant confirmation serveur.
export const syncAudioSession = createAudioSessionSynchronizer({
  pendingAudioChunks,
  clearFinalizedAudioChunks,
  forgetAudioSession: forgetDurableAudioSession,
  uploadMeetingAudioChunk,
  getMeetingAudioChunksStatus,
  finalizeMeetingAudioChunks
});
