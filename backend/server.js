import express from "express";
import cors from "cors";
import fs from "fs";
import http from "http";
import path from "path";
import os from "os";
import multer from "multer";
import { safeSegment, safePathInside } from "./lib/path-guards.js";
import { createProjectReader } from "./lib/project-reader.js";
import { makeProjectCreator } from "./lib/project-creator.js";
import { normalizeLogPoseManual } from "./lib/log-pose-normalization.js";
import { makeLogPoseReader } from "./lib/log-pose-reader.js";
import { makeLogPoseWriter } from "./lib/log-pose-writer.js";
import { makeLogPoseSynthesis } from "./lib/log-pose-synthesis.js";
import { normalizeKnowledgeText, extractMarkdownSection, parseKnowledgeSection, pickKnowledgeValue } from "./lib/knowledge-markdown.js";

const app = express();
const PORT = 8010;
const TRANSCRIPTION_HOST = "127.0.0.1";
const TRANSCRIPTION_PORT = Number(process.env.VOGUE_TRANSCRIPTION_PORT || 8011);
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);

const HOME = os.homedir();
const DATA_ROOT = path.join(HOME, "VOGUE-MERRY-DONNEES");
const PROJECTS_ROOT = path.join(DATA_ROOT, "01_PROJETS");
const WATER_SEVEN_ROOT = path.join(DATA_ROOT, "00_WATER_SEVEN_PORT_ENTREE");
const ALLOWED_ORIGINS = new Set([
  "http://127.0.0.1:5173",
  "http://localhost:5173"
]);
const DOCUMENT_EXTENSIONS = new Set([
  ".csv",
  ".doc",
  ".docx",
  ".gif",
  ".htm",
  ".html",
  ".jpeg",
  ".jpg",
  ".json",
  ".md",
  ".odt",
  ".pdf",
  ".png",
  ".ppt",
  ".pptx",
  ".rtf",
  ".txt",
  ".webp",
  ".xls",
  ".xlsx",
  ".xml",
  ".yaml",
  ".yml"
]);

// Refuse les noms d'hôte arbitraires, y compris en cas de DNS rebinding.
app.use((req, res, next) => {
  const allowedHosts = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
  if (!allowedHosts.has(req.headers.host)) {
    return res.status(403).json({ error: "Hôte local non autorisé." });
  }
  next();
});

// Bloque les requêtes mutantes signalées comme intersites par le navigateur.
// Les clients locaux sans Origin et sans Fetch Metadata restent compatibles.
app.use((req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.headers.origin;
  const fetchSite = req.headers["sec-fetch-site"];
  if ((origin && !ALLOWED_ORIGINS.has(origin)) || fetchSite === "cross-site") {
    return res.status(403).json({ error: "Modification depuis une origine non autorisée." });
  }
  next();
});

app.use(cors({
  origin(origin, callback) {
    if (!origin || ALLOWED_ORIGINS.has(origin)) return callback(null, true);
    return callback(new Error("Origine non autorisée."));
  },
  methods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));

function proxyTranscriptionRequest(req, res) {
  const headers = { ...req.headers, host: `${TRANSCRIPTION_HOST}:${TRANSCRIPTION_PORT}` };
  HOP_BY_HOP_HEADERS.forEach((header) => delete headers[header]);

  const proxy = http.request({
    hostname: TRANSCRIPTION_HOST,
    port: TRANSCRIPTION_PORT,
    method: req.method,
    path: req.originalUrl || req.url,
    headers
  }, (upstream) => {
    res.statusCode = upstream.statusCode || 502;
    Object.entries(upstream.headers).forEach(([header, value]) => {
      if (!HOP_BY_HOP_HEADERS.has(header) && value !== undefined) res.setHeader(header, value);
    });
    upstream.pipe(res);
  });

  proxy.on("error", () => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.status(503).json({ error: "Le moteur de transcription local est indisponible." });
  });

  req.on("aborted", () => proxy.destroy());
  req.pipe(proxy);
}

// 8010 est la seule porte utilisée par l'interface. V6 reste un moteur local interne.
app.use("/api/transcription", proxyTranscriptionRequest);
app.use(express.json({ limit: "1mb" }));
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 150 * 1024 * 1024, files: 1 }
});

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeFileIfMissing(filePath, content) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, content, "utf8");
  }
}

function safeExistingFileInside(root, filePath) {
  const realRoot = fs.realpathSync(root);
  const realFile = fs.realpathSync(filePath);
  if (!realFile.startsWith(realRoot + path.sep)) {
    throw new Error("Source située hors du dossier autorisé.");
  }
  return realFile;
}

function timestampForFile() {
  return new Date().toISOString().replace("T", "_").replace(/:/g, "-").replace(/\..+/, "");
}

function createFileVersion(filePath, reason = "version") {
  if (!fs.existsSync(filePath)) return null;

  const dir = path.dirname(filePath);
  const versionsDir = path.join(dir, "99_versions");
  ensureDir(versionsDir);

  const parsed = path.parse(filePath);
  const baseVersionName = `${timestampForFile()}_${parsed.name}_${reason}`;
  let versionPath = path.join(versionsDir, `${baseVersionName}${parsed.ext}`);
  let duplicateIndex = 2;
  while (fs.existsSync(versionPath)) {
    versionPath = path.join(versionsDir, `${baseVersionName}_${duplicateIndex}${parsed.ext}`);
    duplicateIndex += 1;
  }
  fs.copyFileSync(filePath, versionPath);
  return versionPath;
}

const WATER_SEVEN_PROJECTS = [
  { name: "BPM interne", keys: ["bpm", "process", "workflow", "architecture", "api"] },
  { name: "Transcription IA", keys: ["audio", "transcription", "whisper", "compte rendu", "reunion", "réunion"] },
  { name: "Portail client", keys: ["client", "ux", "portail", "interface", "maquette"] },
  { name: "Veille outils", keys: ["veille", "outil", "comparatif", "benchmark"] }
];

function detectDate(text) {
  const datePattern = /(\d{1,2})[-_\s]?(janvier|fevrier|février|mars|avril|mai|juin|juillet|aout|août|septembre|octobre|novembre|decembre|décembre|\d{1,2})/i;
  const result = String(text || "").match(datePattern);
  return result ? result[0].replaceAll("_", " ") : "À confirmer";
}

function readTextPreview(file) {
  const extension = path.extname(file.originalname || "").toLowerCase();
  const textExtensions = new Set([".txt", ".md", ".csv", ".json"]);
  if (!textExtensions.has(extension)) return "";
  return file.buffer.toString("utf8").slice(0, 6000);
}

