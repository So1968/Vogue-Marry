import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import path from "path";
import os from "os";
import { createHash, randomUUID } from "crypto";
import { spawn, spawnSync } from "child_process";
import { fileURLToPath } from "url";

const app = express();
const PORT = Number(process.env.VOGUE_TRANSCRIPTION_PORT || 8011);
const HOME = os.homedir();
const DATA_ROOT = path.join(HOME, "VOGUE-MERRY-DONNEES");
const ROOT = path.join(DATA_ROOT, "99_TRANSCRIPTION_TESTS");
const PROJECTS_ROOT = path.join(DATA_ROOT, "01_PROJETS");
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCAL_PYTHON = path.join(PROJECT_ROOT, ".venv-transcription", "bin", "python");
const LOCAL_SCRIPT = path.join(PROJECT_ROOT, "backend", "local_transcribe.py");
const DIARIZE_SCRIPT = path.join(PROJECT_ROOT, "backend", "local_diarize.py");
const LOCAL_MODEL = process.env.VOGUE_WHISPER_MODEL || "large-v3-turbo";
const DIARIZATION_MODEL = "pyannote/speaker-diarization-community-1";
const PRIMARY_MODEL = "gpt-transcribe";
const SENSITIVE_CHUNK_SECONDS = 900;
const OVERLAP_SECONDS = 4;
const CONFIG_DIR = path.join(HOME, ".config", "vogue-merry");
const API_KEY_FILE = path.join(CONFIG_DIR, "openai_api_key");
const HF_TOKEN_FILE = path.join(CONFIG_DIR, "huggingface_token");
const OPENAI_URL = "https://api.openai.com/v1/audio/transcriptions";
const GPT_COST_PER_MINUTE_USD = 0.0045;
const ALLOWED_ORIGINS = new Set([
  "http://127.0.0.1:5173",
  "http://localhost:5173"
]);

const DEFAULT_CONTEXT = [
  "Réunion professionnelle en français.",
  "Transcrire fidèlement les paroles audibles sans les traduire.",
  "Ne pas inventer de contenu pour combler un passage incertain.",
  "Respecter les noms propres, sigles et termes professionnels entendus."
].join(" ");

fs.mkdirSync(ROOT, { recursive: true });
fs.mkdirSync(CONFIG_DIR, { recursive: true });
app.use(cors({
  origin(origin, callback) {
    if (!origin || ALLOWED_ORIGINS.has(origin)) return callback(null, true);
    return callback(new Error("Origine non autorisée."));
  },
  methods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));
app.use(express.json({ limit: "1mb" }));

function safeName(value) {
  return String(value || "audio")
    .replace(/[\\/]/g, "_")
    .replace(/[^a-zA-Z0-9._ -]/g, "_")
    .slice(0, 160);
}

function timestamp() {
  return new Date().toISOString();
}

function jobDir(jobId) {
  return path.join(ROOT, jobId);
}

function requestJobDir(jobId) {
  const value = String(jobId || "").trim();
  if (!/^[A-Za-z0-9._-]+$/.test(value) || value === "." || value === "..") return null;
  const resolved = path.resolve(ROOT, value);
  const root = path.resolve(ROOT) + path.sep;
  return resolved.startsWith(root) ? resolved : null;
}

function statusPath(jobId) {
  return path.join(jobDir(jobId), "status.json");
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readJsonIfExists(filePath) {
  try {
    return fs.existsSync(filePath) ? readJson(filePath) : null;
  } catch {
    return null;
  }
}

function writeStatus(jobId, patch) {
  const filePath = statusPath(jobId);
  const previous = fs.existsSync(filePath) ? readJson(filePath) : {};
  const next = { ...previous, ...patch, jobId, updatedAt: timestamp() };
  writeJson(filePath, next);
  return next;
}

function formatClock(totalSeconds) {
  const value = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = value % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function openAiKey() {
  if (process.env.OPENAI_API_KEY?.trim()) return process.env.OPENAI_API_KEY.trim();
  if (!fs.existsSync(API_KEY_FILE)) return "";
  return fs.readFileSync(API_KEY_FILE, "utf8").trim();
}

function hfToken() {
  if (process.env.HF_TOKEN?.trim()) return process.env.HF_TOKEN.trim();
  if (!fs.existsSync(HF_TOKEN_FILE)) return "";
  return fs.readFileSync(HF_TOKEN_FILE, "utf8").trim();
}

function localEngineReady() {
  return fs.existsSync(LOCAL_PYTHON) && fs.existsSync(LOCAL_SCRIPT);
}

function pyannoteInstalled() {
  if (!fs.existsSync(LOCAL_PYTHON) || !fs.existsSync(DIARIZE_SCRIPT)) return false;
  try {
    return spawnSync(LOCAL_PYTHON, ["-c", "import pyannote.audio"], { stdio: "ignore", timeout: 15000 }).status === 0;
  } catch {
    return false;
  }
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], ...options });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => { stdout += data.toString(); });
    child.stderr.on("data", (data) => { stderr += data.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} a échoué (${code}). ${stderr.trim().slice(-2200)}`));
    });
  });
}

function runJsonLines(command, args, onEvent) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: PROJECT_ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let buffer = "";
    let stderr = "";
    let eventError = "";

    function handleLine(line) {
      if (!line.trim()) return;
      try {
        const event = JSON.parse(line);
        if (event.type === "error") eventError = event.message || "Erreur du moteur local.";
        onEvent(event);
      } catch {
        // Le moteur n'écrit normalement que du JSON sur stdout.
      }
    }

    child.stdout.on("data", (data) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      lines.forEach(handleLine);
    });
    child.stderr.on("data", (data) => { stderr += data.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (buffer.trim()) handleLine(buffer);
      if (code === 0 && !eventError) resolve({ stderr });
      else reject(new Error(eventError || stderr.trim().slice(-1800) || `${command} s'est arrêté avec le code ${code}.`));
    });
  });
}

