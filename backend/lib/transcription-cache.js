import { createHash } from "node:crypto";

export function transcriptionConfiguration(mode, configuration) {
  return {
    revision: 2,
    localModel: configuration.localModel,
    device: configuration.device,
    computeType: configuration.computeType,
    diarizationModel: configuration.diarizationModel,
    diarizationRequested: Boolean(configuration.diarizationRequested),
    verificationModel: mode === "high" ? configuration.verificationModel : null
  };
}

export function transcriptionCacheKey({ audioHash, mode, participants, context, meetingId, configuration }) {
  return createHash("sha256").update(JSON.stringify({
    audioHash, mode, participants, context: String(context || "").trim(), meetingId: meetingId || "",
    configuration: transcriptionConfiguration(mode, configuration)
  })).digest("hex");
}

export function reusableTranscriptionResult(jobId, result, configuration) {
  if (!result || result.jobId !== jobId || !Array.isArray(result.segments)) return false;
  const manuallyConfirmed = result.segments.some((segment) => segment?.speakerConfidence === "confirme-manuel");
  return !configuration.diarizationRequested || result.diarizationModel === configuration.diarizationModel || manuallyConfirmed;
}