function analyseWaterSevenDocument(file) {
  const originalName = file?.originalname || "document_sans_nom";
  const contentPreview = readTextPreview(file);
  const text = `${originalName}\n${contentPreview}`.toLowerCase();
  const ext = path.extname(originalName).replace(".", "").toLowerCase() || "inconnu";

  const score = WATER_SEVEN_PROJECTS.map((project) => ({
    name: project.name,
    score: project.keys.reduce((total, key) => total + (text.includes(key) ? 1 : 0), 0)
  })).sort((a, b) => b.score - a.score)[0];

  const project = score.score > 0 ? score.name : "À confirmer";
  const isAudio = ["mp3", "wav", "m4a", "ogg", "webm"].includes(ext);
  const isImage = ["png", "jpg", "jpeg", "webp"].includes(ext);
  const isMeeting = /cr|reunion|réunion|compte.?rendu|escale|ordre du jour|participants/.test(text);
  const isDecision = /decision|décision|valide|validé|arbitrage|accord|acté|acte/.test(text);
  const isAction = /action|todo|relance|a-faire|à faire|faire|envoyer|prevoir|prévoir|responsable|échéance|echeance/.test(text);
  const isDoc = /pdf|doc|docx|txt|md|contrat|facture|scan|api|documentation|lien/.test(text);

  let category = "Épaves à trier";
  let target = "Water Seven";
  let reason = "Type ou projet encore flou";

  if (isAudio) {
    category = "Trace audio";
    target = "Traces audio";
    reason = "extension audio détectée";
  } else if (isDecision) {
    category = "Cap validé";
    target = "Caps validés";
    reason = "mot-clé de décision détecté";
  } else if (isMeeting) {
    category = "Compte-rendu / réunion";
    target = "Journal de bord + Escales";
    reason = "mot-clé réunion ou compte-rendu détecté";
  } else if (isAction) {
    category = "Manœuvre";
    target = "Manœuvres";
    reason = "mot-clé action détecté";
  } else if (isImage) {
    category = "Image / capture";
    target = "Coffre";
    reason = "extension image détectée";
  } else if (isDoc) {
    category = "Document";
    target = "Coffre";
    reason = "document ou lien détecté";
  }

  const warnings = [];
  if (project === "À confirmer") warnings.push("Île/projet incertain");
  if (detectDate(text) === "À confirmer") warnings.push("Date absente ou illisible");
  if (category === "Épaves à trier") warnings.push("Type de pièce à confirmer");
  if (isAction && !/mateo|sofia|client|equipe|équipe|responsable/.test(text)) warnings.push("Action possible sans responsable détecté");

  const confidence = warnings.length === 0 ? "🧭 Cap clair" : warnings.length <= 2 ? "🌫️ Brouillard" : "⚠️ Récif";

  return {
    fileName: originalName,
    extension: ext,
    size: `${Math.max(1, Math.round((file?.size || 0) / 1024))} Ko`,
    project,
    category,
    target,
    date: detectDate(text),
    reason,
    confidence,
    warnings,
    preview: contentPreview ? contentPreview.slice(0, 800) : "Lecture du contenu prévue en étape suivante pour ce type de fichier."
  };
}

const createProjectStructure = makeProjectCreator({ projectsRoot: PROJECTS_ROOT, slugify, safePathInside, ensureDir, writeFileIfMissing, syncLogPose: (...args) => syncLogPose(...args), readProjectRecord: (...args) => readProjectRecord(...args) });

const readProjectRecord = createProjectReader({ projectsRoot: PROJECTS_ROOT, safePathInside, readJsonIfExists });

function readJsonIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function readMeetingData(meetingDir) {
  return readJsonIfExists(path.join(meetingDir, "donnees_escale.json"));
}

function findMeetingDir(projectSlug, meetingDirName) {
  const safeProjectSlug = safeSegment(projectSlug);
  const safeMeetingDirName = safeSegment(meetingDirName);
  if (!safeProjectSlug || !safeMeetingDirName) throw new Error("Projet ou escale invalide.");
  return safePathInside(PROJECTS_ROOT, safeProjectSlug, "01_escales_reunions", safeMeetingDirName);
}

function findReportPaths(meetingDir) {
  return {
    validatedPath: path.join(meetingDir, "journal_de_bord_valide.md"),
    exportedPath: path.join(meetingDir, "journal_de_bord_exporte.md")
  };
}

const KNOWLEDGE_CONFIG = {
  action: {
    label: "Manœuvres",
    folder: "03_manoeuvres_actions",
    fileName: "manoeuvres_actions.json",
    markdownName: "manoeuvres_actions.md",
    textField: "action"
  },
  decision: {
    label: "Caps validés",
    folder: "02_caps_valides_decisions",
    fileName: "caps_valides.json",
    markdownName: "caps_valides.md",
    textField: "decision"
  },
  need: {
    label: "Besoins",
    folder: "05_ecrans_parcours",
    fileName: "besoins.json",
    markdownName: "besoins.md",
    textField: "need"
  }
};

const KNOWLEDGE_HEADINGS = {
  action: ["manœuvres / actions à faire", "manoeuvres / actions à faire", "actions à mener"],
  decision: ["caps validés / décisions prises", "caps valides / decisions prises", "décisions actées", "repères validés"],
  need: ["écrans / fonctionnalités concernés", "ecrans / fonctionnalites concernes", "besoins identifiés", "besoins identifies", "besoins"]
};

function knowledgeItemId(kind, projectSlug, meetingDirName, index, text) {
  const compactText = slugify(text).slice(0, 48) || "a_completer";
  return `${kind}:${projectSlug}:${meetingDirName}:${index}:${compactText}`;
}

function knowledgeSource(data, meetingDirName) {
  return `Journal de bord — ${data?.title || meetingDirName}`;
}

function makeKnowledgeItem(kind, projectSlug, meetingDirName, data, row, index, origin = "journal") {
  const config = KNOWLEDGE_CONFIG[kind];
  const text = pickKnowledgeValue(row, kind === "action"
    ? ["action", "manœuvre / action", "manoeuvre / action", "manœuvre"]
    : kind === "decision"
      ? ["cap validé / décision", "cap valide / decision", "décision", "decision", "repère validé"]
      : ["need", "besoin", "besoin utilisateur", "écran / fonctionnalité", "ecran / fonctionnalite", "fonctionnalité", "fonctionnalite"]);
  const meetingDate = data?.meetingDate || meetingDirName.slice(0, 10);
  const item = {
    id: knowledgeItemId(kind, projectSlug, meetingDirName, index, text),
    kind,
    reviewStatus: "à valider",
    projectSlug,
    projectName: data?.projectName || projectSlug.replaceAll("_", " "),
    meetingDirName,
    date: pickKnowledgeValue(row, ["date"]) || meetingDate,
    source: pickKnowledgeValue(row, ["source"]) || knowledgeSource(data, meetingDirName),
    origin,
    needsDetail: !text
  };

  if (kind === "action") {
    item.action = text;
    item.responsable = pickKnowledgeValue(row, ["responsable", "responsable(s)"]);
    item.echeance = pickKnowledgeValue(row, ["échéance", "echeance", "date"]);
    item.statut = pickKnowledgeValue(row, ["statut", "status"]) || "À préciser";
    item.decisionId = pickKnowledgeValue(row, ["décision liée", "decision liee"]);
    item.documentId = pickKnowledgeValue(row, ["document lié", "document lie"]);
  } else if (kind === "decision") {
    item.decision = text;
    item.impact = pickKnowledgeValue(row, ["impact", "conséquence", "consequence"]);
    item.statut = pickKnowledgeValue(row, ["statut", "status"]) || "À préciser";
  } else {
    item.need = text;
    item.context = pickKnowledgeValue(row, ["contexte / preuve", "contexte", "preuve", "objectif"]);
    item.priority = pickKnowledgeValue(row, ["priorité", "priorite"]) || "À préciser";
    item.statut = pickKnowledgeValue(row, ["statut", "status"]) || "À préciser";
  }

  return { ...item, needsDetail: origin === "marqueur" || item.needsDetail || !item[config.textField] };
}

function meetingMarkerRows(data) {
  try {
    const markers = JSON.parse(String(data?.rawNotes || ""));
    if (!Array.isArray(markers)) return [];
    return markers
      .filter((marker) => marker?.type === "action" || marker?.type === "decision" || marker?.type === "need")
      .map((marker) => ({
        type: marker.type,
        text: marker.text || marker.content || marker.note || `${marker.label || (marker.type === "action" ? "Action" : marker.type === "decision" ? "Décision" : "Besoin")} repéré à ${marker.timeLabel || "un moment de l’escale"} — à préciser`
      }));
  } catch {
    return [];
  }
}