async function mediaDuration(filePath) {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath
  ]);
  const duration = Number(stdout.trim());
  return Number.isFinite(duration) ? duration : 0;
}

async function fileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function makeSensitiveChunk(sourcePath, destinationPath, start, duration) {
  await run("ffmpeg", [
    "-y", "-i", sourcePath,
    "-ss", String(start),
    "-t", String(duration),
    "-vn", "-ac", "1", "-ar", "48000",
    "-c:a", "libmp3lame", "-b:a", "96k",
    destinationPath
  ]);
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr-FR")
    .replace(/[^a-z0-9' -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseParticipants(value) {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((item) => String(item || "").trim()).filter(Boolean)));
  }
  const raw = String(value || "").trim();
  if (!raw) return [];
  return Array.from(new Set(
    raw.split(/[\n;,|]+/)
      .map((item) => item.replace(/^[-•]\s*/, "").trim())
      .filter(Boolean)
  ));
}

function scanEscales() {
  if (!fs.existsSync(PROJECTS_ROOT)) return [];
  const escales = [];
  for (const projectEntry of fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true })) {
    if (!projectEntry.isDirectory()) continue;
    const meetingsRoot = path.join(PROJECTS_ROOT, projectEntry.name, "01_escales_reunions");
    if (!fs.existsSync(meetingsRoot)) continue;
    for (const meetingEntry of fs.readdirSync(meetingsRoot, { withFileTypes: true })) {
      if (!meetingEntry.isDirectory()) continue;
      const dataPath = path.join(meetingsRoot, meetingEntry.name, "donnees_escale.json");
      const data = readJsonIfExists(dataPath);
      if (!data) continue;
      const participants = parseParticipants(data.participants || data.presents || data.presentParticipants || []);
      escales.push({
        id: `${projectEntry.name}/${meetingEntry.name}`,
        projectSlug: projectEntry.name,
        meetingDirName: meetingEntry.name,
        projectName: data.projectName || projectEntry.name.replaceAll("_", " "),
        title: data.title || data.reportTitle || data.meetingType || meetingEntry.name.replaceAll("_", " "),
        meetingDate: data.meetingDate || data.date || "",
        meetingType: data.meetingType || "",
        participants,
        participantCount: participants.length,
        context: data.context || ""
      });
    }
  }
  return escales.sort((a, b) => String(b.meetingDate || b.meetingDirName).localeCompare(String(a.meetingDate || a.meetingDirName)));
}

function meetingById(id) {
  return scanEscales().find((item) => item.id === id) || null;
}

function normalizeContext(value, participants = [], meeting = null) {
  const pieces = [DEFAULT_CONTEXT];
  if (meeting?.title) pieces.push(`Réunion : ${meeting.title}.`);
  if (meeting?.projectName) pieces.push(`Projet : ${meeting.projectName}.`);
  if (participants.length) pieces.push(`Participants attendus : ${participants.join(", ")}.`);
  const user = String(value || "").trim();
  if (user) pieces.push(`Contexte fourni : ${user}`);
  return pieces.join(" ").slice(0, 3500);
}

function keywordsFromContext(value, participants = []) {
  const userTerms = String(value || "")
    .split(/[\n,;|]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && item.length <= 80 && !/[<>\r\n]/.test(item));
  return Array.from(new Set([...participants, ...userTerms])).slice(0, 80);
}

function runCurlJson(args) {
  return new Promise((resolve, reject) => {
    const marker = "\n__VOGUE_HTTP_STATUS__:";
    const child = spawn("curl", [
      "--silent", "--show-error", "--location",
      "--retry", "3", "--retry-delay", "2", "--retry-all-errors",
      "--connect-timeout", "20", "--max-time", "900",
      "--write-out", `${marker}%{http_code}`,
      ...args
    ], { stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => { stdout += data.toString(); });
    child.stderr.on("data", (data) => { stderr += data.toString(); });
    child.on("error", (error) => reject(new Error(`Impossible de démarrer curl : ${error.message}`)));
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(stderr.trim() || `curl s'est arrêté avec le code ${code}.`));
      const markerIndex = stdout.lastIndexOf(marker);
      if (markerIndex < 0) return reject(new Error("Réponse OpenAI illisible : code HTTP introuvable."));
      const body = stdout.slice(0, markerIndex);
      const status = Number(stdout.slice(markerIndex + marker.length).trim()) || 0;
      let payload;
      try { payload = JSON.parse(body); }
      catch { return reject(new Error(`Réponse OpenAI illisible (${status}).`)); }
      if (status < 200 || status >= 300) return reject(new Error(payload?.error?.message || `Erreur OpenAI (${status}).`));
      resolve(payload);
    });
  });
}

async function transcribePrimary(key, chunkPath, context, participants, meeting) {
  const args = [
    "--header", `Authorization: Bearer ${key}`,
    "--form", `file=@${chunkPath};type=audio/mpeg;filename=${path.basename(chunkPath)}`,
    "--form-string", `model=${PRIMARY_MODEL}`,
    "--form-string", "response_format=json",
    "--form-string", "languages[]=fr",
    "--form-string", "temperature=0",
    "--form-string", `prompt=${normalizeContext(context, participants, meeting)}`
  ];
  for (const keyword of keywordsFromContext(context, participants)) {
    args.push("--form-string", `keywords[]=${keyword}`);
  }
  args.push(OPENAI_URL);
  return runCurlJson(args);
}

