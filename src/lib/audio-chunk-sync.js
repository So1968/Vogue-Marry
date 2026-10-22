import { pendingAudioChunks, clearFinalizedAudioChunks, forgetAudioSession } from "./audio-chunk-queue.js";
import { uploadMeetingAudioChunk, getMeetingAudioChunksStatus, finalizeMeetingAudioChunks } from "./local-api.js";
import { createAudioSessionSynchronizer } from "./audio-session-sync-core.js";

// N'efface jamais les fragments locaux avant confirmation serveur.
export const syncAudioSession = createAudioSessionSynchronizer({
  pendingAudioChunks,
  clearFinalizedAudioChunks,
  forgetAudioSession,
  uploadMeetingAudioChunk,
  getMeetingAudioChunksStatus,
  finalizeMeetingAudioChunks
});
