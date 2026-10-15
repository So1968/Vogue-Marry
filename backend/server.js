import express from "express";
import cors from "cors";
import fs from "fs";
import http from "http";
import path from "path";
import os from "os";
import multer from "multer";

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

function safeSegment(value) {
  const segment = String(value || "").trim();
  if (!segment || segment === "." || segment === ".." || segment.includes("..")) return "";
  if (segment.includes("/") || segment.includes("\\") || segment.includes("\0")) return "";
  return segment;
}

function safePathInside(root, ...segments) {
  const resolved = path.resolve(root, ...segments);
  const normalizedRoot = path.resolve(root) + path.sep;
  if (!resolved.startsWith(normalizedRoot)) throw new Error("Chemin de données invalide.");
  return resolved;
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

function createProjectStructure(projectName, projectDescription = "") {
  const slug = slugify(projectName);
  if (!slug) throw new Error("Nom de projet invalide.");

  const baseDir = safePathInside(PROJECTS_ROOT, slug);
  ensureDir(baseDir);
  writeFileIfMissing(
    path.join(baseDir, "projet.json"),
    JSON.stringify({
      version: 1,
      slug,
      name: String(projectName).trim(),
      description: String(projectDescription || "").trim().slice(0, 2000),
      createdAt: new Date().toISOString()
    }, null, 2)
  );

  const folders = [
    "00_carte_ile",
    "01_escales_reunions",
    "02_caps_valides_decisions",
    "03_manoeuvres_actions",
    "04_regles_methodes",
    "05_ecrans_parcours",
    "06_donnees_imports_interfaces",
    "07_questions_blocages",
    "08_coffre_documents_sources",
    "09_exports_livrables",
    "10_log_pose"
  ];

  folders.forEach((folder) => ensureDir(path.join(baseDir, folder)));

  writeFileIfMissing(
    path.join(baseDir, "README_PROJET.md"),
`# Île / projet — ${projectName}

Ce dossier contient la mémoire navigable du projet dans Vogue Merry.

Structure :
- 00_carte_ile : reprise rapide du fil et vue générale
- 01_escales_reunions : audios, transcriptions, journaux de bord
- 02_caps_valides_decisions : décisions consolidées
- 03_manoeuvres_actions : plan d'actions
- 04_regles_methodes : règles, méthodes et arbitrages
- 05_ecrans_parcours : écrans, parcours et besoins identifiés
- 06_donnees_imports_interfaces : sources, imports, interfaces, mappings
- 07_questions_blocages : questions ouvertes et blocages
- 08_coffre_documents_sources : documents d'origine, pièces et preuves
- 09_exports_livrables : livrables générés
- 10_log_pose : synthèse du cap et prochaine direction
`
  );

  writeFileIfMissing(
    path.join(baseDir, "00_carte_ile", "carte_ile.md"),
`# Carte de l’île — ${projectName}

## Objectif du projet

## Contexte

## Périmètre

## Équipage / acteurs clés

## État actuel

## Dernier cap validé

## Manœuvres en cours

## Questions ouvertes

## Points de vigilance

## Prochaine direction
`
  );

  writeFileIfMissing(path.join(baseDir, "02_caps_valides_decisions", "caps_valides.md"), `# Caps validés / décisions — ${projectName}\n\n| Date | Cap validé / décision | Statut | Source | Impact |\n|---|---|---|---|---|\n`);
  writeFileIfMissing(path.join(baseDir, "03_manoeuvres_actions", "manoeuvres_actions.md"), `# Manœuvres / actions — ${projectName}\n\n| Action | Responsable | Échéance | Statut | Source |\n|---|---|---|---|---|\n`);
  writeFileIfMissing(path.join(baseDir, "04_regles_methodes", "regles_methodes.md"), `# Règles / méthodes — ${projectName}\n\n| Règle / méthode | Statut | Source | Points ouverts |\n|---|---|---|---|\n`);
  writeFileIfMissing(path.join(baseDir, "05_ecrans_parcours", "ecrans_parcours.md"), `# Écrans / parcours — ${projectName}\n\n| Écran / parcours | Objectif | Règles associées | Points ouverts |\n|---|---|---|---|\n`);
  writeFileIfMissing(path.join(baseDir, "05_ecrans_parcours", "besoins.md"), `# Besoins identifiés — ${projectName}\n\n| Besoin | Contexte / preuve | Priorité | Statut | Source |\n|---|---|---|---|---|\n`);
  writeFileIfMissing(path.join(baseDir, "06_donnees_imports_interfaces", "donnees_imports_interfaces.md"), `# Données / imports / interfaces — ${projectName}\n\n| Élément | Source | Usage | Points ouverts |\n|---|---|---|---|\n`);
  writeFileIfMissing(path.join(baseDir, "07_questions_blocages", "questions_blocages.md"), `# Questions ouvertes / blocages — ${projectName}\n\n| Date | Sujet | Statut | Responsable | Source |\n|---|---|---|---|---|\n`);
  writeFileIfMissing(path.join(baseDir, "10_log_pose", "log_pose.md"), `# Log Pose — ${projectName}\n\n## Ce qu’il faut retenir\n\n## Dernier cap validé\n\n## Manœuvres prioritaires\n\n## Questions ouvertes\n\n## Documents à retrouver\n\n## Prochaine direction utile\n`);
  syncLogPose(slug);

  return readProjectRecord(slug);
}

function readProjectRecord(projectSlug) {
  const projectDir = safePathInside(PROJECTS_ROOT, projectSlug);
  const metadata = readJsonIfExists(path.join(projectDir, "projet.json"));
  return {
    slug: projectSlug,
    name: metadata?.name || projectSlug.replaceAll("_", " "),
    description: metadata?.description || "",
    createdAt: metadata?.createdAt || null
  };
}

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

function normalizeKnowledgeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function markdownCells(line) {
  return String(line || "")
    .trim()
    .replace(/^\|/u, "")
    .replace(/\|$/u, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isMarkdownSeparator(line) {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/u.test(String(line || "").trim());
}

function extractMarkdownSection(content, headings) {
  const wanted = new Set(headings.map(normalizeKnowledgeText));
  const lines = String(content || "").split(/\r?\n/u);
  const start = lines.findIndex((line) => {
    if (!/^#{2,6}\s+/u.test(line.trim())) return false;
    return wanted.has(normalizeKnowledgeText(line.replace(/^#{2,6}\s+/u, "")));
  });
  if (start < 0) return [];

  const section = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s+/u.test(line.trim())) break;
    section.push(line);
  }
  return section;
}

function parseKnowledgeSection(lines, kind) {
  const meaningfulLines = lines.map((line) => line.trim()).filter(Boolean);
  if (!meaningfulLines.length) return [];

  const tableLines = meaningfulLines.filter((line) => line.startsWith("|"));
  if (tableLines.length >= 2 && isMarkdownSeparator(tableLines[1])) {
    const headers = markdownCells(tableLines[0]).map(normalizeKnowledgeText);
    return tableLines.slice(2)
      .filter((line) => !isMarkdownSeparator(line))
      .map((line) => {
        const values = markdownCells(line);
        return Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
      })
      .filter((row) => Object.values(row).some(Boolean));
  }

  return meaningfulLines
    .map((line) => line.replace(/^[-*]\s+/u, "").replace(/^\d+[.)]\s+/u, "").trim())
    .filter(Boolean)
    .map((text) => ({ [kind === "action" ? "action" : kind === "decision" ? "decision" : "need"]: text }));
}

function pickKnowledgeValue(row, names) {
  for (const name of names) {
    const value = row[normalizeKnowledgeText(name)];
    if (value) return value.trim();
  }
  return "";
}

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

function normalizeLogPoseList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  return String(value || "")
    .split(/[\r\n;]+/u)
    .map((item) => item.replace(/^[-*]\s+/u, "").trim())
    .filter(Boolean);
}

function normalizeLogPoseManual(value = {}) {
  return {
    whatToRemember: String(value.whatToRemember || "").trim(),
    openQuestions: normalizeLogPoseList(value.openQuestions),
    documentsToFind: normalizeLogPoseList(value.documentsToFind),
    nextDirection: String(value.nextDirection || "").trim()
  };
}

function readLogPoseManual(projectSlug) {
  const directory = safePathInside(PROJECTS_ROOT, projectSlug, "10_log_pose");
  const jsonPath = path.join(directory, "log_pose.json");
  const stored = readJsonIfExists(jsonPath);
  if (stored) return normalizeLogPoseManual(stored.manual || stored);

  const markdownPath = path.join(directory, "log_pose.md");
  if (!fs.existsSync(markdownPath)) return { ...LOG_POSE_DEFAULTS };
  const content = fs.readFileSync(markdownPath, "utf8");
  const sectionText = (heading) => extractMarkdownSection(content, [heading])
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("|") && !/^---+$/u.test(line))
    .join(" ")
    .trim();
  const sectionList = (heading) => extractMarkdownSection(content, [heading])
    .map((line) => line.trim().replace(/^[-*]\s+/u, ""))
    .filter((line) => line && !line.startsWith("|") && !/^---+$/u.test(line));

  return normalizeLogPoseManual({
    whatToRemember: sectionText("Ce qu’il faut retenir"),
    openQuestions: sectionList("Questions ouvertes"),
    documentsToFind: sectionList("Documents à retrouver"),
    nextDirection: sectionText("Prochaine direction utile")
  });
}

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

function isClosedKnowledgeStatus(value) {
  return /^(fait|faite|termine|terminee|clos|close|annule|annulee|abandonne|abandonnee)$/u.test(normalizeKnowledgeText(value));
}

function sortKnowledgeByDate(entries) {
  return [...entries].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}

function knowledgeReviewCounts(projectSlug, kind) {
  const accepted = readKnowledgeEntries(projectSlug, kind);
  const acceptedIds = new Set(accepted.map((item) => item.id));
  const pending = readValidatedKnowledgeProposals(projectSlug, kind)
    .filter((item) => !acceptedIds.has(item.id));
  return { accepted, pending };
}

function buildLogPose(projectSlug, manual = readLogPoseManual(projectSlug)) {
  const meetings = listProjectMeetings(projectSlug);
  const { accepted: decisions, pending: pendingDecisions } = knowledgeReviewCounts(projectSlug, "decision");
  const { accepted: actions, pending: pendingActions } = knowledgeReviewCounts(projectSlug, "action");
  const { accepted: needs, pending: pendingNeeds } = knowledgeReviewCounts(projectSlug, "need");
  const orderedDecisions = sortKnowledgeByDate(decisions);
  const latestDecision = orderedDecisions[0] || null;
  const priorityActions = actions
    .filter((item) => !isClosedKnowledgeStatus(item.statut))
    .sort((a, b) => {
      const statusRank = (value) => normalizeKnowledgeText(value) === "en cours" ? 0 : 1;
      return statusRank(a.statut) - statusRank(b.statut) || String(a.date || "").localeCompare(String(b.date || ""));
    })
    .slice(0, 5);
  const priorityNeeds = needs
    .filter((item) => !isClosedKnowledgeStatus(item.statut))
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")))
    .slice(0, 5);
  const latestMeeting = meetings[0] || null;
  const projectName = latestDecision?.projectName
    || priorityActions[0]?.projectName
    || priorityNeeds[0]?.projectName
    || readProjectRecord(projectSlug).name;
  const fallbackRemember = latestDecision?.decision
    || priorityNeeds[0]?.need
    || (latestMeeting ? `Dernière escale : ${latestMeeting.title}` : "Aucun repère validé pour le moment.");
  const fallbackDirection = priorityActions[0]?.action
    || (priorityNeeds[0] ? `Cadrer le besoin : ${priorityNeeds[0].need}` : "")
    || (pendingActions.length || pendingDecisions.length || pendingNeeds.length
      ? "Relire les propositions en attente de validation."
      : latestMeeting
        ? "Relire la dernière escale et poursuivre le fil."
        : "Préparer la première escale du projet.");

  return {
    version: 1,
    scope: "project",
    projectSlug,
    projectName,
    position: projectName,
    updatedAt: new Date().toISOString(),
    whatToRemember: manual.whatToRemember || fallbackRemember,
    lastMeeting: latestMeeting,
    lastDecision: latestDecision,
    priorityActions,
    priorityNeeds,
    openQuestions: manual.openQuestions,
    documentsToFind: manual.documentsToFind,
    nextDirection: manual.nextDirection || fallbackDirection,
    pendingReview: {
      actions: pendingActions.length,
      decisions: pendingDecisions.length,
      needs: pendingNeeds.length,
      total: pendingActions.length + pendingDecisions.length + pendingNeeds.length
    }
  };
}

function logPoseMarkdownList(items, emptyText) {
  return items.length ? items.map((item) => `- ${knowledgeMarkdownValue(item)}`) : [`- ${emptyText}`];
}

function writeLogPose(projectSlug, snapshot, manual) {
  const directory = safePathInside(PROJECTS_ROOT, projectSlug, "10_log_pose");
  ensureDir(directory);
  const normalizedManual = normalizeLogPoseManual(manual);
  const payload = { ...snapshot, manual: normalizedManual };
  fs.writeFileSync(path.join(directory, "log_pose.json"), JSON.stringify(payload, null, 2), "utf8");

  const actionLines = snapshot.priorityActions.length
    ? snapshot.priorityActions.map((item) => {
      const details = [item.responsable, item.echeance].filter(Boolean).join(" · ");
      return `- [${knowledgeMarkdownValue(item.statut || "À préciser")}] ${knowledgeMarkdownValue(item.action)}${details ? ` — ${knowledgeMarkdownValue(details)}` : ""}`;
    })
    : ["- Aucune manœuvre prioritaire validée."];
  const decisionLine = snapshot.lastDecision
    ? `- ${knowledgeMarkdownValue(snapshot.lastDecision.decision)} (${knowledgeMarkdownValue(snapshot.lastDecision.statut || "À préciser")})`
    : "- Aucun cap validé pour le moment.";
  const needLines = snapshot.priorityNeeds?.length
    ? snapshot.priorityNeeds.map((item) => `- [${knowledgeMarkdownValue(item.priority || "À préciser")}] ${knowledgeMarkdownValue(item.need)}${item.context ? ` — ${knowledgeMarkdownValue(item.context)}` : ""}`)
    : ["- Aucun besoin validé pour le moment."];
  const lines = [
    `# Log Pose — ${knowledgeMarkdownValue(snapshot.projectName)}`,
    "",
    `_Mise à jour : ${snapshot.updatedAt}_`,
    "",
    "## Ce qu’il faut retenir",
    "",
    knowledgeMarkdownValue(snapshot.whatToRemember || "Aucun repère validé pour le moment."),
    "",
    "## Dernier cap validé",
    "",
    decisionLine,
    "",
    "## Manœuvres prioritaires",
    "",
    ...actionLines,
    "",
    "## Besoins à cadrer",
    "",
    ...needLines,
    "",
    "## Questions ouvertes",
    "",
    ...logPoseMarkdownList(normalizedManual.openQuestions, "Aucune question ouverte enregistrée."),
    "",
    "## Documents à retrouver",
    "",
    ...logPoseMarkdownList(normalizedManual.documentsToFind, "Aucun document à retrouver enregistré."),
    "",
    "## Prochaine direction utile",
    "",
    knowledgeMarkdownValue(snapshot.nextDirection || "Aucune direction définie."),
    "",
    "## État de validation",
    "",
    `- ${snapshot.pendingReview.total} élément${snapshot.pendingReview.total > 1 ? "s" : ""} en attente de validation (${snapshot.pendingReview.actions} manœuvre${snapshot.pendingReview.actions > 1 ? "s" : ""}, ${snapshot.pendingReview.decisions} cap${snapshot.pendingReview.decisions > 1 ? "s" : ""}, ${snapshot.pendingReview.needs || 0} besoin${(snapshot.pendingReview.needs || 0) > 1 ? "s" : ""}).`
  ];
  fs.writeFileSync(path.join(directory, "log_pose.md"), `${lines.join("\n")}\n`, "utf8");
  return payload;
}

function syncLogPose(projectSlug) {
  const manual = readLogPoseManual(projectSlug);
  return writeLogPose(projectSlug, buildLogPose(projectSlug, manual), manual);
}

function buildGlobalLogPose(projectSlugs) {
  const projectSnapshots = projectSlugs.map((projectSlug) => buildLogPose(projectSlug));
  const meetings = projectSnapshots
    .map((snapshot) => snapshot.lastMeeting ? { ...snapshot.lastMeeting, projectName: snapshot.projectName } : null)
    .filter(Boolean)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const decisions = projectSnapshots
    .map((snapshot) => snapshot.lastDecision ? { ...snapshot.lastDecision, projectName: snapshot.projectName } : null)
    .filter(Boolean)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const priorityActions = projectSnapshots
    .flatMap((snapshot) => snapshot.priorityActions.map((item) => ({ ...item, projectName: snapshot.projectName })))
    .slice(0, 5);
  const priorityNeeds = projectSnapshots
    .flatMap((snapshot) => (snapshot.priorityNeeds || []).map((item) => ({ ...item, projectName: snapshot.projectName })))
    .slice(0, 5);
  const pendingReview = projectSnapshots.reduce((total, snapshot) => ({
    actions: total.actions + snapshot.pendingReview.actions,
    decisions: total.decisions + snapshot.pendingReview.decisions,
    needs: total.needs + (snapshot.pendingReview.needs || 0),
    total: total.total + snapshot.pendingReview.total
  }), { actions: 0, decisions: 0, needs: 0, total: 0 });

  return {
    version: 1,
    scope: "global",
    projectSlug: "",
    projectName: "Mémoire globale",
    position: projectSlugs.length ? `${projectSlugs.length} île${projectSlugs.length > 1 ? "s" : ""} suivie${projectSlugs.length > 1 ? "s" : ""}` : "Aucune île enregistrée",
    updatedAt: new Date().toISOString(),
    whatToRemember: decisions[0]?.decision || priorityNeeds[0]?.need || (meetings[0] ? `Dernière escale : ${meetings[0].title}` : "Aucun repère validé pour le moment."),
    lastMeeting: meetings[0] || null,
    lastDecision: decisions[0] || null,
    priorityActions,
    priorityNeeds,
    openQuestions: [],
    documentsToFind: [],
    nextDirection: priorityActions[0]?.action || (priorityNeeds[0] ? `Cadrer le besoin : ${priorityNeeds[0].need}` : null) || (pendingReview.total ? "Relire les propositions en attente de validation." : "Choisir une île pour reprendre le fil."),
    pendingReview
  };
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
    const depositId = timestampForFile();
    const depositDir = path.join(WATER_SEVEN_ROOT, depositId);
    ensureDir(depositDir);

    const safeOriginalName = safeSegment(req.file.originalname || "document") || "document";
    const filePath = path.join(depositDir, safeOriginalName);
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
    fs.writeFileSync(audioPath, req.file.buffer);

    res.status(201).json({ status: "ok", audioFileName: path.basename(audioPath) });
  } catch (error) {
    res.status(400).json({ error: error.message || "Erreur pendant l’export audio." });
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

function walkFiles(dirPath, files = [], { includeHistory = false } = {}) {
  if (!fs.existsSync(dirPath)) return files;

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
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
        const content = fs.readFileSync(filePath, "utf8");
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

    const content = fs.readFileSync(filePath, "utf8");
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