async function transcribeLocal(jobId, sourcePath, progressStart = 5, progressEnd = 52) {
  const segments = [];
  const words = [];
  let duration = 0;

  await runJsonLines(LOCAL_PYTHON, [LOCAL_SCRIPT, sourcePath, "--model", LOCAL_MODEL, "--language", "fr"], (event) => {
    if (event.type === "audio_meta") {
      duration = Number(event.duration) || duration;
      writeStatus(jobId, { state: "transcribing", message: `Transcription locale renforcée (${formatClock(duration)})…`, duration, progress: progressStart });
    } else if (event.type === "engine_ready") {
      writeStatus(jobId, { state: "transcribing", message: `Transcription locale · ${LOCAL_MODEL}…`, duration, progress: progressStart + 2 });
    } else if (event.type === "segment") {
      const segment = {
        id: event.id || segments.length + 1,
        start: Number(event.start) || 0,
        end: Number(event.end) || Number(event.start) || 0,
        text: String(event.text || "").trim(),
        words: Array.isArray(event.words) ? event.words : []
      };
      segments.push(segment);
      for (const word of segment.words) words.push(word);
      const ratio = duration > 0 ? Math.min(1, segment.end / duration) : 0;
      writeStatus(jobId, {
        state: "transcribing",
        message: `Transcription locale… ${formatClock(segment.end)} / ${formatClock(duration)}`,
        progress: Math.round(progressStart + ratio * (progressEnd - progressStart)),
        duration,
        segmentCount: segments.length,
        wordCount: words.length
      });
    }
  });

  return { duration, segments, words };
}

async function diarizeLocal(jobId, sourcePath, expectedParticipantCount, progressStart = 55, progressEnd = 82) {
  if (!pyannoteInstalled()) throw new Error("Pyannote n'est pas installé. Lance npm run transcription:setup puis redémarre le moteur.");
  if (!hfToken()) throw new Error("Jeton Hugging Face absent pour Pyannote Community-1.");

  const diarization = [];
  const args = [DIARIZE_SCRIPT, sourcePath, "--token-file", HF_TOKEN_FILE];

  writeStatus(jobId, {
    state: "diarizing",
    message: expectedParticipantCount
      ? `Repérage local des interlocuteurs · ${expectedParticipantCount} personne${expectedParticipantCount > 1 ? "s" : ""} annoncée${expectedParticipantCount > 1 ? "s" : ""}…`
      : "Repérage local des interlocuteurs…",
    progress: progressStart
  });

  await runJsonLines(LOCAL_PYTHON, args, (event) => {
    if (event.type === "loading") {
      writeStatus(jobId, { state: "diarizing", message: "Chargement de Pyannote Community-1…", progress: progressStart + 2 });
    } else if (event.type === "speaker_segment") {
      diarization.push({
        id: event.id || diarization.length + 1,
        start: Number(event.start) || 0,
        end: Number(event.end) || Number(event.start) || 0,
        speaker: String(event.speaker || "?")
      });
      const p = Math.min(progressEnd - 1, progressStart + 4 + Math.floor(diarization.length / 15));
      writeStatus(jobId, { state: "diarizing", message: `Repérage des voix… ${diarization.length} passages`, progress: p });
    }
  });

  return diarization.sort((a, b) => a.start - b.start);
}

function speakerForInterval(start, end, diarization) {
  const midpoint = (start + end) / 2;
  const containing = diarization.find((item) => midpoint >= item.start && midpoint <= item.end);
  if (containing) return containing.speaker;

  let best = null;
  let bestOverlap = 0;
  for (const item of diarization) {
    const overlap = Math.max(0, Math.min(end, item.end) - Math.max(start, item.start));
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = item;
    }
  }
  return best?.speaker || "?";
}

function buildSpeakerTurns(local, diarization) {
  if (!diarization.length) {
    return local.segments.map((segment) => ({
      start: segment.start,
      end: segment.end,
      sourceSpeaker: "?",
      text: segment.text
    }));
  }

  const sourceWords = local.words.length
    ? local.words
    : local.segments.map((segment) => ({ start: segment.start, end: segment.end, word: ` ${segment.text}` }));

  const turns = [];
  for (const word of sourceWords) {
    const start = Number(word.start) || 0;
    const end = Number(word.end) || start;
    const speaker = speakerForInterval(start, end, diarization);
    const raw = String(word.word || "");
    if (!raw.trim()) continue;

    const previous = turns[turns.length - 1];
    if (previous && previous.sourceSpeaker === speaker && start - previous.end <= 1.4) {
      previous.end = Math.max(previous.end, end);
      previous.rawText += raw.startsWith(" ") ? raw : ` ${raw}`;
      previous.text = previous.rawText.trim();
    } else {
      turns.push({
        start,
        end,
        sourceSpeaker: speaker,
        rawText: raw,
        text: raw.trim()
      });
    }
  }
  return turns;
}

function introductionScore(text, participant) {
  const normalized = normalizeText(text);
  const name = normalizeText(participant);
  if (!normalized || !name) return 0;
  const selfCue = /\b(je suis|je m appelle|moi c est|mon nom est|je me presente|je me nomme)\b/.test(normalized);
  if (!selfCue) return 0;
  return normalized.includes(name) ? 10 : 0;
}

function mapSpeakersFromIntroductions(turns, participants) {
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

  const map = {};
  const usedParticipants = new Set();
  for (const candidate of candidates) {
    if (map[candidate.speaker] || usedParticipants.has(candidate.participant)) continue;
    map[candidate.speaker] = { name: candidate.participant, confidence: "presentation-explicite" };
    usedParticipants.add(candidate.participant);
  }

  const order = Object.fromEntries(speakers.map((speaker, index) => [speaker, index + 1]));
  return { map, order, detectedSpeakerCount: speakers.length };
}

function finalizeTurns(turns, participants) {
  const mapping = mapSpeakersFromIntroductions(turns, participants);
  const segments = turns.map((turn, index) => {
    const mapped = mapping.map[turn.sourceSpeaker];
    const fallbackNumber = mapping.order[turn.sourceSpeaker] || "?";
    return {
      id: index + 1,
      start: turn.start,
      end: turn.end,
      sourceSpeaker: turn.sourceSpeaker,
      speaker: mapped?.name || `Intervenant ${fallbackNumber}`,
      speakerConfidence: mapped?.confidence || "non-identifie",
      text: turn.text
    };
  });
  return { segments, speakerMapping: mapping.map, detectedSpeakerCount: mapping.detectedSpeakerCount };
}