function extractKnowledgeFromMeeting(projectSlug, meetingEntry, data, content, kind) {
  const rows = parseKnowledgeSection(extractMarkdownSection(content, KNOWLEDGE_HEADINGS[kind]), kind);
  const items = rows.map((row, index) => makeKnowledgeItem(kind, projectSlug, meetingEntry.name, data, row, index));
  const seenTexts = new Set(items.map((item) => normalizeKnowledgeText(item[KNOWLEDGE_CONFIG[kind].textField])));
  const markerRows = meetingMarkerRows(data).filter((marker) => marker.type === kind);
  const markerOffset = items.length;
  markerRows.forEach((marker, index) => {
    const item = makeKnowledgeItem(kind, projectSlug, meetingEntry.name, data, {
      [kind === "action" ? "action" : kind === "decision" ? "decision" : "need"]: marker.text
    }, markerOffset + index, "marqueur");
    const normalizedText = normalizeKnowledgeText(item[KNOWLEDGE_CONFIG[kind].textField]);
    if (!seenTexts.has(normalizedText)) {
      items.push(item);
      seenTexts.add(normalizedText);
    }
  });
  return items;
}

function readKnowledgeEntries(projectSlug, kind) {
  const config = KNOWLEDGE_CONFIG[kind];
  const filePath = safePathInside(PROJECTS_ROOT, projectSlug, config.folder, config.fileName);
  const entries = readJsonIfExists(filePath);
  if (Array.isArray(entries)) {
    return entries.map((entry, index) => normalizeStoredKnowledgeEntry(projectSlug, kind, entry, index));
  }

  const markdownPath = safePathInside(PROJECTS_ROOT, projectSlug, config.folder, config.markdownName);
  if (!fs.existsSync(markdownPath)) return [];
  const rows = parseKnowledgeSection(fs.readFileSync(markdownPath, "utf8").split(/\r?\n/u), kind);
  return rows.map((row, index) => normalizeStoredKnowledgeEntry(projectSlug, kind, row, index));
}

function normalizeStoredKnowledgeEntry(projectSlug, kind, entry, index) {
  const config = KNOWLEDGE_CONFIG[kind];
  const mapped = kind === "action"
    ? {
      action: entry?.action || pickKnowledgeValue(entry, ["action", "manœuvre / action", "manoeuvre / action", "manœuvre"]),
      responsable: entry?.responsable || pickKnowledgeValue(entry, ["responsable"]),
      echeance: entry?.echeance || pickKnowledgeValue(entry, ["échéance", "echeance"]),
      statut: entry?.statut || pickKnowledgeValue(entry, ["statut", "status"]),
      decisionId: entry?.decisionId || pickKnowledgeValue(entry, ["décision liée", "decision liee"]),
      documentId: entry?.documentId || pickKnowledgeValue(entry, ["document lié", "document lie"])
    }
    : kind === "decision"
      ? {
      decision: entry?.decision || pickKnowledgeValue(entry, ["cap validé / décision", "cap valide / decision", "décision", "decision"]),
      date: entry?.date || pickKnowledgeValue(entry, ["date"]),
      statut: entry?.statut || pickKnowledgeValue(entry, ["statut", "status"]),
      impact: entry?.impact || pickKnowledgeValue(entry, ["impact"])
    }
      : {
      need: entry?.need || pickKnowledgeValue(entry, ["besoin", "besoin utilisateur", "écran / fonctionnalité", "ecran / fonctionnalite"]),
      context: entry?.context || pickKnowledgeValue(entry, ["contexte / preuve", "contexte", "preuve"]),
      priority: entry?.priority || pickKnowledgeValue(entry, ["priorité", "priorite"]),
      statut: entry?.statut || pickKnowledgeValue(entry, ["statut", "status"])
    };
  const text = String(mapped[config.textField] || "").trim();
  return {
    ...entry,
    ...mapped,
    id: entry?.id || knowledgeItemId(kind, projectSlug, entry?.meetingDirName || "manuel", index, text),
    kind,
    reviewStatus: "validé",
    projectSlug,
    projectName: entry?.projectName || projectSlug.replaceAll("_", " "),
    meetingDirName: entry?.meetingDirName || "",
    date: entry?.date || "À confirmer",
    source: entry?.source || "Mémoire projet"
  };
}

function readValidatedKnowledgeProposals(projectSlug, kind) {
  const projectDir = safePathInside(PROJECTS_ROOT, projectSlug);
  const meetingsDir = path.join(projectDir, "01_escales_reunions");
  if (!fs.existsSync(meetingsDir)) return [];

  const proposals = [];
  const meetings = fs.readdirSync(meetingsDir, { withFileTypes: true });
  for (const meeting of meetings) {
    if (!meeting.isDirectory() || meeting.isSymbolicLink()) continue;
    const meetingDir = path.join(meetingsDir, meeting.name);
    const validatedPath = findReportPaths(meetingDir).validatedPath;
    if (!fs.existsSync(validatedPath)) continue;
    const content = fs.readFileSync(validatedPath, "utf8");
    proposals.push(...extractKnowledgeFromMeeting(projectSlug, meeting, readMeetingData(meetingDir) || {}, content, kind));
  }
  return proposals;
}

function knowledgeMarkdownValue(value) {
  return String(value || "").replace(/\r?\n/gu, " ").replace(/\|/gu, "\\|").trim();
}

function writeKnowledgeEntries(projectSlug, kind, entries) {
  const config = KNOWLEDGE_CONFIG[kind];
  const directory = safePathInside(PROJECTS_ROOT, projectSlug, config.folder);
  ensureDir(directory);
  fs.writeFileSync(path.join(directory, config.fileName), JSON.stringify(entries, null, 2), "utf8");

  const projectName = entries[0]?.projectName || projectSlug.replaceAll("_", " ");
  const lines = kind === "action"
    ? [
      `# Manœuvres / actions — ${projectName}`,
      "",
      "| Action | Responsable | Échéance | Statut | Source | Île | Décision liée | Document lié |",
      "|---|---|---|---|---|---|---|---|",
      ...entries.map((entry) => `| ${knowledgeMarkdownValue(entry.action)} | ${knowledgeMarkdownValue(entry.responsable)} | ${knowledgeMarkdownValue(entry.echeance)} | ${knowledgeMarkdownValue(entry.statut)} | ${knowledgeMarkdownValue(entry.source)} | ${knowledgeMarkdownValue(entry.projectName)} | ${knowledgeMarkdownValue(entry.decisionId)} | ${knowledgeMarkdownValue(entry.documentId)} |`)
    ]
    : kind === "decision"
      ? [
      `# Caps validés / décisions — ${projectName}`,
      "",
      "| Date | Cap validé / décision | Statut | Source | Impact | Île |",
      "|---|---|---|---|---|---|",
      ...entries.map((entry) => `| ${knowledgeMarkdownValue(entry.date)} | ${knowledgeMarkdownValue(entry.decision)} | ${knowledgeMarkdownValue(entry.statut)} | ${knowledgeMarkdownValue(entry.source)} | ${knowledgeMarkdownValue(entry.impact)} | ${knowledgeMarkdownValue(entry.projectName)} |`)
    ]
      : [
        `# Besoins identifiés — ${projectName}`,
        "",
        "| Besoin | Contexte / preuve | Priorité | Statut | Source | Île |",
        "|---|---|---|---|---|---|",
        ...entries.map((entry) => `| ${knowledgeMarkdownValue(entry.need)} | ${knowledgeMarkdownValue(entry.context)} | ${knowledgeMarkdownValue(entry.priority)} | ${knowledgeMarkdownValue(entry.statut)} | ${knowledgeMarkdownValue(entry.source)} | ${knowledgeMarkdownValue(entry.projectName)} |`)
      ];
  fs.writeFileSync(path.join(directory, config.markdownName), `${lines.join("\n")}\n`, "utf8");
}

function knowledgeItemsForProject(projectSlug, kind) {
  const accepted = readKnowledgeEntries(projectSlug, kind).map((item) => ({ ...item, reviewStatus: "validé" }));
  const acceptedIds = new Set(accepted.map((item) => item.id));
  const proposals = readValidatedKnowledgeProposals(projectSlug, kind)
    .filter((item) => !acceptedIds.has(item.id));
  return [...accepted, ...proposals];
}

