const runningStates = new Set(["queued", "transcribing", "diarizing", "verifying"]);

export function runtimeJobStatus(jobId, status, activeJobs) {
  if (!status || !runningStates.has(status.state) || activeJobs.has(jobId)) return status;
  // Ne pas réécrire les preuves de l'ancienne exécution à la lecture.
  return { ...status, state: "error", interrupted: true, resultReady: false, progress: 0,
    message: "Traitement interrompu. L'audio original est conservé ; relancez la transcription." };
}
