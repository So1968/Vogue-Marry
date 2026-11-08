import test from "node:test";
import assert from "node:assert/strict";
import { transcriptionCacheKey, reusableTranscriptionResult } from "../backend/lib/transcription-cache.js";

const input = { audioHash: "empreinte-fictive", mode: "local", participants: ["Intervenant fictif"], context: "Contexte fictif", meetingId: "ile/escale",
  configuration: { localModel: "modele-fictif-A", device: "cpu", computeType: "int8", diarizationModel: "voix-fictives-A", diarizationRequested: false, verificationModel: "verification-fictive-A" } };

test("cache transcription : même demande réutilisable, audio et réglages distincts isolés", () => {
  const key = transcriptionCacheKey(input);
  assert.equal(transcriptionCacheKey({ ...input, context: "  Contexte fictif  " }), key);
  for (const [field, value] of Object.entries({ audioHash: "autre-audio", mode: "high", participants: [], context: "Autre contexte", meetingId: "autre/escale" })) {
    assert.notEqual(transcriptionCacheKey({ ...input, [field]: value }), key, field);
  }
  for (const [field, value] of Object.entries({ localModel: "modele-fictif-B", device: "cuda", computeType: "float16", diarizationModel: "voix-fictives-B", diarizationRequested: true })) {
    assert.notEqual(transcriptionCacheKey({ ...input, configuration: { ...input.configuration, [field]: value } }), key, field);
  }
});

test("cache transcription : la seconde lecture ne concerne que le mode renforcé", () => {
  const changed = { ...input, configuration: { ...input.configuration, verificationModel: "verification-fictive-B" } };
  assert.equal(transcriptionCacheKey(changed), transcriptionCacheKey(input));
  assert.notEqual(transcriptionCacheKey({ ...changed, mode: "high" }), transcriptionCacheKey({ ...input, mode: "high" }));
});

test("cache transcription : résultat dégradé retentable, confirmation humaine prioritaire", () => {
  const configuration = { ...input.configuration, diarizationRequested: true };
  const result = { jobId: "tache_fictive", segments: [{ text: "Texte fictif", speakerConfidence: "non-identifie" }], diarizationModel: null };
  assert.equal(reusableTranscriptionResult("tache_fictive", result, configuration), false);
  assert.equal(reusableTranscriptionResult("tache_fictive", { ...result, diarizationModel: configuration.diarizationModel }, configuration), true);
  assert.equal(reusableTranscriptionResult("tache_fictive", { ...result, segments: [{ speakerConfidence: "confirme-manuel" }] }, configuration), true);
  assert.equal(reusableTranscriptionResult("autre_tache", result, input.configuration), false);
  assert.equal(reusableTranscriptionResult("tache_fictive", null, input.configuration), false);
  assert.equal(reusableTranscriptionResult("tache_fictive", { jobId: "tache_fictive" }, input.configuration), false);
});