function safeKnowledgeKind(value) {
  const kind = String(value || "").trim();
  if (!Object.hasOwn(KNOWLEDGE_CONFIG, kind)) throw new Error("Type de mémoire invalide.");
  return kind;
}

const LOG_POSE_DEFAULTS = {
  whatToRemember: "",
  openQuestions: [],
  documentsToFind: [],
  nextDirection: ""
};

const readLogPoseManual = makeLogPoseReader({ projectsRoot: PROJECTS_ROOT, safePathInside, readJsonIfExists, normalizeLogPoseManual, extractMarkdownSection, defaults: LOG_POSE_DEFAULTS });

function listProjectMeetings(projectSlug) {
  const meetingsRoot = safePathInside(PROJECTS_ROOT, projectSlug, "01_escales_reunions");
  if (!fs.existsSync(meetingsRoot)) return [];

  return fs.readdirSync(meetingsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => {
      const meetingDir = path.join(meetingsRoot, entry.name);
      const data = readMeetingData(meetingDir) || {};
      const reportPaths = findReportPaths(meetingDir);
      return {
        meetingDirName: entry.name,
        title: data.title || entry.name,
        date: data.meetingDate || entry.name.slice(0, 10),
        status: fs.existsSync(reportPaths.validatedPath)
          ? "Validé"
          : fs.existsSync(reportPaths.exportedPath)
            ? "À valider"
            : "À traiter"
      };
    })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

const { buildLogPose, buildGlobalLogPose } = makeLogPoseSynthesis({ readKnowledgeEntries, readValidatedKnowledgeProposals, listProjectMeetings, readProjectRecord, readLogPoseManual });

const writeLogPose = makeLogPoseWriter({ projectsRoot: PROJECTS_ROOT, safePathInside, ensureDir, normalizeLogPoseManual, knowledgeMarkdownValue });

function syncLogPose(projectSlug) {
  const manual = readLogPoseManual(projectSlug);
  return writeLogPose(projectSlug, buildLogPose(projectSlug, manual), manual);
}


function meetingHasAudio(meetingDir) {
  try {
    return fs.readdirSync(meetingDir).some((name) => name.startsWith("audio_original."));
  } catch {
    return false;
  }
}

function toDataRelativePath(filePath) {
  return path.relative(DATA_ROOT, filePath).split(path.sep).join("/");
}

function walkDocumentFiles(dirPath, files = []) {
  if (!fs.existsSync(dirPath)) return files;

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "99_versions") walkDocumentFiles(fullPath, files);
      continue;
    }
    if (DOCUMENT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(fullPath);
  }

  return files;
}

function formatDocumentSize(sizeBytes) {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return "Moins d’un Ko";
  if (sizeBytes < 1024 * 1024) return `${Math.max(1, Math.round(sizeBytes / 1024))} Ko`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function makeDocumentRecord(filePath, options = {}) {
  const stats = fs.statSync(filePath);
  const projectSlug = options.projectSlug || "";
  return {
    id: options.id || toDataRelativePath(filePath),
    source: options.source || "Coffre",
    reviewStatus: options.reviewStatus || "classé",
    category: options.category || "Document",
    projectSlug,
    projectName: projectSlug ? projectSlug.replaceAll("_", " ") : "",
    meetingDirName: options.meetingDirName || "",
    fileName: path.basename(filePath),
    relativePath: toDataRelativePath(filePath),
    extension: path.extname(filePath).replace(".", "").toLowerCase(),
    sizeBytes: stats.size,
    size: formatDocumentSize(stats.size),
    modifiedAt: stats.mtime.toISOString(),
    analysis: options.analysis || null
  };
}

function listProjectDocuments(projectSlug) {
  const projectDir = safePathInside(PROJECTS_ROOT, projectSlug);
  const documents = [];
  const coffreDir = path.join(projectDir, "08_coffre_documents_sources");

  for (const filePath of walkDocumentFiles(coffreDir)) {
    documents.push(makeDocumentRecord(filePath, {
      projectSlug,
      source: "Coffre",
      category: "Document classé"
    }));
  }

  const meetingsDir = path.join(projectDir, "01_escales_reunions");
  if (fs.existsSync(meetingsDir)) {
    const meetingEntries = fs.readdirSync(meetingsDir, { withFileTypes: true });
    for (const meetingEntry of meetingEntries) {
      if (!meetingEntry.isDirectory() || meetingEntry.isSymbolicLink()) continue;
      const attachmentsDir = path.join(meetingsDir, meetingEntry.name, "pieces_jointes");
      for (const filePath of walkDocumentFiles(attachmentsDir)) {
        documents.push(makeDocumentRecord(filePath, {
          projectSlug,
          meetingDirName: meetingEntry.name,
          source: "Pièce jointe d’escale",
          category: "Pièce jointe"
        }));
      }
    }
  }

  return documents;
}

function listWaterSevenDocuments() {
  if (!fs.existsSync(WATER_SEVEN_ROOT)) return [];
  const documents = [];
  const deposits = fs.readdirSync(WATER_SEVEN_ROOT, { withFileTypes: true });

  for (const deposit of deposits) {
    if (!deposit.isDirectory() || deposit.isSymbolicLink()) continue;
    const depositDir = safePathInside(WATER_SEVEN_ROOT, deposit.name);
    const metadataPath = path.join(depositDir, "fil_origine.json");
    const metadata = readJsonIfExists(metadataPath);
    const sourceFiles = fs.readdirSync(depositDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name !== "fil_origine.json" && entry.name !== "classement_valide.json")
      .map((entry) => path.join(depositDir, entry.name));

    for (const filePath of sourceFiles) {
      documents.push(makeDocumentRecord(filePath, {
        id: metadata?.id || deposit.name,
        source: "Water Seven",
        reviewStatus: "à valider",
        category: metadata?.analysis?.category || "Épave à trier",
        analysis: metadata?.analysis || null
      }));
    }
  }

  return documents;
}

function uniqueDocumentPath(targetDir, fileName) {
  const parsed = path.parse(fileName);
  let candidate = path.join(targetDir, fileName);
  let suffix = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(targetDir, `${parsed.name}_${suffix}${parsed.ext}`);
    suffix += 1;
  }
  return candidate;
}

function findWaterSevenDocument(sourceId) {
  const safeSourceId = safeSegment(sourceId);
  if (!safeSourceId) throw new Error("Document entrant invalide.");

  const depositDir = safePathInside(WATER_SEVEN_ROOT, safeSourceId);
  const metadataPath = path.join(depositDir, "fil_origine.json");
  const metadata = readJsonIfExists(metadataPath);
  if (!metadata || !fs.existsSync(depositDir)) throw new Error("Document entrant introuvable.");

  const sourceFile = fs.readdirSync(depositDir, { withFileTypes: true })
    .find((entry) => entry.isFile() && entry.name !== "fil_origine.json" && entry.name !== "classement_valide.json");
  if (!sourceFile) throw new Error("Le document entrant est introuvable dans Water Seven.");

  return {
    depositDir,
    metadata,
    filePath: path.join(depositDir, sourceFile.name)
  };
}

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "vogue-marry-local-backend",
    host: "127.0.0.1",
    port: PORT
  });
});

app.post("/api/water-seven/deposit", upload.single("document"), (req, res) => {
  try {
    if (!req.file) throw new Error("Aucun document reçu dans Water Seven.");

    ensureDir(WATER_SEVEN_ROOT);
    const depositDir = fs.mkdtempSync(path.join(WATER_SEVEN_ROOT, `${timestampForFile()}_`));
    const depositId = path.basename(depositDir);

    const safeOriginalName = safeSegment(req.file.originalname || "document") || "document";
    const storedName = ["fil_origine.json", "classement_valide.json"].includes(safeOriginalName)
      ? `document_${safeOriginalName}`
      : safeOriginalName;
    const filePath = path.join(depositDir, storedName);
    fs.writeFileSync(filePath, req.file.buffer);

    const analysis = analyseWaterSevenDocument(req.file);
    const metadata = {
      id: depositId,
      depositedAt: new Date().toISOString(),
      source: "Water Seven",
      originalName: req.file.originalname,
      relativePath: path.relative(DATA_ROOT, filePath),
      analysis
    };

    fs.writeFileSync(path.join(depositDir, "fil_origine.json"), JSON.stringify(metadata, null, 2), "utf8");

    res.status(201).json({ status: "ok", deposit: metadata });
  } catch (error) {
    res.status(400).json({ error: error.message || "Erreur pendant le dépôt dans Water Seven." });
  }
});

