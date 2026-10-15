import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");
const exists = (relativePath) => fs.existsSync(path.join(ROOT, relativePath));

test("les services locaux restent limités à la boucle locale", () => {
  for (const file of [
    "backend/server.js",
    "backend/transcription-server-v6.js"
  ]) {
    const source = read(file);
    assert.match(source, /app\.listen\([^\n]*"127\.0\.0\.1"/u, `${file} doit écouter uniquement sur 127.0.0.1`);
    assert.doesNotMatch(source, /app\.use\(cors\(\)\)/u, `${file} ne doit pas autoriser CORS sans restriction`);
  }
});

test("8010 est la porte unique de l'interface", () => {
  const gateway = read("backend/server.js");
  const transcriptionView = read("src/TranscriptionView.jsx");
  assert.match(gateway, /proxyTranscriptionRequest/u);
  assert.match(gateway, /app\.use\("\/api\/transcription", proxyTranscriptionRequest\)/u);
  assert.match(transcriptionView, /127\.0\.0\.1:8010/u);
  assert.doesNotMatch(transcriptionView, /8011/u);
});

test("Multer reste verrouillé sur la version consolidée", () => {
  const packageJson = JSON.parse(read("package.json"));
  const packageLock = JSON.parse(read("package-lock.json"));
  assert.equal(packageJson.dependencies?.multer, "2.4.0");
  assert.equal(packageLock.packages?.[""]?.dependencies?.multer, "2.4.0");
  assert.equal(packageLock.packages?.["node_modules/multer"]?.version, "2.4.0");
});

test("les dépendances frontend critiques ne reviennent pas à latest", () => {
  const packageJson = JSON.parse(read("package.json"));
  for (const dependency of ["@vitejs/plugin-react", "lucide-react", "react", "react-dom", "vite"]) {
    const version = packageJson.dependencies?.[dependency];
    assert.ok(version && version !== "latest", `${dependency} doit rester explicitement versionnée`);
    assert.match(version, /^\d+\.\d+\.\d+(?:[-+].+)?$/u, `${dependency} doit utiliser une version exacte`);
  }
});

test("les dépendances Python de transcription sont verrouillées", () => {
  const requirements = read("requirements-transcription.txt")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  assert.deepEqual(requirements, [
    "faster-whisper==1.2.1",
    "pyannote.audio==4.0.7"
  ]);
});

test("les anciennes versions du moteur ne restent pas dans le code actif", () => {
  for (const file of [
    "backend/transcription-server.js",
    "backend/transcription-server-v2.js",
    "backend/transcription-server-v3.js",
    "backend/transcription-server-v4.js",
    "backend/transcription-server-v5.js"
  ]) {
    assert.equal(exists(file), false, `${file} doit rester uniquement dans l'historique Git`);
  }
  assert.equal(exists("backend/transcription-server-v6.js"), true);
});

test("les écrans principaux consomment la mémoire locale plutôt qu'une maquette", () => {
  const app = read("src/App.jsx");
  assert.match(app, /loadProjects/u);
  assert.match(app, /loadInbox/u);
  assert.doesNotMatch(app, /const ISLAND_PROJECTS/u);
  assert.doesNotMatch(app, /const GLOBAL_PRIORITIES/u);
  assert.equal(exists("src/features/projects/ProjectsView.jsx"), true);
  assert.equal(exists("src/features/meetings/MeetingModePanel.jsx"), true);
  assert.equal(exists("src/features/search/SearchView.jsx"), true);
  assert.match(read("src/features/projects/ProjectsView.jsx"), /createProject/u);
  assert.match(read("src/features/meetings/MeetingsView.jsx"), /Enregistrer les corrections/u);
  assert.match(read("src/features/search/SearchView.jsx"), /Filtrer par île/u);
  assert.match(read("src/features/search/SearchView.jsx"), /Lire la source/u);
  assert.match(read("src/lib/local-api.js"), /readMemorySource/u);
});

test("les pages de démonstration obsolètes ne sont plus publiées", () => {
  assert.equal(exists("public/transcription-test.html"), false);
  assert.equal(exists("public/notion-secure-demo.html"), false);
});

test("la synchronisation des interlocuteurs n'altère plus Storage.prototype", () => {
  assert.equal(exists("src/speaker-map-sync.js"), false);
  const main = read("src/main.jsx");
  assert.doesNotMatch(main, /speaker-map-sync/u);
  const view = read("src/TranscriptionView.jsx");
  assert.doesNotMatch(view, /SPEAKER_API/u);
  assert.equal(exists("backend/speaker-sync-server.js"), false);
  assert.match(read("backend/transcription-server-v6.js"), /\/api\/transcription\/:jobId\/speakers/u);
  assert.match(view, /Confirmer ces noms/u);
});

test("le mode cloud exige un consentement explicite", () => {
  const view = read("src/TranscriptionView.jsx");
  assert.match(view, /cloudConsent/u);
  assert.match(view, /mode !== "high" \|\| cloudConsent/u);
  assert.match(view, /seront envoyés à OpenAI/u);
});

test("le cache évite aussi les doubles lancements encore en cours", () => {
  const server = read("backend/transcription-server-v6.js");
  assert.match(server, /reusableStates/u);
  assert.match(server, /already-running/u);
});

test("une transcription liée à une escale rejoint son journal", () => {
  const server = read("backend/transcription-server-v6.js");
  const memoryApi = read("backend/server.js");
  assert.match(server, /persistTranscriptionToMeeting/u);
  assert.match(server, /transcription_v6\.json/u);
  assert.match(server, /Transcription automatique V6/u);
  assert.match(memoryApi, /hasTranscription/u);
});

test("le Coffre expose les documents locaux avec validation humaine", () => {
  const memoryApi = read("backend/server.js");
  const localApi = read("src/lib/local-api.js");
  const documentsView = read("src/features/documents/DocumentsView.jsx");
  const app = read("src/App.jsx");
  assert.match(memoryApi, /app.get\("\/api\/documents"/u);
  assert.match(memoryApi, /app.post\("\/api\/documents\/validate"/u);
  assert.match(memoryApi, /relativePath/u);
  assert.doesNotMatch(memoryApi, /filePath: filePath/u);
  assert.match(localApi, /loadDocuments/u);
  assert.match(documentsView, /Valider le classement/u);
  assert.match(documentsView, /depositDocument/u);
  assert.match(app, /DocumentsView/u);
  assert.equal(exists("src/features/documents/DocumentsView.jsx"), true);
});

test("les Manœuvres et Caps viennent des journaux validés", () => {
  const memoryApi = read("backend/server.js");
  const localApi = read("src/lib/local-api.js");
  const knowledgeView = read("src/features/knowledge/KnowledgeView.jsx");
  const app = read("src/App.jsx");
  assert.match(memoryApi, /app\.get\("\/api\/knowledge\/:kind"/u);
  assert.match(memoryApi, /app\.post\("\/api\/knowledge\/:kind\/validate"/u);
  assert.match(memoryApi, /journal_de_bord_valide\.md/u);
  assert.match(memoryApi, /reviewStatus: "à valider"/u);
  assert.match(localApi, /loadKnowledge/u);
  assert.match(localApi, /validateKnowledge/u);
  assert.match(knowledgeView, /journaux de bord validés/u);
  assert.match(knowledgeView, /Valider ce/u);
  assert.match(app, /KnowledgeView kind="action"/u);
  assert.match(app, /KnowledgeView kind="decision"/u);
  assert.equal(exists("src/features/knowledge/KnowledgeView.jsx"), true);
});

test("les besoins de construction restent traçables et validables", () => {
  const memoryApi = read("backend/server.js");
  const meetingMode = read("src/components/MeetingMode.jsx");
  const knowledgeView = read("src/features/knowledge/KnowledgeView.jsx");
  const app = read("src/App.jsx");
  assert.match(memoryApi, /need:/u);
  assert.match(memoryApi, /besoins\.json/u);
  assert.match(memoryApi, /type === "need"/u);
  assert.match(meetingMode, /Besoin utilisateur/u);
  assert.match(knowledgeView, /Besoins/u);
  assert.match(app, /KnowledgeView kind="need"/u);
});

test("le Log Pose persiste et reprend les validations", () => {
  const memoryApi = read("backend/server.js");
  const localApi = read("src/lib/local-api.js");
  const logPoseView = read("src/features/log-pose/LogPoseView.jsx");
  const app = read("src/App.jsx");
  assert.match(memoryApi, /app\.get\("\/api\/log-pose"/u);
  assert.match(memoryApi, /app\.post\("\/api\/log-pose\/save"/u);
  assert.match(memoryApi, /syncLogPose\(safeProjectSlug\)/u);
  assert.match(memoryApi, /log_pose\.json/u);
  assert.match(localApi, /loadLogPose/u);
  assert.match(localApi, /saveLogPose/u);
  assert.match(logPoseView, /lastDecision/u);
  assert.match(logPoseView, /priorityActions/u);
  assert.match(app, /LogPoseView/u);
  assert.equal(exists("src/features/log-pose/LogPoseView.jsx"), true);
});

test("le nombre de participants ne force pas le nombre de voix Pyannote", () => {
  const server = read("backend/transcription-server-v6.js");
  assert.doesNotMatch(server, /args\.push\("--num-speakers"/u);
});

test("un nom n'est auto-attribué qu'après une présentation explicite", () => {
  const server = read("backend/transcription-server-v6.js");
  assert.match(server, /if \(!selfCue\) return 0/u);
  assert.doesNotMatch(server, /confidence: "elimination"/u);
  assert.doesNotMatch(server, /helloCue/u);
});