function wordsForSimilarity(value) {
  return normalizeText(value).split(" ").filter((token) => token.length > 1);
}

function bigrams(tokens) {
  const set = new Set();
  for (let i = 0; i < tokens.length - 1; i += 1) set.add(`${tokens[i]} ${tokens[i + 1]}`);
  return set;
}

function textSimilarity(a, b) {
  const left = bigrams(wordsForSimilarity(a));
  const right = bigrams(wordsForSimilarity(b));
  if (!left.size || !right.size) return 0;
  let common = 0;
  for (const item of left) if (right.has(item)) common += 1;
  return (2 * common) / (left.size + right.size);
}

function localTextForRange(segments, start, end) {
  return segments
    .filter((segment) => segment.end >= start && segment.start <= end)
    .map((segment) => segment.text)
    .join(" ")
    .trim();
}

async function verifyWithGpt(jobId, sourcePath, duration, localSegments, context, participants, meeting, startProgress = 82) {
  const key = openAiKey();
  if (!key) throw new Error("Clé API OpenAI absente.");

  const starts = [];
  let cursor = 0;
  while (cursor < duration - 0.25) {
    starts.push(cursor);
    if (duration - cursor <= SENSITIVE_CHUNK_SECONDS) break;
    cursor += SENSITIVE_CHUNK_SECONDS - OVERLAP_SECONDS;
  }

  const verificationDir = path.join(jobDir(jobId), "verification");
  fs.mkdirSync(verificationDir, { recursive: true });
  const chunks = [];
  let processedSeconds = 0;

  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index];
    const chunkDuration = Math.min(SENSITIVE_CHUNK_SECONDS, duration - start);
    const chunkNumber = index + 1;
    const chunkPath = path.join(jobDir(jobId), `gpt_chunk_${String(chunkNumber).padStart(2, "0")}.mp3`);
    writeStatus(jobId, {
      state: "verifying",
      message: `Vérification GPT ${chunkNumber}/${starts.length}…`,
      progress: Math.round(startProgress + (index / starts.length) * (98 - startProgress)),
      currentChunk: chunkNumber,
      chunkCount: starts.length
    });
    await makeSensitiveChunk(sourcePath, chunkPath, start, chunkDuration);
    const primary = await transcribePrimary(key, chunkPath, context, participants, meeting);
    writeJson(path.join(verificationDir, `tranche_${String(chunkNumber).padStart(2, "0")}_gpt.json`), primary);
    const gptText = String(primary?.text || "").trim();
    const localText = localTextForRange(localSegments, start, start + chunkDuration);
    const similarity = textSimilarity(localText, gptText);
    chunks.push({
      chunk: chunkNumber,
      start,
      end: Math.min(duration, start + chunkDuration),
      localText,
      gptText,
      similarity,
      needsReview: similarity < 0.72
    });
    processedSeconds += chunkDuration;
    fs.rmSync(chunkPath, { force: true });
  }

  return {
    chunks,
    processedSeconds,
    estimatedCostUsd: (processedSeconds / 60) * GPT_COST_PER_MINUTE_USD
  };
}