app.get("/api/documents", (req, res) => {
  try {
    const requestedProject = String(req.query.projectSlug || "").trim();
    const projectSlug = requestedProject ? safeSegment(requestedProject) : "";
    if (requestedProject && !projectSlug) throw new Error("Île/projet invalide.");

    ensureDir(PROJECTS_ROOT);
    const projectSlugs = projectSlug
      ? [projectSlug]
      : fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
        .map((entry) => entry.name);
    const documents = projectSlugs.flatMap((slug) => listProjectDocuments(slug));
    if (!projectSlug) documents.push(...listWaterSevenDocuments());

    documents.sort((a, b) => {
      if (a.reviewStatus !== b.reviewStatus) return a.reviewStatus === "à valider" ? -1 : 1;
      return String(b.modifiedAt).localeCompare(String(a.modifiedAt));
    });

    res.json({
      projectSlug,
      count: documents.length,
      pendingCount: documents.filter((document) => document.reviewStatus === "à valider").length,
      documents
    });
  } catch (error) {
    res.status(400).json({ error: error.message || "Erreur pendant la lecture du Coffre." });
  }
});

app.post("/api/documents/validate", (req, res) => {
  try {
    const sourceId = safeSegment(req.body.sourceId);
    const projectSlug = safeSegment(req.body.projectSlug);
    if (!sourceId || !projectSlug) throw new Error("Document et île/projet sont obligatoires.");

    const projectDir = safePathInside(PROJECTS_ROOT, projectSlug);
    if (!fs.existsSync(projectDir)) throw new Error("Île/projet introuvable.");

    const incoming = findWaterSevenDocument(sourceId);
    const targetDir = safePathInside(projectDir, "08_coffre_documents_sources");
    ensureDir(targetDir);

    const originalName = safeSegment(req.body.fileName || path.basename(incoming.filePath));
    if (!originalName) throw new Error("Nom de document invalide.");
    const targetPath = uniqueDocumentPath(targetDir, originalName);
    fs.renameSync(incoming.filePath, targetPath);

    const validation = {
      sourceId,
      validatedAt: new Date().toISOString(),
      projectSlug,
      destination: "Coffre",
      originalName: path.basename(incoming.filePath),
      relativePath: toDataRelativePath(targetPath),
      analysis: incoming.metadata.analysis || null
    };
    fs.writeFileSync(path.join(incoming.depositDir, "classement_valide.json"), JSON.stringify(validation, null, 2), "utf8");

    res.status(201).json({
      status: "ok",
      document: makeDocumentRecord(targetPath, {
        projectSlug,
        source: "Coffre",
        category: "Document classé",
        analysis: incoming.metadata.analysis || null
      })
    });
  } catch (error) {
    res.status(400).json({ error: error.message || "Erreur pendant le classement du document." });
  }
});

app.get("/api/projects", (req, res) => {
  ensureDir(PROJECTS_ROOT);

  const projects = fs
    .readdirSync(PROJECTS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readProjectRecord(entry.name))
    .sort((a, b) => a.slug.localeCompare(b.slug));

  res.json({ projects });
});

app.post("/api/projects", (req, res) => {
  try {
    const project = createProjectStructure(req.body.name, req.body.description);
    res.status(201).json({ project });
  } catch (error) {
    res.status(400).json({ error: error.message || "Erreur pendant la création du projet." });
  }
});

app.post("/api/meetings/export", (req, res) => {
  try {
    const {
      projectName,
      meetingDate,
      meetingType,
      title,
      participants,
      context,
      decisions,
      rules,
      screens,
      openQuestions,
      actions,
      risks,
      keywords,
      rawNotes
    } = req.body;

    const projectSlug = slugify(projectName);
    if (!projectSlug) throw new Error("Projet manquant.");

    const projectDir = safePathInside(PROJECTS_ROOT, projectSlug);
    if (!fs.existsSync(projectDir)) throw new Error("Île/projet introuvable. Créez d’abord le projet.");
    const project = readProjectRecord(projectSlug);

    const meetingsDir = path.join(projectDir, "01_escales_reunions");
    ensureDir(meetingsDir);

    const date = meetingDate || new Date().toISOString().slice(0, 10);
    const typeSlug = slugify(meetingType || "escale").slice(0, 80) || "escale";
    const titleSlug = slugify(title || "sans_titre").slice(0, 80) || "sans_titre";
    const baseMeetingDirName = `${date}_${typeSlug}_${titleSlug}`;
    let meetingDirName = baseMeetingDirName;
    let meetingDir = path.join(meetingsDir, meetingDirName);
    let duplicateIndex = 2;
    while (fs.existsSync(meetingDir)) {
      meetingDirName = `${baseMeetingDirName}_${duplicateIndex}`;
      meetingDir = path.join(meetingsDir, meetingDirName);
      duplicateIndex += 1;
    }

    ensureDir(meetingDir);
    ensureDir(path.join(meetingDir, "pieces_jointes"));

    const markdown = `# Journal de bord — ${title || "Escale sans titre"}

## Île / projet

${project.name}

## Date

${date}

## Type d’escale

${meetingType || ""}

## Équipage / participants

${participants || ""}

## Contexte

${context || ""}

## Caps validés / décisions prises

${decisions || ""}

## Règles / méthodes validées

${rules || ""}

## Écrans / fonctionnalités concernés

${screens || ""}

## Questions ouvertes

${openQuestions || ""}

## Manœuvres / actions à faire

${actions || ""}

## Risques / alertes

${risks || ""}

## Mots-clés

${keywords || ""}

## Traces audio / notes brutes / transcription / marqueurs

${rawNotes || ""}
`;

    fs.writeFileSync(path.join(meetingDir, "journal_de_bord_exporte.md"), markdown, "utf8");
    const meetingData = {
      ...req.body,
      projectName: project.name,
      projectSlug,
      meetingDirName,
      createdAt: new Date().toISOString()
    };
    fs.writeFileSync(path.join(meetingDir, "donnees_escale.json"), JSON.stringify(meetingData, null, 2), "utf8");

    res.status(201).json({ status: "ok", projectSlug, meetingDirName });
  } catch (error) {
    res.status(400).json({ error: error.message || "Erreur pendant l’export de l’escale." });
  }
});

app.post("/api/meetings/export-audio", upload.single("audio"), (req, res) => {
  try {
    const { projectName, meetingDirName } = req.body;
    if (!req.file) throw new Error("Aucun fichier audio reçu.");

    const projectSlug = slugify(projectName);
    const safeMeetingDirName = safeSegment(meetingDirName);
    if (!projectSlug || !safeMeetingDirName) throw new Error("Projet ou escale manquant.");

    const meetingDir = findMeetingDir(projectSlug, safeMeetingDirName);
    if (!fs.existsSync(meetingDir)) throw new Error("Escale introuvable. Exportez d’abord l’escale.");

    const extension = path.extname(req.file.originalname || "") || ".webm";
    const audioPath = path.join(meetingDir, `audio_original${extension}`);
    if (fs.existsSync(audioPath)) {
      const existingAudio = fs.readFileSync(audioPath);
      if (!existingAudio.equals(req.file.buffer)) {
        return res.status(409).json({ error: "Un audio original existe déjà pour cette escale. Il est conservé sans modification." });
      }
      return res.status(200).json({ status: "already-uploaded", audioFileName: path.basename(audioPath) });
    }
    fs.writeFileSync(audioPath, req.file.buffer, { flag: "wx" });

    res.status(201).json({ status: "ok", audioFileName: path.basename(audioPath) });
  } catch (error) {
    res.status(400).json({ error: error.message || "Erreur pendant l’export audio." });
  }
});

