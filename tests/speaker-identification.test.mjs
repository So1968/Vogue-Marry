import test from "node:test";
import assert from "node:assert/strict";
import { introductionScore, mapSpeakersFromIntroductions } from "../backend/lib/speaker-identification.js";

const names = ["Personne fictive Alpha", "Personne fictive Beta"];
function turn(sourceSpeaker, text, start = 2) { return { sourceSpeaker, text, start }; }

test("voix : reconnaître les apostrophes et les présentations explicites", () => {
  for (const cue of ["Je suis", "Je m'appelle", "Je m’appelle", "Moi c’est", "Mon nom est"]) {
    assert.equal(introductionScore(`${cue} ${names[0]}. Bonjour.`, names[0]), 10, cue);
  }
  assert.equal(introductionScore("Je suis Personne fictive Alphabétique.", names[0]), 0);
});

test("voix : salutation d'un tiers et auto-présentation éloignée ne sont pas des identités", () => {
  for (const text of [`Bonjour ${names[0]}`, `Je suis prêt. Bonjour ${names[0]}.`,
    `Je suis avec ${names[0]}.`, `Je m'appelle ${names[1]}, merci ${names[0]}.`]) {
    assert.equal(introductionScore(text, names[0]), 0, text);
  }
});

test("voix : conserver les inconnus en cas d'identités contradictoires", () => {
  const conflictingName = mapSpeakersFromIntroductions([
    turn("SPEAKER_00", `Je suis ${names[0]}`), turn("SPEAKER_00", `Je suis ${names[1]}`)
  ], names);
  assert.deepEqual(conflictingName.map, {});
  const conflictingVoice = mapSpeakersFromIntroductions([
    turn("SPEAKER_00", `Je suis ${names[0]}`), turn("SPEAKER_01", `Je suis ${names[0]}`)
  ], names);
  assert.deepEqual(conflictingVoice.map, {});
  assert.equal(conflictingVoice.detectedSpeakerCount, 2);
});

test("voix : contexte des participants sans identité forcée ni voix supplémentaire", () => {
  const mapped = mapSpeakersFromIntroductions([
    turn("SPEAKER_00", `Je m'appelle ${names[0]}`), turn("SPEAKER_01", "Bonjour à tous."),
    turn("?", `Je suis ${names[1]}`), turn("SPEAKER_02", `Je suis ${names[1]}`, 610)
  ], names);
  assert.deepEqual(mapped.map, { SPEAKER_00: { name: names[0], confidence: "presentation-explicite" } });
  assert.equal(mapped.detectedSpeakerCount, 3);
});

test("voix : une présentation citée, rapportée ou conditionnelle reste inconnue", () => {
  for (const text of [
    `Elle a dit : je suis ${names[0]}.`,
    `Pour cet exemple, dites je m'appelle ${names[0]}.`,
    `Si je suis ${names[0]}, alors je peux signer.`,
    `« Je suis ${names[0]} », voilà ce qui est écrit.`,
    `Bonjour, « je suis ${names[0]} », c'est une citation.`,
    `'Je suis ${names[0]}', voilà le texte.`,
    `Bonjour, 'je suis ${names[0]}', c'est une citation.`
  ]) {
    assert.equal(introductionScore(text, names[0]), 0, text);
    assert.deepEqual(mapSpeakersFromIntroductions([turn("SPEAKER_00", text)], names).map, {});
  }
  assert.equal(introductionScore(`Bonjour à tous, je m'appelle ${names[0]}.`, names[0]), 10);
});