function buildTranscriptMarkdown(meta, segments) {
  const lines = [
    "# Transcription — Vogue Marry",
    "",
    `- Fichier : ${meta.originalName}`,
    `- Durée : ${formatClock(meta.duration)}`,
    `- Mode : ${meta.mode === "high" ? "Contrôle renforcé · double lecture" : "Local renforcé · gratuit"}`,
    `- Texte structuré : Faster-Whisper ${LOCAL_MODEL}`,
    `- Interlocuteurs : ${meta.diarized ? `${DIARIZATION_MODEL} · local` : "non repérés"}`,
    meta.meeting?.title ? `- Escale : ${meta.meeting.title}` : null,
    meta.participants?.length ? `- Participants attendus : ${meta.participants.join(", ")}` : null,
    meta.mode === "high" ? `- Vérification indépendante : ${PRIMARY_MODEL}` : null,
    meta.mode === "high" ? `- Coût API estimé : ${meta.estimatedCostUsd.toFixed(2)} $` : "- Coût API : 0 $",
    "",
    "## Transcription structurée",
    ""
  ].filter(Boolean);

  for (const segment of segments) {
    lines.push(`[${formatClock(segment.start)}] ${segment.speaker} — ${segment.text}`);
    lines.push("");
  }

  if (meta.unresolvedSpeakers?.length) {
    lines.push("## Interlocuteurs à confirmer", "");
    for (const speaker of meta.unresolvedSpeakers) lines.push(`- ${speaker}`);
    lines.push("");
  }

  if (meta.reviewChunks?.length) {
    lines.push("## Passages à vérifier sur l'audio", "");
    for (const chunk of meta.reviewChunks) {
      lines.push(`- ${formatClock(chunk.start)} → ${formatClock(chunk.end)} · concordance locale/GPT ${Math.round(chunk.similarity * 100)} %`);
    }
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

function buildVerificationMarkdown(meta, verification) {
  const lines = [
    "# Vérification GPT — Vogue Marry",
    "",
    "Ce document est une seconde lecture indépendante. Il ne porte pas les noms des interlocuteurs afin d'éviter une attribution artificielle.",
    `- Modèle : ${PRIMARY_MODEL}`,
    `- Coût API estimé : ${verification.estimatedCostUsd.toFixed(2)} $`,
    ""
  ];
  for (const chunk of verification.chunks) {
    lines.push(`## ${formatClock(chunk.start)} → ${formatClock(chunk.end)}`);
    lines.push(`Concordance avec le local : ${Math.round(chunk.similarity * 100)} %${chunk.needsReview ? " · À vérifier" : ""}`);
    lines.push("");
    lines.push(chunk.gptText);
    lines.push("");
  }
  return `${lines.join("\n").trim()}\n`;
}

async function processJob(jobId, sourcePath, originalName, mode, context, participants, meeting) {
  const warnings = [];
  try {
    if (!localEngineReady()) throw new Error("Le moteur local n'est pas installé. Lance npm run transcription:setup.");
    const duration = await mediaDuration(sourcePath);
    if (!duration) throw new Error("Impossible de déterminer la durée de l'enregistrement.");

    const local = await transcribeLocal(jobId, sourcePath, 5, mode === "high" ? 48 : 58);
    writeJson(path.join(jobDir(jobId), "transcription_locale_brute.json"), local);

    let diarization = [];
    if (pyannoteInstalled() && hfToken()) {
      try {
        diarization = await diarizeLocal(jobId, sourcePath, participants.length, mode === "high" ? 50 : 62, mode === "high" ? 72 : 92);
        writeJson(path.join(jobDir(jobId), "diarisation_locale.json"), diarization);
      } catch (error) {
        warnings.push(`Repérage local des interlocuteurs indisponible : ${error.message}`);
      }
    } else {
      warnings.push("Repérage des interlocuteurs non activé : installe Pyannote et enregistre un jeton Hugging Face.");
    }

    const turns = buildSpeakerTurns(local, diarization);
    const structured = finalizeTurns(turns, participants);
    const unresolvedSpeakers = Array.from(new Set(
      structured.segments
        .filter((segment) => segment.speakerConfidence === "non-identifie")
        .map((segment) => segment.speaker)
    ));

    if (participants.length && structured.detectedSpeakerCount && structured.detectedSpeakerCount !== participants.length) {
      warnings.push(`${participants.length} participant${participants.length > 1 ? "s" : ""} attendu${participants.length > 1 ? "s" : ""}, ${structured.detectedSpeakerCount} voix détectée${structured.detectedSpeakerCount > 1 ? "s" : ""}.`);
    }

    let verification = null;
    if (mode === "high") {
      verification = await verifyWithGpt(jobId, sourcePath, duration, local.segments, context, participants, meeting, 74);
      writeJson(path.join(jobDir(jobId), "verification_gpt.json"), verification);
      const review = verification.chunks.filter((chunk) => chunk.needsReview);
      if (review.length) warnings.push(`${review.length} tranche${review.length > 1 ? "s" : ""} à vérifier : les deux moteurs divergent sensiblement.`);
    }

    const result = {
      jobId,
      originalName,
      duration,
      createdAt: timestamp(),
      mode,
      engine: "vogue-marry-transcription-v6",
      localModel: LOCAL_MODEL,
      diarizationModel: diarization.length ? DIARIZATION_MODEL : null,
      verificationModel: mode === "high" ? PRIMARY_MODEL : null,
      meeting,
      participants,
      participantCount: participants.length,
      detectedSpeakerCount: structured.detectedSpeakerCount,
      speakerMapping: structured.speakerMapping,
      unresolvedSpeakers,
      warnings,
      segments: structured.segments,
      localSegments: local.segments,
      verification: verification ? {
        estimatedCostUsd: verification.estimatedCostUsd,
        reviewChunks: verification.chunks.filter((chunk) => chunk.needsReview).map(({ chunk, start, end, similarity }) => ({ chunk, start, end, similarity }))
      } : null,
      text: structured.segments.map((segment) => `${segment.speaker} — ${segment.text}`).join("\n")
    };

    persistTranscriptionToMeeting(result);
    writeJson(path.join(jobDir(jobId), "transcription.json"), result);
    fs.writeFileSync(
      path.join(jobDir(jobId), "transcription.md"),
      buildTranscriptMarkdown({
        originalName,
        duration,
        mode,
        meeting,
        participants,
        diarized: diarization.length > 0,
        estimatedCostUsd: verification?.estimatedCostUsd || 0,
        unresolvedSpeakers,
        reviewChunks: verification?.chunks.filter((chunk) => chunk.needsReview) || []
      }, structured.segments),
      "utf8"
    );

    if (verification) {
      fs.writeFileSync(path.join(jobDir(jobId), "verification-gpt.md"), buildVerificationMarkdown({ originalName, duration }, verification), "utf8");
    }

    writeStatus(jobId, {
      state: "done",
      message: warnings.length ? "Transcription terminée avec points à vérifier." : "Transcription terminée.",
      progress: 100,
      duration,
      segmentCount: structured.segments.length,
      participantCount: participants.length,
      detectedSpeakerCount: structured.detectedSpeakerCount,
      estimatedCostUsd: verification?.estimatedCostUsd || 0,
      warnings,
      resultReady: true,
      persistedToMeeting: result.persistedToMeeting
    });
  } catch (error) {
    writeStatus(jobId, { state: "error", message: error.message || "Échec de la transcription.", progress: 0 });
  }
}

function cacheSignature(audioHash, mode, participants, context, meetingId) {
  return createHash("sha256")
    .update(JSON.stringify({ audioHash, mode, participants, context: String(context || "").trim(), meetingId: meetingId || "" }))
    .digest("hex");
}

function findReusableJob(cacheKey) {
  if (!fs.existsSync(ROOT)) return null;
  const reusableStates = new Set(["queued", "transcribing", "diarizing", "verifying", "done"]);
  const entries = fs.readdirSync(ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .sort((a, b) => b.name.localeCompare(a.name));
  for (const entry of entries) {
    const status = readJsonIfExists(statusPath(entry.name));
    if (!status || !reusableStates.has(status.state) || status.cacheKey !== cacheKey) continue;
    if (status.state === "done" && !fs.existsSync(path.join(jobDir(entry.name), "transcription.json"))) continue;
    return { jobId: entry.name, state: status.state };
  }
  return null;
}

const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      const tempDir = path.join(ROOT, "_uploads");
      fs.mkdirSync(tempDir, { recursive: true });
      cb(null, tempDir);
    },
    filename(req, file, cb) {
      cb(null, `${Date.now()}_${randomUUID()}_${safeName(file.originalname)}`);
    }
  }),
  limits: { fileSize: 1024 * 1024 * 1024, files: 1 }
});