// Blocs audio persistés sur disque. Le lecteur existant reste inchangé.
// Sauvegarde des marqueurs pendant la réunion, sans attendre l'arrêt audio.
app.post("/api/meetings/save-markers", (req, res) => {
  try {
    const projectSlug = safeSegment(req.body.projectSlug);
    const meetingDirName = safeSegment(req.body.meetingDirName);
    if (!projectSlug || !meetingDirName) throw new Error("Escale invalide.");
    const markers = req.body.markers;
    if (!Array.isArray(markers) || markers.length > 10000) throw new Error("Marqueurs invalides.");
    for (const marker of markers) {
      if (!marker || typeof marker !== "object" ||
          typeof marker.id !== "string" || marker.id.length > 120 ||
          typeof marker.type !== "string" || marker.type.length > 100 ||
          !Number.isFinite(marker.timeSeconds) || marker.timeSeconds < 0) {
        throw new Error("Marqueur malformé.");
      }
    }
    const meetingDir = findMeetingDir(projectSlug, meetingDirName);
    const dataPath = path.join(meetingDir, "donnees_escale.json");
    if (!fs.existsSync(dataPath)) throw new Error("Escale introuvable.");
    const current = JSON.parse(fs.readFileSync(dataPath, "utf8"));
    const existing = Array.isArray(current.markers) ? current.markers : [];
    const byId = new Map(existing.map((item) => [item.id, item]));
    for (const marker of markers) byId.set(marker.id, marker);
    const merged = [...byId.values()].sort((a, b) => a.timeSeconds - b.timeSeconds);
    const temp = path.join(meetingDir, `markers_${process.pid}_${Date.now()}.tmp`);
    try {
      fs.writeFileSync(temp, JSON.stringify({ ...current, markers: merged }, null, 2), { flag: "wx" });
      fs.renameSync(temp, dataPath);
    } finally {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
    return res.json({ status: "ok", count: merged.length });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Impossible de sauvegarder les marqueurs." });
  }
});

app.post("/api/meetings/audio-chunk", upload.single("audio"), (req, res) => {
  try {
    const projectSlug = slugify(req.body.projectName);
    const meetingDir = findMeetingDir(projectSlug, req.body.meetingDirName);
    if (!fs.existsSync(meetingDir)) throw new Error("Escale introuvable.");
    if (!req.file?.buffer?.length) throw new Error("Bloc audio vide.");
    const index = Number(req.body.index);
    if (!Number.isSafeInteger(index) || index < 0 || index > 100000) throw new Error("Indice de bloc invalide.");
    const chunksDir = path.join(meetingDir, "audio_chunks");
    ensureDir(chunksDir);
    const fileName = `chunk_${String(index).padStart(6, "0")}.part`;
    const filePath = path.join(chunksDir, fileName);
    if (fs.existsSync(filePath)) {
      if (!fs.readFileSync(filePath).equals(req.file.buffer)) {
        return res.status(409).json({ error: "Ce bloc existe déjà avec un contenu différent." });
      }
      return res.json({ status: "already-uploaded", index });
    }
    fs.writeFileSync(filePath, req.file.buffer, { flag: "wx" });
    return res.status(201).json({ status: "ok", index });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Impossible de sauvegarder le bloc audio." });
  }
});

app.post("/api/meetings/audio-chunks-status", (req, res) => {
  try {
    const projectSlug = slugify(req.body.projectName);
    const meetingDir = findMeetingDir(projectSlug, req.body.meetingDirName);
    if (!fs.existsSync(meetingDir)) throw new Error("Escale introuvable.");
    const chunksDir = path.join(meetingDir, "audio_chunks");
    const received = fs.existsSync(chunksDir)
      ? fs.readdirSync(chunksDir).filter((name) => /^chunk_\d{6}\.part$/u.test(name))
        .map((name) => Number(name.slice(6, 12))).sort((a, b) => a - b)
      : [];
    return res.json({ status: "ok", received });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Impossible de lister les blocs audio." });
  }
});

app.post("/api/meetings/audio-chunks-finalize", (req, res) => {
  try {
    const projectSlug = slugify(req.body.projectName);
    const meetingDir = findMeetingDir(projectSlug, req.body.meetingDirName);
    if (!fs.existsSync(meetingDir)) throw new Error("Escale introuvable.");
    const count = Number(req.body.count);
    if (!Number.isSafeInteger(count) || count < 1 || count > 100000) throw new Error("Nombre de blocs invalide.");
    const chunksDir = path.join(meetingDir, "audio_chunks");
    const paths = Array.from({ length: count }, (_, i) =>
      path.join(chunksDir, `chunk_${String(i).padStart(6, "0")}.part`));
    if (paths.some((filePath) => !fs.existsSync(filePath))) {
      return res.status(409).json({ error: "Il manque des blocs audio. Finalisation refusée." });
    }
    const diskIndices = fs.readdirSync(chunksDir)
      .filter((name) => /^chunk_\d{6}\.part$/u.test(name))
      .map((name) => Number(name.slice(6, 12)));
    if (diskIndices.length !== count || diskIndices.some((index) => index >= count)) {
      return res.status(409).json({ error: "Le nombre de blocs ne correspond pas aux fragments reçus. Finalisation refusée." });
    }
    if (paths.some((filePath) => fs.statSync(filePath).size === 0)) {
      return res.status(409).json({ error: "Un fragment audio est vide. Finalisation refusée." });
    }
    const audioPath = path.join(meetingDir, "audio_original.webm");
    if (fs.existsSync(audioPath)) {
      // Accusé de réception perdu : une relance identique est sûre uniquement
      // si l'original correspond exactement à la concaténation des blocs.
      const existing = fs.readFileSync(audioPath);
      const totalBytes = paths.reduce((sum, filePath) => sum + fs.statSync(filePath).size, 0);
      if (existing.length === totalBytes) {
        let offset = 0;
        let identical = true;
        for (const filePath of paths) {
          const block = fs.readFileSync(filePath);
          if (!existing.subarray(offset, offset + block.length).equals(block)) {
            identical = false;
            break;
          }
          offset += block.length;
        }
        if (identical) {
          return res.status(200).json({ status: "already-finalized", audioFileName: "audio_original.webm", blocks: count });
        }
      }
      return res.status(409).json({ error: "Un audio original différent existe déjà. Il ne sera pas remplacé." });
    }
    const temporaryPath = path.join(meetingDir, `audio_assembly_${process.pid}_${Date.now()}.tmp`);
    try {
      const fd = fs.openSync(temporaryPath, "wx");
      try {
        for (const filePath of paths) fs.writeFileSync(fd, fs.readFileSync(filePath));
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.linkSync(temporaryPath, audioPath);
    } finally {
      if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    }
    return res.status(201).json({ status: "ok", audioFileName: "audio_original.webm", blocks: count });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Impossible de finaliser l'audio." });
  }
});

app.get("/api/inbox", (req, res) => {
  try {
    ensureDir(PROJECTS_ROOT);
    const items = [];

    const projects = fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true }).filter((entry) => entry.isDirectory());

    for (const project of projects) {
      const meetingsDir = path.join(PROJECTS_ROOT, project.name, "01_escales_reunions");
      if (!fs.existsSync(meetingsDir)) continue;
      const projectRecord = readProjectRecord(project.name);

      const meetings = fs.readdirSync(meetingsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());

      for (const meeting of meetings) {
        const meetingDir = path.join(meetingsDir, meeting.name);
        const data = readMeetingData(meetingDir);
        const reportPaths = findReportPaths(meetingDir);
        const hasAudio = meetingHasAudio(meetingDir);
        const hasReport = fs.existsSync(reportPaths.exportedPath);
        const hasValidatedReport = fs.existsSync(reportPaths.validatedPath);
        const hasTranscription = fs.existsSync(path.join(meetingDir, "transcription_v6.json"));
        const hasRawNotes = Boolean(data?.rawNotes && String(data.rawNotes).trim());

        let status = "À traiter";
        if (hasValidatedReport) status = "Validé";
        else if (hasTranscription) status = "Transcription à relire";
        else if (hasReport && hasRawNotes) status = "Journal de bord à valider";
        else if (hasAudio && !hasRawNotes) status = "Audio à transcrire";
        else if (hasReport) status = "Exporté à compléter";

        items.push({
          projectSlug: project.name,
          projectName: data?.projectName || projectRecord.name,
          meetingDirName: meeting.name,
          title: data?.title || meeting.name,
          date: data?.meetingDate || meeting.name.slice(0, 10),
          meetingType: data?.meetingType || "",
          status,
          hasAudio,
          hasReport,
          hasValidatedReport,
          hasTranscription,
          hasRawNotes,
        });
      }
    }

    items.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    res.json({ items });
  } catch (error) {
    res.status(500).json({ error: error.message || "Erreur pendant la lecture de la boîte à traiter." });
  }
});

