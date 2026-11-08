function normalizeIdentity(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("fr-FR").replace(/[^a-z0-9]+/gu, " ").trim();
}

export function introductionScore(text, participant) {
  const normalized = normalizeIdentity(text);
  const name = normalizeIdentity(participant);
  if (!normalized || !name) return 0;
  // Une citation ou une proposition rapportée ne prouve pas l'identité de la voix.
  if (/[«»“”"]/u.test(String(text)) || /(?:^|[,;:])\s*['‘]/u.test(String(text))) return 0;
  const greeting = "(?:(?:bonjour|bonsoir|salut)(?: (?:a tous|a toutes|tout le monde|a toutes et a tous))? )?";
  const selfCue = new RegExp(`^${greeting}(?:(?:je suis)|(?:je m appelle)|(?:moi c est)|(?:mon nom est)|(?:je me presente)|(?:je me nomme)) ${name}(?: |$)`, "u");
  return selfCue.test(normalized) ? 10 : 0;
}

export function mapSpeakersFromIntroductions(turns, participants) {
  const speakers = [];
  for (const turn of turns) {
    if (turn.sourceSpeaker !== "?" && !speakers.includes(turn.sourceSpeaker)) speakers.push(turn.sourceSpeaker);
  }

  const candidates = [];
  for (const turn of turns) {
    if (turn.start > 600 || turn.sourceSpeaker === "?") continue;
    for (const participant of participants) {
      const score = introductionScore(turn.text, participant) + (turn.start <= 180 ? 1 : 0);
      if (score >= 10) candidates.push({ speaker: turn.sourceSpeaker, participant, score, start: turn.start });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.start - b.start);

  // Plusieurs identités revendiquées pour une voix, ou plusieurs voix pour un
  // même nom : conserver les intervenants inconnus plutôt que départager au score.
  const namesBySpeaker = new Map();
  const voicesByName = new Map();
  for (const { speaker, participant } of candidates) {
    if (!namesBySpeaker.has(speaker)) namesBySpeaker.set(speaker, new Set());
    if (!voicesByName.has(participant)) voicesByName.set(participant, new Set());
    namesBySpeaker.get(speaker).add(participant);
    voicesByName.get(participant).add(speaker);
  }
  const map = {};
  const usedParticipants = new Set();
  for (const candidate of candidates) {
    if (namesBySpeaker.get(candidate.speaker).size !== 1 || voicesByName.get(candidate.participant).size !== 1) continue;
    if (map[candidate.speaker] || usedParticipants.has(candidate.participant)) continue;
    map[candidate.speaker] = { name: candidate.participant, confidence: "presentation-explicite" };
    usedParticipants.add(candidate.participant);
  }

  const order = Object.fromEntries(speakers.map((speaker, index) => [speaker, index + 1]));
  return { map, order, detectedSpeakerCount: speakers.length };
}