function speakerMeetingDataPath(meetingId) {
  const value = String(meetingId || "");
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) return null;
  const projectSlug = value.slice(0, slash);
  const meetingDir = value.slice(slash + 1);
  if (!/^[A-Za-z0-9._-]+$/.test(projectSlug) || !/^[A-Za-z0-9._-]+$/.test(meetingDir)) return null;
  if ([projectSlug, meetingDir].some((part) => part === "." || part === "..")) return null;
  const resolved = path.resolve(PROJECTS_ROOT, projectSlug, "01_escales_reunions", meetingDir, "donnees_escale.json");
  const root = path.resolve(PROJECTS_ROOT) + path.sep;
  return resolved.startsWith(root) ? resolved : null;
}

function cleanSpeakerMapping(mapping, participants) {
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) return {};
  const allowed = new Set((participants || []).map((name) => String(name || "").trim()).filter(Boolean));
  const clean = {};
  for (const [sourceSpeaker, rawName] of Object.entries(mapping)) {
    const speaker = String(sourceSpeaker || "").trim();
    const name = String(rawName || "").trim();
    if (!speaker || !name) continue;
    if (allowed.size && !allowed.has(name)) continue;
    clean[speaker] = name;
  }
  return clean;
}

function buildCorrectedTranscriptMarkdown(result) {
  const lines = [
    "# Transcription — Vogue Marry",
    "",
    `- Fichier : ${result.originalName || ""}`,
    result.duration ? `- Durée : ${formatClock(result.duration)}` : null,
    result.meeting?.title ? `- Escale : ${result.meeting.title}` : null,
    result.participants?.length ? `- Participants : ${result.participants.join(", ")}` : null,
    result.mode === "high" ? "- Mode : Contrôle renforcé · double lecture" : "- Mode : Local renforcé · gratuit",
    result.mode === "high" && Number.isFinite(Number(result.verification?.estimatedCostUsd))
      ? `- Coût API estimé : ${Number(result.verification.estimatedCostUsd).toFixed(2)} $`
      : "- Coût API : 0 $",
    result.speakerConfirmationsUpdatedAt ? `- Interlocuteurs confirmés : ${result.speakerConfirmationsUpdatedAt}` : null,
    result.warnings?.length ? `- Avertissements : ${result.warnings.join(" | ")}` : null,
    "",
    "## Transcription",
    ""
  ].filter(Boolean);

  for (const segment of result.segments || []) {
    lines.push(`[${formatClock(segment.start)}] ${segment.speaker || "Intervenant"} — ${segment.text || ""}`);
    lines.push("");
  }

  if (result.unresolvedSpeakers?.length) {
    lines.push("## Interlocuteurs restant à confirmer", "");
    for (const speaker of result.unresolvedSpeakers) lines.push(`- ${speaker}`);
    lines.push("");
  }

  if (result.verification?.reviewChunks?.length) {
    lines.push("## Passages à vérifier sur l'audio", "");
    for (const chunk of result.verification.reviewChunks) {
      lines.push(`- ${formatClock(chunk.start)} → ${formatClock(chunk.end)} · concordance locale/GPT ${Math.round((Number(chunk.similarity) || 0) * 100)} %`);
    }
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

const TRANSCRIPTION_SECTION_START = "<!-- VOGUE_MARRY_TRANSCRIPTION_START -->";
const TRANSCRIPTION_SECTION_END = "<!-- VOGUE_MARRY_TRANSCRIPTION_END -->";

function buildJournalTranscriptionSection(result) {
  const lines = [
    TRANSCRIPTION_SECTION_START,
    "## Transcription automatique V6",
    "",
    `- Job : ${result.jobId || ""}`,
    `- Fichier audio : ${result.originalName || ""}`,
    `- Mode : ${result.mode === "high" ? "Contrôle renforcé" : "Local renforcé"}`,
    result.localModel ? `- Modèle local : Faster-Whisper ${result.localModel}` : null,
    result.speakerConfirmationsUpdatedAt ? `- Interlocuteurs confirmés : ${result.speakerConfirmationsUpdatedAt}` : null,
    "",
    "### Interventions",
    ""
  ].filter(Boolean);

  for (const segment of result.segments || []) {
    lines.push(`[${formatClock(segment.start)}] ${segment.speaker || "Intervenant"} — ${segment.text || ""}`);
    lines.push("");
  }

  if (result.unresolvedSpeakers?.length) {
    lines.push("### Interlocuteurs à confirmer", "");
    for (const speaker of result.unresolvedSpeakers) lines.push(`- ${speaker}`);
    lines.push("");
  }

  if (result.warnings?.length) {
    lines.push("### Points de vigilance", "");
    for (const warning of result.warnings) lines.push(`- ${warning}`);
    lines.push("");
  }

  lines.push(TRANSCRIPTION_SECTION_END);
  return `${lines.join("\n").trim()}\n`;
}

function replaceManagedJournalSection(content, section) {
  const start = content.indexOf(TRANSCRIPTION_SECTION_START);
  const end = content.indexOf(TRANSCRIPTION_SECTION_END);
  if (start >= 0 && end > start) {
    const before = content.slice(0, start).trimEnd();
    const after = content.slice(end + TRANSCRIPTION_SECTION_END.length).trimStart();
    return `${[before, section.trim(), after].filter(Boolean).join("\n\n")}\n`;
  }
  return `${content.trimEnd()}\n\n${section.trim()}\n`;
}

function persistTranscriptionToMeeting(result) {
  result.persistedToMeeting = false;
  const meetingId = result.meeting?.id || "";
  const dataPath = speakerMeetingDataPath(meetingId);
  if (!dataPath || !fs.existsSync(dataPath)) return false;

  try {
    const meetingDir = path.dirname(dataPath);
    const transcriptionJsonPath = path.join(meetingDir, "transcription_v6.json");
    const transcriptionMarkdownPath = path.join(meetingDir, "transcription_v6.md");
    const journalPath = path.join(meetingDir, "journal_de_bord_exporte.md");

    writeJson(transcriptionJsonPath, result);
    fs.writeFileSync(transcriptionMarkdownPath, buildCorrectedTranscriptMarkdown(result), "utf8");

    const data = readJsonIfExists(dataPath) || {};
    data.transcription = {
      jobId: result.jobId,
      status: "terminee",
      updatedAt: result.speakerConfirmationsUpdatedAt || timestamp(),
      mode: result.mode,
      resultFileName: path.basename(transcriptionJsonPath),
      markdownFileName: path.basename(transcriptionMarkdownPath),
      unresolvedSpeakers: result.unresolvedSpeakers || []
    };
    writeJson(dataPath, data);

    if (fs.existsSync(journalPath)) {
      const currentJournal = fs.readFileSync(journalPath, "utf8");
      fs.writeFileSync(journalPath, replaceManagedJournalSection(currentJournal, buildJournalTranscriptionSection(result)), "utf8");
    }

    result.persistedToMeeting = true;
    return true;
  } catch (error) {
    result.warnings = Array.from(new Set([
      ...(result.warnings || []),
      `Journal de bord non mis à jour : ${error.message || "erreur locale"}`
    ]));
    return false;
  }
}

function persistSpeakerMappingToMeeting(result, status, mapping, updatedAt) {
  const meetingId = result.meeting?.id || status?.meetingId || "";
  const dataPath = speakerMeetingDataPath(meetingId);
  if (!dataPath || !fs.existsSync(dataPath)) return false;

  const data = readJsonIfExists(dataPath) || {};
  const confirmations = data.transcriptionSpeakerConfirmations && typeof data.transcriptionSpeakerConfirmations === "object"
    ? data.transcriptionSpeakerConfirmations
    : {};

  confirmations[result.jobId] = {
    updatedAt,
    originalName: result.originalName || "",
    mapping
  };

  data.transcriptionSpeakerConfirmations = confirmations;
  writeJson(dataPath, data);
  return true;
}

app.post("/api/transcription/:jobId/speakers", (req, res) => {
  try {
    const dir = requestJobDir(req.params.jobId);
    if (!dir) return res.status(400).json({ error: "Identifiant de transcription invalide." });

    const resultPath = path.join(dir, "transcription.json");
    const jobStatusPath = path.join(dir, "status.json");
    if (!fs.existsSync(resultPath)) return res.status(404).json({ error: "Transcription introuvable ou inachevée." });

    const result = readJson(resultPath);
    const status = readJsonIfExists(jobStatusPath) || {};
    const mapping = cleanSpeakerMapping(req.body?.mapping, result.participants || []);
    if (!Object.keys(mapping).length) return res.status(400).json({ error: "Aucune correspondance d'interlocuteur valide." });

    const updatedAt = new Date().toISOString();
    const mergedOverrides = { ...(result.speakerOverrides || {}), ...mapping };

    result.segments = (result.segments || []).map((segment) => {
      const confirmed = mergedOverrides[segment.sourceSpeaker];
      return confirmed
        ? { ...segment, speaker: confirmed, speakerConfidence: "confirme-manuel" }
        : segment;
    });
    result.speakerOverrides = mergedOverrides;
    result.unresolvedSpeakers = Array.from(new Set(
      result.segments
        .filter((segment) => segment.speakerConfidence === "non-identifie")
        .map((segment) => segment.speaker)
        .filter(Boolean)
    ));
    result.speakerConfirmationsUpdatedAt = updatedAt;
    result.text = result.segments.map((segment) => `${segment.speaker || "Intervenant"} — ${segment.text || ""}`).join("\n");

    writeJson(resultPath, result);
    fs.writeFileSync(path.join(dir, "transcription.md"), buildCorrectedTranscriptMarkdown(result), "utf8");

    const persistedToMeeting = persistSpeakerMappingToMeeting(result, status, mergedOverrides, updatedAt);
    persistTranscriptionToMeeting(result);
    writeJson(jobStatusPath, {
      ...status,
      jobId: result.jobId,
      speakerConfirmationsUpdatedAt: updatedAt,
      speakerConfirmationsPersistedToMeeting: persistedToMeeting,
      persistedToMeeting: result.persistedToMeeting,
      updatedAt
    });

    return res.json({
      status: "ok",
      persistedToMeeting,
      mapping: mergedOverrides,
      unresolvedSpeakers: result.unresolvedSpeakers,
      result
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Impossible d'enregistrer les interlocuteurs." });
  }
});

app.get("/api/transcription/health", (req, res) => {
  const localReady = localEngineReady();
  const pyannoteReady = pyannoteInstalled();
  res.json({
    status: "ok",
    service: "vogue-marry-transcription",
    version: 6,
    localEngineReady: localReady,
    localModel: LOCAL_MODEL,
    pyannoteInstalled: pyannoteReady,
    huggingFaceConfigured: Boolean(hfToken()),
    localDiarizationReady: pyannoteReady && Boolean(hfToken()),
    diarizationModel: DIARIZATION_MODEL,
    openAIConfigured: Boolean(openAiKey()),
    highPrecisionReady: localReady && Boolean(openAiKey()),
    highPrecisionModel: PRIMARY_MODEL,
    paidSpeakerDiarization: false,
    sensitiveCostPerMinuteUsd: GPT_COST_PER_MINUTE_USD,
    speakerRecognitionCostUsd: 0,
    participantAware: true,
    cacheEnabled: true,
    recoverableJobs: true,
    host: "127.0.0.1",
    port: PORT
  });
});

app.get("/api/transcription/escales", (req, res) => {
  res.json({ escales: scanEscales() });
});

app.post("/api/transcription/config/api-key", (req, res) => {
  const key = String(req.body?.apiKey || "").trim();
  if (!/^sk-/.test(key) || key.length < 20) return res.status(400).json({ error: "Cette clé API ne semble pas valide." });
  fs.writeFileSync(API_KEY_FILE, `${key}\n`, { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(API_KEY_FILE, 0o600);
  return res.json({ status: "ok", openAIConfigured: true });
});

app.delete("/api/transcription/config/api-key", (req, res) => {
  if (fs.existsSync(API_KEY_FILE)) fs.unlinkSync(API_KEY_FILE);
  return res.json({ status: "ok", openAIConfigured: false });
});

app.post("/api/transcription/config/hf-token", (req, res) => {
  const token = String(req.body?.token || "").trim();
  if (!token || token.length < 15) return res.status(400).json({ error: "Ce jeton Hugging Face ne semble pas valide." });
  fs.writeFileSync(HF_TOKEN_FILE, `${token}\n`, { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(HF_TOKEN_FILE, 0o600);
  return res.json({ status: "ok", huggingFaceConfigured: true });
});

app.delete("/api/transcription/config/hf-token", (req, res) => {
  if (fs.existsSync(HF_TOKEN_FILE)) fs.unlinkSync(HF_TOKEN_FILE);
  return res.json({ status: "ok", huggingFaceConfigured: false });
});

app.post("/api/transcription", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) throw new Error("Aucun enregistrement reçu.");
    const mode = req.body?.mode === "high" ? "high" : "local";
    if (mode === "high" && !openAiKey()) throw new Error("Clé API OpenAI absente pour le mode dossier sensible.");

    const meetingId = String(req.body?.meetingId || "").trim();
    const meeting = meetingId ? meetingById(meetingId) : null;
    let participants = meeting?.participants || [];
    if (!participants.length) {
      try { participants = parseParticipants(JSON.parse(req.body?.participantsJson || "[]")); }
      catch { participants = parseParticipants(req.body?.participants || ""); }
    }
    const context = String(req.body?.context || meeting?.context || "").trim();
    const audioHash = await fileSha256(req.file.path);
    const cacheKey = cacheSignature(audioHash, mode, participants, context, meetingId);
    const reusableJob = findReusableJob(cacheKey);
    if (reusableJob) {
      fs.unlinkSync(req.file.path);
      return res.status(200).json({
        status: reusableJob.state === "done" ? "cached" : "already-running",
        jobId: reusableJob.jobId,
        mode,
        cached: reusableJob.state === "done",
        alreadyRunning: reusableJob.state !== "done"
      });
    }

    const jobId = `${new Date().toISOString().replace(/[:.]/g, "-")}_${randomUUID().slice(0, 8)}`;
    const dir = jobDir(jobId);
    fs.mkdirSync(dir, { recursive: true });
    const extension = path.extname(req.file.originalname || "") || ".audio";
    const sourcePath = path.join(dir, `audio_original${extension}`);
    fs.renameSync(req.file.path, sourcePath);

    writeStatus(jobId, {
      state: "queued",
      message: "Enregistrement reçu.",
      progress: 0,
      originalName: req.file.originalname,
      size: req.file.size,
      createdAt: timestamp(),
      mode,
      engine: "vogue-marry-transcription-v6",
      context,
      meetingId,
      meeting,
      participants,
      participantCount: participants.length,
      audioHash,
      cacheKey
    });

    setImmediate(() => processJob(jobId, sourcePath, req.file.originalname, mode, context, participants, meeting));
    return res.status(202).json({ status: "accepted", jobId, mode, participantCount: participants.length });
  } catch (error) {
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: error.message || "Impossible de recevoir l'audio." });
  }
});

app.get("/api/transcription/:jobId", (req, res) => {
  const dir = requestJobDir(req.params.jobId);
  if (!dir) return res.status(400).json({ error: "Identifiant de transcription invalide." });
  const filePath = path.join(dir, "status.json");
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Transcription inconnue." });
  return res.json(readJson(filePath));
});

app.get("/api/transcription/:jobId/result", (req, res) => {
  const dir = requestJobDir(req.params.jobId);
  if (!dir) return res.status(400).json({ error: "Identifiant de transcription invalide." });
  const filePath = path.join(dir, "transcription.json");
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Résultat pas encore disponible." });
  return res.json(readJson(filePath));
});

app.get("/api/transcription/:jobId/download", (req, res) => {
  const dir = requestJobDir(req.params.jobId);
  if (!dir) return res.status(400).json({ error: "Identifiant de transcription invalide." });
  const filePath = path.join(dir, "transcription.md");
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Résultat pas encore disponible." });
  return res.download(filePath, "transcription-vogue-marry.md");
});

app.get("/api/transcription/:jobId/download-verification", (req, res) => {
  const dir = requestJobDir(req.params.jobId);
  if (!dir) return res.status(400).json({ error: "Identifiant de transcription invalide." });
  const filePath = path.join(dir, "verification-gpt.md");
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Vérification GPT indisponible pour cette transcription." });
  return res.download(filePath, "verification-gpt-vogue-marry.md");
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Vogue Marry — transcription v6 : http://127.0.0.1:${PORT}`);
  console.log(`Local : ${LOCAL_MODEL} + ${DIARIZATION_MODEL}.`);
  console.log(`Contrôle renforcé : local complet + seconde lecture ${PRIMARY_MODEL}.`);
  console.log("La diarisation des interlocuteurs est locale et gratuite.");
});