app.post("/api/meetings/validate", (req, res) => {
  try {
    const safeProjectSlug = safeSegment(req.body.projectSlug);
    const safeMeetingDirName = safeSegment(req.body.meetingDirName);
    if (!safeProjectSlug || !safeMeetingDirName) throw new Error("Projet ou escale manquant.");

    const meetingDir = findMeetingDir(safeProjectSlug, safeMeetingDirName);
    const { exportedPath, validatedPath } = findReportPaths(meetingDir);

    if (fs.existsSync(validatedPath)) {
      return res.status(200).json({ status: "already-validated", validatedFileName: path.basename(validatedPath) });
    }

    if (!fs.existsSync(exportedPath)) throw new Error("Journal de bord exporté introuvable.");

    const content = fs.readFileSync(exportedPath, "utf8");
    createFileVersion(validatedPath, "avant_validation");
    fs.writeFileSync(validatedPath, content + "\n\n---\n\nValidé dans Vogue Merry le " + new Date().toISOString() + "\n", "utf8");
    syncLogPose(safeProjectSlug);

    res.status(201).json({ status: "ok", validatedFileName: path.basename(validatedPath) });
  } catch (error) {
    res.status(400).json({ error: error.message || "Erreur pendant la validation de l’escale." });
  }
});

app.get("/api/log-pose", (req, res) => {
  try {
    const requestedProject = String(req.query.projectSlug || "").trim();
    const projectSlug = requestedProject ? safeSegment(requestedProject) : "";
    if (requestedProject && !projectSlug) throw new Error("Île/projet invalide.");

    ensureDir(PROJECTS_ROOT);
    const projectSlugs = projectSlug
      ? [projectSlug]
      : fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
        .map((entry) => entry.name);
    if (projectSlug && !fs.existsSync(safePathInside(PROJECTS_ROOT, projectSlug))) {
      throw new Error("Île/projet introuvable.");
    }

    const logPose = projectSlug ? buildLogPose(projectSlug) : buildGlobalLogPose(projectSlugs);
    res.json({ logPose, projects: projectSlugs });
  } catch (error) {
    res.status(400).json({ error: error.message || "Erreur pendant la lecture du Log Pose." });
  }
});

app.post("/api/log-pose/save", (req, res) => {
  try {
    const projectSlug = safeSegment(req.body.projectSlug);
    if (!projectSlug) throw new Error("Île/projet obligatoire.");
    const projectDir = safePathInside(PROJECTS_ROOT, projectSlug);
    if (!fs.existsSync(projectDir)) throw new Error("Île/projet introuvable.");

    const manual = normalizeLogPoseManual({
      whatToRemember: req.body.whatToRemember,
      openQuestions: req.body.openQuestions,
      documentsToFind: req.body.documentsToFind,
      nextDirection: req.body.nextDirection
    });
    const logPose = writeLogPose(projectSlug, buildLogPose(projectSlug, manual), manual);
    res.status(200).json({ status: "ok", logPose });
  } catch (error) {
    res.status(400).json({ error: error.message || "Erreur pendant l’enregistrement du Log Pose." });
  }
});

app.post("/api/meetings/read-report", (req, res) => {
  try {
    const safeProjectSlug = safeSegment(req.body.projectSlug);
    const safeMeetingDirName = safeSegment(req.body.meetingDirName);
    if (!safeProjectSlug || !safeMeetingDirName) throw new Error("Projet ou escale manquant.");

    const meetingDir = findMeetingDir(safeProjectSlug, safeMeetingDirName);
    const { exportedPath, validatedPath } = findReportPaths(meetingDir);

    const reportPath = fs.existsSync(validatedPath) ? validatedPath : exportedPath;
    const reportType = fs.existsSync(validatedPath) ? "valide" : "exporte";

    if (!fs.existsSync(reportPath)) throw new Error("Aucun journal de bord trouvé pour cette escale.");

    res.json({ status: "ok", reportType, reportFileName: path.basename(reportPath), content: fs.readFileSync(reportPath, "utf8") });
  } catch (error) {
    res.status(400).json({ error: error.message || "Erreur pendant la lecture du journal de bord." });
  }
});

app.post("/api/meetings/save-report", (req, res) => {
  try {
    const safeProjectSlug = safeSegment(req.body.projectSlug);
    const safeMeetingDirName = safeSegment(req.body.meetingDirName);
    if (!safeProjectSlug || !safeMeetingDirName) throw new Error("Projet ou escale manquant.");

    const meetingDir = findMeetingDir(safeProjectSlug, safeMeetingDirName);
    if (!fs.existsSync(meetingDir)) throw new Error("Escale introuvable.");

    const exportedPath = path.join(meetingDir, "journal_de_bord_exporte.md");
    if (fs.existsSync(path.join(meetingDir, "journal_de_bord_valide.md"))) {
      throw new Error("Ce journal est déjà validé et protégé contre les modifications.");
    }

    const content = String(req.body.content || "").trim();
    if (!content) throw new Error("Le journal de bord ne peut pas être vide.");

    createFileVersion(exportedPath, "avant_sauvegarde");
    fs.writeFileSync(exportedPath, `${content}\n`, "utf8");

    res.json({ status: "ok", savedFileName: path.basename(exportedPath) });
  } catch (error) {
    res.status(400).json({ error: error.message || "Erreur pendant l’enregistrement du journal de bord." });
  }
});

app.get("/api/knowledge/:kind", (req, res) => {
  try {
    const kind = safeKnowledgeKind(req.params.kind);
    const requestedProject = String(req.query.projectSlug || "").trim();
    const projectSlug = requestedProject ? safeSegment(requestedProject) : "";
    if (requestedProject && !projectSlug) throw new Error("Île/projet invalide.");

    ensureDir(PROJECTS_ROOT);
    const projectSlugs = projectSlug
      ? [projectSlug]
      : fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
        .map((entry) => entry.name);
    const items = projectSlugs.flatMap((slug) => knowledgeItemsForProject(slug, kind));
    items.sort((a, b) => {
      if (a.reviewStatus !== b.reviewStatus) return a.reviewStatus === "à valider" ? -1 : 1;
      return String(b.date || "").localeCompare(String(a.date || ""));
    });

    res.json({
      kind,
      projectSlug,
      count: items.length,
      pendingCount: items.filter((item) => item.reviewStatus === "à valider").length,
      items
    });
  } catch (error) {
    res.status(400).json({ error: error.message || "Erreur pendant la lecture de la mémoire projet." });
  }
});

