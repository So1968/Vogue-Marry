import { useEffect, useMemo, useState } from "react";
import "./transcription-view.css";

const API = (import.meta.env.VITE_VOGUE_MARRY_API || "http://127.0.0.1:8010").replace(/\/+$/u, "");
const LAST_JOB_KEY = "vogue-marry:last-transcription-job";
const DEFAULT_CONTEXT = "Réunion professionnelle en français. Respecter les noms propres, sigles, termes métier et décisions entendues. Ne rien inventer si un passage est incertain.";
const GPT_COST_PER_MINUTE_USD = 0.0045;
const SENSITIVE_CHUNK_SECONDS = 900;
const SENSITIVE_OVERLAP_SECONDS = 4;

function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return "";
  const mib = bytes / 1024 / 1024;
  return `${mib.toFixed(1)} Mio`;
}

function formatClock(totalSeconds) {
  const value = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = value % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function formatUsd(value) {
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(2)} $`;
}

function processedSeconds(duration) {
  const total = Number(duration) || 0;
  if (total <= 0) return 0;
  let cursor = 0;
  let processed = 0;
  while (cursor < total - 0.25) {
    const chunkDuration = Math.min(SENSITIVE_CHUNK_SECONDS, total - cursor);
    processed += chunkDuration;
    if (total - cursor <= SENSITIVE_CHUNK_SECONDS) break;
    cursor += SENSITIVE_CHUNK_SECONDS - SENSITIVE_OVERLAP_SECONDS;
  }
  return processed;
}

function estimateSensitiveCost(duration) {
  return (processedSeconds(duration) / 60) * GPT_COST_PER_MINUTE_USD;
}

function parseParticipantText(value) {
  return Array.from(new Set(
    String(value || "")
      .split(/[\n;,|]+/)
      .map((item) => item.replace(/^[-•]\s*/, "").trim())
      .filter(Boolean)
  ));
}

function speakerMapKey(jobId) {
  return `vogue-marry:speaker-map:${jobId}`;
}

function readSpeakerOverrides(jobId) {
  if (!jobId) return {};
  try {
    const value = JSON.parse(window.localStorage.getItem(speakerMapKey(jobId)) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export default function TranscriptionView() {
  const [health, setHealth] = useState(null);
  const [escales, setEscales] = useState([]);
  const [meetingId, setMeetingId] = useState("");
  const [manualParticipants, setManualParticipants] = useState("");
  const [mode, setMode] = useState("local");
  const [cloudConsent, setCloudConsent] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [hfTokenInput, setHfTokenInput] = useState("");
  const [contextHint, setContextHint] = useState(DEFAULT_CONTEXT);
  const [file, setFile] = useState(null);
  const [audioDuration, setAudioDuration] = useState(null);
  const [job, setJob] = useState(null);
  const [result, setResult] = useState(null);
  const [speakerOverrides, setSpeakerOverrides] = useState({});
  const [speakerNotice, setSpeakerNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const selectedMeeting = useMemo(
    () => escales.find((item) => item.id === meetingId) || null,
    [escales, meetingId]
  );

  const participants = useMemo(
    () => selectedMeeting?.participants?.length ? selectedMeeting.participants : parseParticipantText(manualParticipants),
    [selectedMeeting, manualParticipants]
  );

  async function refreshHealth() {
    try {
      const response = await fetch(`${API}/api/transcription/health`);
      const payload = await response.json();
      setHealth(payload);
      return payload;
    } catch {
      setError("Le moteur de transcription Vogue Marry n’est pas démarré.");
      return null;
    }
  }

  async function loadEscales() {
    try {
      const response = await fetch(`${API}/api/transcription/escales`);
      if (!response.ok) return;
      const payload = await response.json();
      setEscales(Array.isArray(payload.escales) ? payload.escales : []);
    } catch {
      // L'absence d'escales ne bloque pas l'import manuel d'un audio.
    }
  }

  async function loadResult(jobId) {
    const resultResponse = await fetch(`${API}/api/transcription/${jobId}/result`);
    if (!resultResponse.ok) return null;
    const payload = await resultResponse.json();
    setResult(payload);
    setSpeakerOverrides({
      ...readSpeakerOverrides(jobId),
      ...(payload.speakerOverrides || {})
    });
    setSpeakerNotice("");
    return payload;
  }

  useEffect(() => {
    refreshHealth();
    loadEscales();

    const savedJobId = window.localStorage.getItem(LAST_JOB_KEY);
    if (!savedJobId) return;
    (async () => {
      try {
        const response = await fetch(`${API}/api/transcription/${savedJobId}`);
        if (!response.ok) return;
        const state = await response.json();
        setJob(state);
        if (state.state === "done") {
          await loadResult(savedJobId);
          setBusy(false);
        } else if (state.state !== "error") {
          setBusy(true);
        }
      } catch {
        // Le moteur sera récupéré au prochain rafraîchissement.
      }
    })();
  }, []);

  useEffect(() => {
    setAudioDuration(null);
    if (!file) return undefined;

    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.preload = "metadata";
    audio.src = url;
    const handleLoaded = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) setAudioDuration(audio.duration);
    };
    audio.addEventListener("loadedmetadata", handleLoaded);
    audio.load();

    return () => {
      audio.removeEventListener("loadedmetadata", handleLoaded);
      audio.src = "";
      URL.revokeObjectURL(url);
    };
  }, [file]);

  useEffect(() => {
    if (!job?.jobId || job.state === "done" || job.state === "error") return undefined;
    window.localStorage.setItem(LAST_JOB_KEY, job.jobId);

    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`${API}/api/transcription/${job.jobId}`);
        const state = await response.json();
        setJob(state);
        if (state.state === "done") {
          await loadResult(job.jobId);
          setBusy(false);
        }
        if (state.state === "error") {
          setError(state.message || "La transcription a échoué.");
          setBusy(false);
        }
      } catch {
        setError("Vogue Marry n’arrive plus à joindre le moteur. Le travail déjà terminé reste conservé.");
      }
    }, 2000);

    return () => window.clearInterval(timer);
  }, [job?.jobId, job?.state]);

  const engineReady = mode === "high" ? health?.highPrecisionReady : health?.localEngineReady;
  const canStart = Boolean(file && engineReady && !busy && (mode !== "high" || cloudConsent));
  const estimatedCost = mode === "high" && audioDuration ? estimateSensitiveCost(audioDuration) : 0;
  const completedCost = result?.mode === "high" ? Number(result?.verification?.estimatedCostUsd || 0) : 0;

  const unresolvedSpeakerGroups = useMemo(() => {
    if (!result?.segments) return [];
    const groups = new Map();
    for (const segment of result.segments) {
      if (segment.speakerConfidence !== "non-identifie" || !segment.sourceSpeaker) continue;
      if (!groups.has(segment.sourceSpeaker)) {
        groups.set(segment.sourceSpeaker, {
          sourceSpeaker: segment.sourceSpeaker,
          label: segment.speaker || "Intervenant",
          start: segment.start,
          sample: segment.text
        });
      }
    }
    return Array.from(groups.values());
  }, [result]);

  const effectiveSegments = useMemo(() => {
    if (!result?.segments) return [];
    return result.segments.map((segment) => ({
      ...segment,
      speaker: speakerOverrides[segment.sourceSpeaker] || segment.speaker || "Intervenant"
    }));
  }, [result, speakerOverrides]);

  const transcript = useMemo(
    () => effectiveSegments
      .map((segment) => `[${formatClock(segment.start)}] ${segment.speaker} — ${segment.text}`)
      .join("\n\n"),
    [effectiveSegments]
  );

  function resetRun() {
    setError("");
    setResult(null);
    setJob(null);
    setSpeakerOverrides({});
    setSpeakerNotice("");
    setBusy(false);
    window.localStorage.removeItem(LAST_JOB_KEY);
  }

  function updateSpeakerOverride(sourceSpeaker, name) {
    setSpeakerNotice("");
    setSpeakerOverrides((current) => {
      const next = { ...current };
      if (name) next[sourceSpeaker] = name;
      else delete next[sourceSpeaker];
      return next;
    });
  }

  async function saveSpeakerOverrides() {
    if (!result?.jobId) return;
    if (!Object.keys(speakerOverrides).length) {
      setSpeakerNotice("Aucun nom à enregistrer.");
      return;
    }

    setSpeakerNotice("Enregistrement…");
    try {
      const response = await fetch(`${API}/api/transcription/${encodeURIComponent(result.jobId)}/speakers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mapping: speakerOverrides })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Impossible d’enregistrer les interlocuteurs.");

      const confirmedMapping = payload.mapping || speakerOverrides;
      window.localStorage.setItem(speakerMapKey(result.jobId), JSON.stringify(confirmedMapping));
      setSpeakerOverrides(confirmedMapping);
      if (payload.result) setResult(payload.result);
      setSpeakerNotice(payload.persistedToMeeting
        ? "Noms confirmés dans la transcription et dans l’escale."
        : "Noms confirmés dans la transcription.");
    } catch (err) {
      setSpeakerNotice(err.message || "Impossible d’enregistrer les interlocuteurs.");
    }
  }

  function downloadCorrectedTranscript() {
    if (!result || !transcript) return;
    const header = [
      "Transcription — Vogue Marry",
      result.meeting?.title ? `Escale : ${result.meeting.title}` : null,
      result.participants?.length ? `Participants : ${result.participants.join(", ")}` : null,
      ""
    ].filter((item) => item !== null).join("\n");
    const blob = new Blob([`${header}\n${transcript}\n`], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `transcription-vogue-marry-${result.jobId}.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async function saveApiKey() {
    setError("");
    try {
      const response = await fetch(`${API}/api/transcription/config/api-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKeyInput })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Impossible d’enregistrer la clé OpenAI.");
      setApiKeyInput("");
      await refreshHealth();
    } catch (err) {
      setError(err.message || "Impossible d’enregistrer la clé OpenAI.");
    }
  }

  async function saveHfToken() {
    setError("");
    try {
      const response = await fetch(`${API}/api/transcription/config/hf-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: hfTokenInput })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Impossible d’enregistrer le jeton Hugging Face.");
      setHfTokenInput("");
      await refreshHealth();
    } catch (err) {
      setError(err.message || "Impossible d’enregistrer le jeton Hugging Face.");
    }
  }

  async function startTranscription() {
    if (!file || !canStart) return;
    setBusy(true);
    setError("");
    setResult(null);
    setSpeakerOverrides({});
    setSpeakerNotice("");
    setJob({ state: "uploading", message: "Envoi de l’enregistrement…", progress: 1 });

    try {
      const form = new FormData();
      form.append("audio", file);
      form.append("mode", mode);
      form.append("context", contextHint);
      if (meetingId) form.append("meetingId", meetingId);
      form.append("participantsJson", JSON.stringify(participants));

      const response = await fetch(`${API}/api/transcription`, { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Impossible d’envoyer l’enregistrement.");

      window.localStorage.setItem(LAST_JOB_KEY, payload.jobId);
      if (payload.cached) {
        const stateResponse = await fetch(`${API}/api/transcription/${payload.jobId}`);
        const state = await stateResponse.json();
        setJob(state);
        await loadResult(payload.jobId);
        setBusy(false);
      } else if (payload.alreadyRunning) {
        const stateResponse = await fetch(`${API}/api/transcription/${payload.jobId}`);
        const state = await stateResponse.json();
        setJob(state);
        setBusy(state.state !== "done" && state.state !== "error");
        if (state.state === "done") await loadResult(payload.jobId);
      } else {
        setJob({ jobId: payload.jobId, state: "queued", message: "Enregistrement reçu.", progress: 2, mode });
      }
    } catch (err) {
      setBusy(false);
      setError(err.message || "Échec de l’envoi.");
    }
  }

  return (
    <main className="transcription-page">
      <header className="transcription-topbar">
        <a href="/" className="transcription-back">← Vogue Marry</a>
        <div>
          <small>TRACES AUDIO · ESCALES</small>
          <h1>Transcription des réunions</h1>
          <p>Matéo réutilise l’équipage déjà saisi dans l’escale pour reconnaître les voix.</p>
        </div>
      </header>

      <section className="transcription-panel">
        <div className="transcription-mode-grid" aria-label="Mode de transcription">
          <button
            type="button"
            className={`transcription-mode${mode === "local" ? " active" : ""}`}
            onClick={() => { setMode("local"); setCloudConsent(false); resetRun(); }}
          >
            <small>GRATUIT · SUR CE PC</small>
            <strong>Local renforcé</strong>
            <span>large-v3-turbo + repérage local des interlocuteurs. Coût API : 0 $.</span>
          </button>
          <button
            type="button"
            className={`transcription-mode high${mode === "high" ? " active" : ""}`}
            onClick={() => { setMode("high"); setCloudConsent(false); resetRun(); }}
          >
            <small>DOSSIER SENSIBLE</small>
            <strong>Contrôle renforcé</strong>
            <span>Même traitement local, puis une seconde lecture indépendante avec GPT.</span>
          </button>
        </div>

        <div className="transcription-statusline">
          <strong>{mode === "high" ? "Contrôle renforcé" : "Moteur local renforcé"}</strong>
          <span className={engineReady ? "ready" : "not-ready"}>
            {engineReady ? `Prêt · ${health?.localModel || "large-v3-turbo"}` : "Configuration nécessaire"}
          </span>
        </div>

        {!health?.localEngineReady && health ? (
          <div className="transcription-callout">
            Lance une seule fois <code>npm run transcription:setup</code>, puis redémarre le moteur de transcription.
          </div>
        ) : null}

        {health?.localEngineReady && !health?.pyannoteInstalled ? (
          <div className="transcription-callout">
            <strong>Reconnaissance des voix à installer</strong>
            <div>Whisper est prêt, mais Pyannote manque encore. Relance <code>npm run transcription:setup</code> pour ajouter gratuitement le repérage des interlocuteurs.</div>
          </div>
        ) : null}

        <div className="transcription-context">
          <span>Escale / réunion de Matéo</span>
          <select value={meetingId} onChange={(event) => { setMeetingId(event.target.value); resetRun(); }}>
            <option value="">Audio hors escale / participants à saisir manuellement</option>
            {escales.map((escale) => (
              <option key={escale.id} value={escale.id}>
                {escale.meetingDate ? `${escale.meetingDate} · ` : ""}{escale.title} · {escale.projectName}
              </option>
            ))}
          </select>
          {selectedMeeting ? (
            <small>{selectedMeeting.participantCount} participant{selectedMeeting.participantCount > 1 ? "s" : ""} prévu{selectedMeeting.participantCount > 1 ? "s" : ""} · {participants.join(" · ") || "aucun nom enregistré"}</small>
          ) : (
            <>
              <textarea
                value={manualParticipants}
                onChange={(event) => setManualParticipants(event.target.value)}
                rows={3}
                placeholder="Un nom par ligne, uniquement si l’audio n’est pas déjà rattaché à une escale."
              />
              <small>Dans une escale normale, cette saisie est inutile : Vogue Marry récupère les noms déjà enregistrés.</small>
            </>
          )}
        </div>

        {health?.pyannoteInstalled && !health?.huggingFaceConfigured ? (
          <div className="transcription-api-config">
            <strong>Activer gratuitement la reconnaissance des interlocuteurs</strong>
            <p>Pyannote Community-1 fonctionne ensuite en local. Après avoir accepté les conditions du modèle sur Hugging Face, colle ici ton jeton une seule fois.</p>
            <div>
              <input
                type="password"
                value={hfTokenInput}
                onChange={(event) => setHfTokenInput(event.target.value)}
                placeholder="hf_…"
                autoComplete="off"
              />
              <button type="button" onClick={saveHfToken} disabled={!hfTokenInput.trim()}>Activer les voix</button>
            </div>
          </div>
        ) : null}

        {health?.localDiarizationReady ? (
          <div className="transcription-callout">
            <strong>Interlocuteurs · gratuit</strong>
            <div>Pyannote est prêt. La liste de l’escale sert de contexte, mais Vogue Marry ne force pas le nombre de voix et n’associe automatiquement un nom qu’après une présentation explicite de la personne.</div>
          </div>
        ) : null}

        {mode === "high" && !health?.openAIConfigured && health ? (
          <div className="transcription-api-config">
            <strong>Activer le contrôle renforcé</strong>
            <p>La clé OpenAI reste enregistrée uniquement sur ce PC dans <code>~/.config/vogue-merry/</code>.</p>
            <div>
              <input
                type="password"
                value={apiKeyInput}
                onChange={(event) => setApiKeyInput(event.target.value)}
                placeholder="sk-…"
                autoComplete="off"
              />
              <button type="button" onClick={saveApiKey} disabled={!apiKeyInput.trim()}>Enregistrer</button>
            </div>
          </div>
        ) : null}

        {mode === "high" ? (
          <>
            <label className="transcription-context">
              <span>Contexte utile à la seconde lecture</span>
              <textarea
                value={contextHint}
                onChange={(event) => setContextHint(event.target.value)}
                rows={3}
                placeholder="Sigles, vocabulaire métier, contexte de la réunion…"
              />
              <small>Les noms des participants sont ajoutés automatiquement depuis l’escale.</small>
            </label>
            <label className="transcription-callout">
              <strong>Avant l’envoi vers OpenAI</strong>
              <div>
                <input
                  type="checkbox"
                  checked={cloudConsent}
                  onChange={(event) => setCloudConsent(event.target.checked)}
                />{" "}
                J’ai compris que l’audio, le contexte et les noms des participants seront envoyés à OpenAI pour cette seconde lecture. Le mode local n’effectue aucun envoi vers OpenAI.
              </div>
            </label>
          </>
        ) : null}

        <label className="transcription-file">
          <span>Enregistrement à transcrire</span>
          <input
            type="file"
            accept="audio/*,.m4a,.mp3,.wav,.ogg,.webm,.mp4"
            onChange={(event) => {
              setFile(event.target.files?.[0] || null);
              resetRun();
            }}
          />
        </label>

        <div className="transcription-filemeta">
          {file ? (
            <>
              <strong>{file.name}</strong>
              <span>{formatSize(file.size)}{audioDuration ? ` · ${formatClock(audioDuration)}` : ""}</span>
            </>
          ) : <span>Aucun fichier sélectionné.</span>}
        </div>

        {file ? (
          <div className="transcription-callout">
            <strong>{mode === "high" ? "Coût estimé avant lancement" : "Coût"}</strong>
            <div>
              {mode === "high"
                ? (audioDuration
                  ? <><strong>{formatUsd(estimatedCost)}</strong> · seule la seconde lecture GPT est payante. Le repérage des voix reste local et gratuit.</>
                  : <>Calcul de la durée en cours…</>)
                : <><strong>0 $</strong> · transcription et repérage des interlocuteurs en local.</>}
            </div>
          </div>
        ) : null}

        <button type="button" className="transcription-start" disabled={!canStart} onClick={startTranscription}>
          {busy
            ? "Transcription en cours…"
            : mode === "high"
              ? "Transcrire et contrôler"
              : "Transcrire gratuitement"}
        </button>

        {job ? (
          <div className="transcription-progress">
            <div><strong>{job.message || job.state}</strong><span>{job.progress || 0}%</span></div>
            <progress max="100" value={job.progress || 0} />
            {job.duration ? <small>{formatClock(job.duration)} d’audio · {job.segmentCount || 0} passages structurés</small> : null}
          </div>
        ) : null}

        {error ? <div className="transcription-error">{error}</div> : null}
      </section>

      {result ? (
        <section className="transcription-result">
          <div className="transcription-result-head">
            <div>
              <small>{result.mode === "high" ? "CONTRÔLE RENFORCÉ · DOUBLE LECTURE" : "LOCAL RENFORCÉ · TERMINÉ"}</small>
              <h2>{result.originalName}</h2>
              <p>
                <strong>{result.participantCount || 0} participant{result.participantCount > 1 ? "s" : ""} attendu{result.participantCount > 1 ? "s" : ""}</strong>
                {result.detectedSpeakerCount ? ` · ${result.detectedSpeakerCount} voix détectée${result.detectedSpeakerCount > 1 ? "s" : ""}` : ""}
              </p>
              {result.mode === "high" ? <p><strong>Coût API estimé : {formatUsd(completedCost)}</strong> · reconnaissance des voix : 0 $.</p> : <p><strong>Coût API : 0 $</strong>.</p>}
              {result.warnings?.length ? <p className="transcription-result-warning">{result.warnings.join(" · ")}</p> : null}
            </div>
            <div className="transcription-downloads">
              <a href={`${API}/api/transcription/${result.jobId}/download`}>Texte brut du moteur</a>
              {Object.keys(speakerOverrides).length ? <button type="button" onClick={downloadCorrectedTranscript}>Texte avec noms confirmés</button> : null}
              {result.mode === "high" ? <a href={`${API}/api/transcription/${result.jobId}/download-verification`}>Seconde lecture GPT</a> : null}
            </div>
          </div>

          {unresolvedSpeakerGroups.length ? (
            <div className="transcription-speaker-confirm">
              <div>
                <strong>Qui parle ?</strong>
                <p>Vogue Marry n’a pas forcé les identités incertaines. Associe seulement les voix restantes aux personnes déjà prévues dans l’escale.</p>
              </div>
              <div className="transcription-speaker-list">
                {unresolvedSpeakerGroups.map((group) => (
                  <label key={group.sourceSpeaker} className="transcription-speaker-row">
                    <div>
                      <strong>{group.label}</strong>
                      <small>{formatClock(group.start)} · « {String(group.sample || "").slice(0, 120)}{String(group.sample || "").length > 120 ? "…" : ""} »</small>
                    </div>
                    <select
                      value={speakerOverrides[group.sourceSpeaker] || ""}
                      onChange={(event) => updateSpeakerOverride(group.sourceSpeaker, event.target.value)}
                    >
                      <option value="">À confirmer</option>
                      {(result.participants || participants).map((participant) => (
                        <option key={participant} value={participant}>{participant}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <div className="transcription-speaker-actions">
                <button type="button" onClick={saveSpeakerOverrides}>Confirmer ces noms</button>
                {speakerNotice ? <span>{speakerNotice}</span> : null}
              </div>
            </div>
          ) : result.detectedSpeakerCount ? (
            <div className="transcription-callout"><strong>Interlocuteurs reconnus</strong><div>Aucune voix ne reste à confirmer pour ce compte rendu.</div></div>
          ) : null}

          <pre>{transcript}</pre>
        </section>
      ) : null}
    </main>
  );
}