app.post("/api/knowledge/:kind/validate", (req, res) => {
  try {
    const kind = safeKnowledgeKind(req.params.kind);
    const projectSlug = safeSegment(req.body.projectSlug);
    const itemId = String(req.body.itemId || "").trim();
    if (!projectSlug || !itemId) throw new Error("Île/projet et élément obligatoires.");

    const projectDir = safePathInside(PROJECTS_ROOT, projectSlug);
    if (!fs.existsSync(projectDir)) throw new Error("Île/projet introuvable.");

    const accepted = readKnowledgeEntries(projectSlug, kind);
    const alreadyAccepted = accepted.find((item) => item.id === itemId);
    if (alreadyAccepted) return res.status(200).json({ status: "ok", item: { ...alreadyAccepted, reviewStatus: "validé" } });

    const candidate = readValidatedKnowledgeProposals(projectSlug, kind).find((item) => item.id === itemId);
    if (!candidate) throw new Error("Élément non trouvé dans un journal de bord validé.");

    const editableFields = kind === "action"
      ? ["action", "responsable", "echeance", "statut", "decisionId", "documentId"]
      : kind === "decision"
        ? ["decision", "date", "statut", "impact"]
        : ["need", "context", "priority", "statut"];
    const submitted = req.body.item && typeof req.body.item === "object" ? req.body.item : {};
    const validatedItem = { ...candidate };
    editableFields.forEach((field) => {
      if (Object.hasOwn(submitted, field)) validatedItem[field] = String(submitted[field] || "").trim();
    });

    const textField = KNOWLEDGE_CONFIG[kind].textField;
    if (!validatedItem[textField]) throw new Error("Le contenu de l’élément ne peut pas être vide.");
    if (candidate.origin === "marqueur" && !Object.hasOwn(submitted, textField)) {
      throw new Error("Précisez l’action ou la décision repérée avant validation.");
    }

    const storedItem = {
      ...validatedItem,
      reviewStatus: "validé",
      validatedAt: new Date().toISOString()
    };
    writeKnowledgeEntries(projectSlug, kind, [...accepted, storedItem]);
    syncLogPose(projectSlug);
    res.status(201).json({ status: "ok", item: storedItem });
  } catch (error) {
    res.status(400).json({ error: error.message || "Erreur pendant la validation de l’élément." });
  }
});

app.post("/api/knowledge/action/update-status", (req, res) => {
  try {
    const projectSlug = safeSegment(req.body.projectSlug);
    const itemId = String(req.body.itemId || "").trim();
    const statut = String(req.body.statut || "").trim();
    if (!projectSlug || !itemId || !statut || statut.length > 100) throw new Error("Île, action et statut valides requis.");
    const projectDir = safePathInside(PROJECTS_ROOT, projectSlug);
    if (!fs.existsSync(projectDir)) throw new Error("Île introuvable.");

    const accepted = readKnowledgeEntries(projectSlug, "action");
    const index = accepted.findIndex((item) => item.id === itemId);
    if (index < 0) throw new Error("Action non validée ou introuvable.");
    const config = KNOWLEDGE_CONFIG.action;
    const jsonPath = safePathInside(PROJECTS_ROOT, projectSlug, config.folder, config.fileName);
    const markdownPath = safePathInside(PROJECTS_ROOT, projectSlug, config.folder, config.markdownName);
    createFileVersion(jsonPath, "avant_statut");
    createFileVersion(markdownPath, "avant_statut");
    const updated = { ...accepted[index], statut, updatedAt: new Date().toISOString() };
    accepted[index] = updated;
    writeKnowledgeEntries(projectSlug, "action", accepted);
    syncLogPose(projectSlug);
    res.json({ status: "ok", item: updated });
  } catch (error) {
    res.status(400).json({ error: error.message || "Impossible de mettre à jour cette manœuvre." });
  }
});

function walkFiles(dirPath, files = [], { includeHistory = false } = {}) {
  if (!fs.existsSync(dirPath) || fs.lstatSync(dirPath).isSymbolicLink()) return files;

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "99_versions" && !includeHistory) continue;
      walkFiles(fullPath, files, { includeHistory });
    }
    else if (entry.name.endsWith(".md") || entry.name.endsWith(".json") || entry.name.endsWith(".txt")) files.push(fullPath);
  }

  return files;
}

function extractSnippet(content, query) {
  const lower = content.toLowerCase();
  const q = query.toLowerCase();
  const index = lower.indexOf(q);
  if (index === -1) return content.slice(0, 260);
  return content.slice(Math.max(0, index - 120), Math.min(content.length, index + q.length + 160)).replace(/\n+/g, " ");
}

app.get("/api/search", (req, res) => {
  try {
    const query = String(req.query.q || "").trim();
    const requestedProject = String(req.query.projectSlug || "").trim();
    const projectSlug = requestedProject ? safeSegment(requestedProject) : "";
    if (requestedProject && !projectSlug) throw new Error("Île/projet invalide.");
    if (projectSlug && !fs.existsSync(safePathInside(PROJECTS_ROOT, projectSlug))) {
      throw new Error("Île/projet introuvable.");
    }
    if (!query) return res.json({ results: [] });

    const roots = projectSlug ? [safePathInside(PROJECTS_ROOT, projectSlug)] : [PROJECTS_ROOT];
    const includeHistory = String(req.query.history || "") === "1";
    const results = [];

    for (const root of roots) {
      for (const filePath of walkFiles(root, [], { includeHistory })) {
        const content = fs.readFileSync(safeExistingFileInside(PROJECTS_ROOT, filePath), "utf8");
        if (content.toLowerCase().includes(query.toLowerCase())) {
          const relativePath = path.relative(PROJECTS_ROOT, filePath);
          const parts = relativePath.split(path.sep);
          results.push({
            projectSlug: parts[0] || "",
            relativePath,
            fileName: path.basename(filePath),
            snippet: extractSnippet(content, query)
          });
        }
      }
    }

    res.json({ query, projectSlug, count: results.length, results: results.slice(0, 50) });
  } catch (error) {
    res.status(400).json({ error: error.message || "Erreur pendant la recherche." });
  }
});

app.get("/api/search/read", (req, res) => {
  try {
    const relativePath = String(req.query.relativePath || "").trim();
    const requestedProject = String(req.query.projectSlug || "").trim();
    const projectSlug = requestedProject ? safeSegment(requestedProject) : "";
    if (!relativePath || relativePath.includes("\0") || path.isAbsolute(relativePath)) {
      throw new Error("Source demandée invalide.");
    }
    if (requestedProject && !projectSlug) throw new Error("Île/projet invalide.");

    const normalizedRelativePath = relativePath.replaceAll("\\", path.sep);
    const filePath = safePathInside(PROJECTS_ROOT, normalizedRelativePath);
    const relativeProjectPath = path.relative(PROJECTS_ROOT, filePath).split(path.sep);
    if (projectSlug && relativeProjectPath[0] !== projectSlug) throw new Error("La source n’appartient pas à cette île.");
    if (relativeProjectPath.includes("99_versions")) throw new Error("Les versions historiques ne sont pas ouvertes depuis la Longue-vue.");
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new Error("Source introuvable.");
    if (![".md", ".json", ".txt"].includes(path.extname(filePath).toLowerCase())) throw new Error("Type de source non lisible.");

    const content = fs.readFileSync(safeExistingFileInside(PROJECTS_ROOT, filePath), "utf8");
    res.json({
      relativePath: path.relative(PROJECTS_ROOT, filePath),
      fileName: path.basename(filePath),
      truncated: content.length > 200000,
      content: content.slice(0, 200000)
    });
  } catch (error) {
    res.status(400).json({ error: error.message || "Erreur pendant la lecture de la source." });
  }
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Vogue Merry API unifiée lancée : http://127.0.0.1:${PORT} (V6 interne : ${TRANSCRIPTION_HOST}:${TRANSCRIPTION_PORT})`);
  console.log(`Dossier données : ${DATA_ROOT}`);
});
