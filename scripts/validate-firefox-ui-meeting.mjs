// Test Firefox de la vraie interface Vogue Mary, sur données fictives et HOME jetable.
// Il ne s'appuie pas sur la voix ou les fichiers de l'utilisateur.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { firefox } from "playwright";
import { createHash } from "node:crypto";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "vogue-e2e-ui-"));
const children = [];
let browser;
let crashContext;
let backend;

async function waitForChunks(page, count) {
  const deadline = Date.now() + 20000;
  do {
    const snapshot = await snapshotAudio(page);
    if (snapshot?.chunks.length >= count) return snapshot;
    await delay(100);
  } while (Date.now() < deadline);
  throw new Error(`Fragments confirmés insuffisants : ${count} attendus.`);
}

async function snapshotAudio(page) {
  return page.evaluate(async () => {
    const { recoverDurableAudioSession, pendingAudioChunks } = await import("/src/lib/audio-chunk-queue.js");
    const { recoverLocalMarkers } = await import("/src/lib/meeting-marker-backup.js");
    const session = await recoverDurableAudioSession();
    if (!session) return null;
    const chunks = await pendingAudioChunks(session.sessionId);
    const digest = async (blob) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())))
      .map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return {
      session,
      chunks: await Promise.all(chunks.map(async (chunk) => ({ index: chunk.index, size: chunk.blob.size, sha256: await digest(chunk.blob) }))),
      joinedSha256: await digest(new Blob(chunks.map((chunk) => chunk.blob))),
      markers: recoverLocalMarkers(session.sessionId)
    };
  });
}

function killOwnedFirefox(profile) {
  assert.equal(process.platform, "linux", "Cette recette SIGKILL utilise /proc sous Linux.");
  const pids = fs.readFileSync(`/proc/${process.pid}/task/${process.pid}/children`, "utf8").trim().split(/\s+/u).filter(Boolean);
  const matches = pids.filter((pid) => {
    try {
      const args = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0");
      return args.includes(profile) && path.basename(args[0]).startsWith("firefox");
    } catch { return false; }
  });
  assert.equal(matches.length, 1, "Interrompre uniquement le Firefox enfant de cette recette et son profil jetable.");
  process.kill(Number(matches[0]), "SIGKILL");
  return Number(matches[0]);
}
function launch(cmd, args, env) {
  const child = spawn(cmd, args, { cwd: process.cwd(), env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  child.stderr.on("data", (data) => process.stderr.write(String(data)));
  return child;
}
async function waitFor(url) {
  for (let n = 0; n < 100; n++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(700) });
      if (response.ok) return;
    } catch { /* serveur en cours de démarrage */ }
    await delay(100);
  }
  throw new Error("Service de test inaccessible : " + url);
}

try {
  backend = launch(process.execPath, ["backend/server.js"], { HOME: home });
  launch(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5173", "--strictPort"]);
  await Promise.all([
    waitFor("http://127.0.0.1:8010/api/projects"),
    waitFor("http://127.0.0.1:5173/")
  ]);
  const created = await fetch("http://127.0.0.1:8010/api/projects", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Île fictive Firefox E2E" })
  });
  assert.equal(created.status, 201, await created.text().catch(() => ""));
  // L'identifiant de projet est enregistré uniquement dans ce HOME de test.
  const projects = await (await fetch("http://127.0.0.1:8010/api/projects")).json();
  const slug = projects.projects[0].slug;

  browser = await firefox.launch({
    headless: true,
    firefoxUserPrefs: {
      "media.navigator.streams.fake": true,
      "media.navigator.permission.disabled": true
    }
  });
  const context = await browser.newContext();
  // Le vert représente les prérequis, pas une validation des modèles ou du micro.
  const healthPage = await context.newPage();
  let prerequisitesAvailable = true;
  let healthStatus = 200;
  await healthPage.route("**/api/transcription/health", (route) => route.fulfill({
    status: healthStatus,
    json: { status: "ok", service: "vogue-marry-transcription", localEngineReady: prerequisitesAvailable,
      localModel: "modele-fictif", highPrecisionReady: false, pyannoteInstalled: false, modelsTested: false, microphoneTested: false }
  }));
  await healthPage.route("**/api/transcription/escales", (route) => route.fulfill({ json: { escales: [] } }));
  await healthPage.goto("http://127.0.0.1:5173/transcription");
  await healthPage.getByText("Prérequis disponibles · modele-fictif", { exact: true }).waitFor();
  await healthPage.getByText("Ce contrôle vérifie l’installation, sans tester les modèles ni le microphone.", { exact: false }).waitFor();
  const dummyAudio = { name: "audio-fictif.webm", mimeType: "audio/webm", buffer: Buffer.from("AUDIO_FICTIF_NON_DECODABLE") };
  await healthPage.locator('input[type="file"]').setInputFiles(dummyAudio);
  await healthPage.getByText(dummyAudio.name, { exact: true }).waitFor();
  assert.equal(await healthPage.getByRole("button", { name: "Transcrire gratuitement" }).isEnabled(), true);
  prerequisitesAvailable = false;
  await healthPage.reload();
  await healthPage.getByText("Configuration à vérifier", { exact: true }).waitFor();
  await healthPage.getByText("Les dépendances locales sont absentes, incompatibles ou ne se chargent pas.", { exact: false }).waitFor();
  await healthPage.locator('input[type="file"]').setInputFiles(dummyAudio);
  await healthPage.getByText(dummyAudio.name, { exact: true }).waitFor();
  assert.equal(await healthPage.getByRole("button", { name: "Transcrire gratuitement" }).isDisabled(), true);
  healthStatus = 503;
  prerequisitesAvailable = true; // Un corps positif ne rend pas saine une réponse HTTP en erreur.
  await healthPage.reload();
  await healthPage.getByText("Le moteur local est indisponible ou son état n’a pas pu être vérifié.", { exact: false }).waitFor();
  await healthPage.locator('input[type="file"]').setInputFiles(dummyAudio);
  await healthPage.getByText(dummyAudio.name, { exact: true }).waitFor();
  assert.equal(await healthPage.getByRole("button", { name: "Transcrire gratuitement" }).isDisabled(), true);
  console.log("RESULTAT_SANTE_INTERFACE_FIREFOX", JSON.stringify({ prerequisitesLabel: true, modelsNotClaimedTested: true, missingDependenciesDisableStart: true, unhealthyHttpDisablesStart: true }));
  await healthPage.close();
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:5173/");
  await page.locator(".side-nav button").filter({ hasText: "Escales" }).click();
  await page.getByLabel("Île / projet").selectOption(slug);
  const title = "Escale test navigateur Firefox";
  await page.getByLabel("Titre de l’escale").fill(title);
  await page.getByLabel("Participants").fill("Intervenant fictif 1, Intervenant fictif 2");
  await page.getByRole("button", { name: "Démarrer l’enregistrement" }).click();
  await page.getByRole("button", { name: "Arrêter la réunion" }).waitFor({ state: "visible", timeout: 10000 });
  await page.locator(".markerGrid button").filter({ hasText: "Décision" }).click();
  await page.waitForTimeout(11000); // Deux tranches de 5 s + bloc final.
  await page.getByRole("button", { name: "Arrêter la réunion" }).click();
  await page.getByText("Audio finalisé et sauvegardé.", { exact: false }).waitFor({ timeout: 20000 });

  const meetingsRoot = path.join(home, "VOGUE-MERRY-DONNEES", "01_PROJETS", slug, "01_escales_reunions");
  const folders = fs.readdirSync(meetingsRoot, { withFileTypes: true }).filter((item) => item.isDirectory());
  assert.equal(folders.length, 1, "Une seule escale doit être créée par un démarrage.");
  const meetingDir = path.join(meetingsRoot, folders[0].name);
  const originals = fs.readdirSync(meetingDir).filter((name) => name.startsWith("audio_original."));
  assert.equal(originals.length, 1, "Un seul original audio doit exister.");
  assert.ok(fs.statSync(path.join(meetingDir, originals[0])).size > 100, "L'audio ne doit pas être vide.");
  const meta = JSON.parse(fs.readFileSync(path.join(meetingDir, "donnees_escale.json"), "utf8"));
  assert.equal(meta.markers.length, 1, "Le marqueur doit survivre à l'enregistrement.");
  assert.equal(meta.markers[0].type, "decision");

  // Après la sauvegarde, le journal affiche l'original et ses repères navigables.
  // Le lecteur est fourni par l'API locale, non par un fichier de Git.
  await page.reload();
  await page.locator(".side-nav button").filter({ hasText: "Escales" }).click();
  await page.locator(".meeting-card").filter({ hasText: title }).waitFor({ timeout: 12000 });
  // Réseau coupé sur le premier envoi progressif : IndexedDB doit permettre
  // l'envoi final après rétablissement et la réunion ne doit pas être perdue.
  let interruptedUploads = 0;
  await page.route("**/api/meetings/audio-chunk", (route) => {
    if (interruptedUploads++ === 0) return route.abort("failed");
    return route.continue();
  });
  await page.getByLabel("Île / projet").selectOption(slug);
  await page.getByLabel("Titre de l’escale").fill("Escale test coupure progressive");
  await page.getByRole("button", { name: "Démarrer l’enregistrement" }).click();
  await page.getByRole("button", { name: "Arrêter la réunion" }).waitFor({ state: "visible", timeout: 10000 });
  await page.waitForTimeout(7100);
  await page.getByRole("button", { name: "Arrêter la réunion" }).click();
  await page.getByText("Audio finalisé et sauvegardé.", { exact: false }).waitFor({ timeout: 25000 });
  assert.ok(interruptedUploads >= 2, "La reprise doit retenter un envoi après la coupure.");
  const secondMeetingFolders = fs.readdirSync(meetingsRoot, { withFileTypes: true })
    .filter((item) => item.isDirectory());
  assert.equal(secondMeetingFolders.length, 2, "La capture coupée doit produire une escale supplémentaire.");

  // Refus du miroir localStorage : le compteur et les fragments IndexedDB
  // doivent suffire pour finaliser un enregistrement dans un vrai Firefox.
  await page.reload();
  await page.locator(".side-nav button").filter({ hasText: "Escales" }).click();
  await page.evaluate(() => {
    const originalSetItem = Storage.prototype.setItem;
    window.__blockedSessionWrites = 0;
    Storage.prototype.setItem = function (key, value) {
      if (key === "vogue-mary-audio-active-session") {
        window.__blockedSessionWrites++;
        throw new DOMException("Quota synthétique pour la recette", "QuotaExceededError");
      }
      return originalSetItem.call(this, key, value);
    };
  });
  await page.getByLabel("Île / projet").selectOption(slug);
  await page.getByLabel("Titre de l’escale").fill("Escale test miroir localStorage refusé");
  await page.getByRole("button", { name: "Démarrer l’enregistrement" }).click();
  await page.getByRole("button", { name: "Arrêter la réunion" }).waitFor({ state: "visible", timeout: 10000 });
  await page.waitForTimeout(7100);
  await page.getByRole("button", { name: "Arrêter la réunion" }).click();
  await page.getByText("Audio finalisé et sauvegardé.", { exact: false }).waitFor({ timeout: 25000 });
  const blockedSessionWrites = await page.evaluate(() => window.__blockedSessionWrites);
  assert.ok(blockedSessionWrites > 0, "Le scénario doit réellement refuser l'écriture du miroir.");
  assert.equal(await page.evaluate(() => localStorage.getItem("vogue-mary-audio-active-session")), null);
  const finalMeetingFolders = fs.readdirSync(meetingsRoot, { withFileTypes: true }).filter((item) => item.isDirectory());
  assert.equal(finalMeetingFolders.length, 3);
  for (const folder of finalMeetingFolders) {
    const directory = path.join(meetingsRoot, folder.name);
    const audio = fs.readdirSync(directory).filter((name) => name.startsWith("audio_original."));
    assert.equal(audio.length, 1);
    assert.ok(fs.statSync(path.join(directory, audio[0])).size > 100);
  }

  console.log("RESULTAT_INTERFACE_FIREFOX", JSON.stringify({
    escales: finalMeetingFolders.length, audio: originals[0], markers: meta.markers.length, title, blockedSessionWrites
  }));

  // Deux minutes de capture avec tous les transferts réunion indisponibles.
  const longContext = await browser.newContext();
  const longPage = await longContext.newPage();
  await longPage.goto("http://127.0.0.1:5173/");
  await longPage.locator(".side-nav button").filter({ hasText: "Escales" }).click();
  await longPage.getByLabel("Île / projet").selectOption(slug);
  await longPage.getByLabel("Titre de l’escale").fill("Escale fictive coupure de deux minutes");
  await longPage.getByRole("button", { name: "Démarrer l’enregistrement" }).click();
  await longPage.getByRole("button", { name: "Arrêter la réunion" }).waitFor({ timeout: 10000 });
  let blockedTransfers = 0;
  await longPage.route("**/api/meetings/**", (route) => {
    blockedTransfers++;
    return route.abort("failed");
  });
  const outageStart = Date.now();
  for (const [index, label] of ["Décision", "Action", "Question"].entries()) {
    const remaining = outageStart + index * 60000 - Date.now();
    if (remaining > 0) await delay(remaining);
    await longPage.locator(".markerGrid button").filter({ hasText: label }).click();
  }
  await longPage.getByRole("button", { name: "Arrêter la réunion" }).click();
  await longPage.getByText("Audio à récupérer :", { exact: false }).waitFor({ timeout: 20000 });
  const queued = await snapshotAudio(longPage);
  assert.equal(queued.session.finalizedCapture, true);
  assert.ok(queued.chunks.length >= 20, "Une capture de deux minutes doit produire de nombreuses tranches réelles.");
  assert.deepEqual(queued.chunks.map((chunk) => chunk.index), queued.chunks.map((_, index) => index));
  assert.equal(queued.session.count, queued.chunks.length);
  assert.deepEqual(queued.markers.map((marker) => marker.type), ["decision", "action", "question"]);
  assert.ok(queued.markers[1].timeSeconds >= 55 && queued.markers[2].timeSeconds >= 115);
  assert.ok(blockedTransfers >= 4, "La coupure doit réellement refuser audio et marqueurs.");
  const longMeetingDir = path.join(meetingsRoot, queued.session.meetingDirName);
  assert.equal(fs.readdirSync(longMeetingDir).some((name) => name.startsWith("audio_original.")), false);
  await longPage.reload();
  await longPage.locator(".side-nav button").filter({ hasText: "Escales" }).click();
  await longPage.getByRole("button", { name: "Reprendre la sauvegarde audio" }).waitFor();
  const reloaded = await snapshotAudio(longPage);
  assert.deepEqual(reloaded.chunks, queued.chunks);
  assert.deepEqual(reloaded.markers, queued.markers);
  const outageEnd = Date.now();
  await longPage.unroute("**/api/meetings/**");
  await longPage.getByRole("button", { name: "Reprendre la sauvegarde audio" }).click();
  await longPage.getByText("Blocs audio récupérés et finalisés. Vérifiez l'écoute.", { exact: false }).waitFor({ timeout: 30000 });
  const longOriginals = fs.readdirSync(longMeetingDir).filter((name) => name.startsWith("audio_original."));
  assert.equal(longOriginals.length, 1);
  const longOriginal = path.join(longMeetingDir, longOriginals[0]);
  assert.equal(createHash("sha256").update(fs.readFileSync(longOriginal)).digest("hex"), queued.joinedSha256);
  for (const chunk of queued.chunks) {
    const file = path.join(longMeetingDir, "audio_chunks", `chunk_${String(chunk.index).padStart(6, "0")}.part`);
    assert.equal(fs.statSync(file).size, chunk.size);
    assert.equal(createHash("sha256").update(fs.readFileSync(file)).digest("hex"), chunk.sha256);
  }
  const longMeta = JSON.parse(fs.readFileSync(path.join(longMeetingDir, "donnees_escale.json"), "utf8"));
  assert.deepEqual(longMeta.markers, queued.markers, "Les repères et leurs positions restent identiques après reprise.");
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "json", longOriginal], { encoding: "utf8" });
  assert.equal(probe.status, 0, probe.stderr);
  const duration = Number(JSON.parse(probe.stdout).format.duration);
  assert.ok(duration >= 119 && duration < 150, `Durée audio de reprise inattendue : ${duration}`);
  const longDecode = spawnSync("ffmpeg", ["-v", "error", "-i", longOriginal, "-f", "null", "-"], { encoding: "utf8" });
  assert.equal(longDecode.status, 0, longDecode.stderr);
  assert.equal(longDecode.stderr.trim(), "", "Le décodage ne doit signaler aucune erreur.");
  assert.equal(await snapshotAudio(longPage), null, "Le nettoyage local attend la finalisation confirmée.");
  await longPage.reload();
  await longPage.locator(".side-nav button").filter({ hasText: "Escales" }).click();
  assert.equal(await snapshotAudio(longPage), null, "Une session finalisée ne doit pas réapparaître au rechargement.");
  console.log("RESULTAT_COUPURE_PROLONGEE_FIREFOX", JSON.stringify({
    outageSeconds: (outageEnd - outageStart) / 1000, audioSeconds: duration,
    chunks: queued.chunks.length, markers: longMeta.markers.length, blockedTransfers,
    identicalBytes: true, decodedWithoutErrors: true, finalized: true
  }));
  await longContext.close();

  // Refus persistant d'écriture IndexedDB après un premier fragment durable.
  const quotaContext = await browser.newContext();
  const quotaPage = await quotaContext.newPage();
  await quotaPage.goto("http://127.0.0.1:5173/");
  await quotaPage.locator(".side-nav button").filter({ hasText: "Escales" }).click();
  await quotaPage.getByLabel("Île / projet").selectOption(slug);
  await quotaPage.getByLabel("Titre de l’escale").fill("Escale fictive quota IndexedDB");
  await quotaPage.getByRole("button", { name: "Démarrer l’enregistrement" }).click();
  await quotaPage.getByRole("button", { name: "Arrêter la réunion" }).waitFor();
  await quotaPage.locator(".markerGrid button").filter({ hasText: "Décision" }).click();
  const beforeQuota = await waitForChunks(quotaPage, 1);
  await quotaPage.evaluate(() => {
    const original = IDBObjectStore.prototype.add;
    window.__quotaRefusals = 0;
    IDBObjectStore.prototype.add = function (value, key) {
      if (this.name === "chunks") {
        window.__quotaRefusals++;
        throw new DOMException("Quota IndexedDB fictif", "QuotaExceededError");
      }
      return key === undefined ? original.call(this, value) : original.call(this, value, key);
    };
  });
  await quotaPage.getByText("Audio à récupérer :", { exact: false }).waitFor({ timeout: 15000 });
  assert.equal(await quotaPage.getByRole("button", { name: "Arrêter la réunion" }).count(), 0,
    "La capture doit s'arrêter après le refus du stockage.");
  const quotaRefusals = await quotaPage.evaluate(() => window.__quotaRefusals);
  assert.ok(quotaRefusals >= 2, "Le dernier événement doit aussi tenter sa conservation.");
  const afterQuota = await snapshotAudio(quotaPage);
  assert.deepEqual(afterQuota.chunks, beforeQuota.chunks);
  assert.deepEqual(afterQuota.markers, beforeQuota.markers);
  assert.equal(afterQuota.session.count, beforeQuota.session.count);
  assert.equal(afterQuota.session.finalizedCapture, false);
  const quotaMeetingDir = path.join(meetingsRoot, afterQuota.session.meetingDirName);
  assert.equal(fs.readdirSync(quotaMeetingDir).some((name) => name.startsWith("audio_original.")), false);
  await quotaPage.reload();
  await quotaPage.locator(".side-nav button").filter({ hasText: "Escales" }).click();
  await quotaPage.getByRole("button", { name: "Exporter les fragments audio (secours)" }).waitFor();
  const reloadedQuota = await snapshotAudio(quotaPage);
  assert.deepEqual(reloadedQuota.chunks, beforeQuota.chunks);
  assert.deepEqual(reloadedQuota.markers, beforeQuota.markers);
  const quotaDownloadReady = quotaPage.waitForEvent("download");
  await quotaPage.getByRole("button", { name: "Exporter les fragments audio (secours)" }).click();
  const quotaFile = path.join(home, "quota secours fictif.bin");
  await (await quotaDownloadReady).saveAs(quotaFile);
  assert.equal(createHash("sha256").update(fs.readFileSync(quotaFile)).digest("hex"), beforeQuota.joinedSha256);
  const quotaDecode = spawnSync("ffmpeg", ["-v", "error", "-i", quotaFile, "-f", "null", "-"], { encoding: "utf8" });
  assert.equal(quotaDecode.status, 0, quotaDecode.stderr);
  assert.deepEqual((await snapshotAudio(quotaPage)).chunks, beforeQuota.chunks);
  console.log("RESULTAT_QUOTA_INDEXEDDB_FIREFOX", JSON.stringify({
    quotaRefusals, retained: afterQuota.chunks.length, stoppedAutomatically: true,
    identicalBytes: true, emergencyAudioDecoded: true, finalized: false
  }));
  await quotaContext.close();

  // Arrêt réel du backend, avec un fragment déjà reçu sur disque.
  const restartContext = await browser.newContext();
  const restartPage = await restartContext.newPage();
  await restartPage.goto("http://127.0.0.1:5173/");
  await restartPage.locator(".side-nav button").filter({ hasText: "Escales" }).click();
  await restartPage.getByLabel("Île / projet").selectOption(slug);
  await restartPage.getByLabel("Titre de l’escale").fill("Escale fictive arrêt backend");
  await restartPage.getByRole("button", { name: "Démarrer l’enregistrement" }).click();
  await restartPage.getByRole("button", { name: "Arrêter la réunion" }).waitFor();
  const beforeBackendStop = await waitForChunks(restartPage, 1);
  const restartMeetingDir = path.join(meetingsRoot, beforeBackendStop.session.meetingDirName);
  const firstServerChunk = path.join(restartMeetingDir, "audio_chunks", "chunk_000000.part");
  const uploadDeadline = Date.now() + 10000;
  let firstServerHash;
  do {
    if (fs.existsSync(firstServerChunk)) firstServerHash = createHash("sha256").update(fs.readFileSync(firstServerChunk)).digest("hex");
    if (firstServerHash === beforeBackendStop.chunks[0].sha256) break;
    await delay(50);
  } while (Date.now() < uploadDeadline);
  assert.equal(firstServerHash, beforeBackendStop.chunks[0].sha256, "Le premier fragment doit être entièrement reçu avant la panne.");
  const exited = new Promise((resolve) => backend.once("exit", (code, signal) => resolve({ code, signal })));
  backend.kill("SIGKILL");
  assert.equal((await exited).signal, "SIGKILL");
  await restartPage.locator(".markerGrid button").filter({ hasText: "Action" }).click();
  await waitForChunks(restartPage, 3);
  await restartPage.getByRole("button", { name: "Arrêter la réunion" }).click();
  await restartPage.getByText("Audio à récupérer :", { exact: false }).waitFor({ timeout: 20000 });
  const queuedAfterStop = await snapshotAudio(restartPage);
  assert.equal(queuedAfterStop.session.finalizedCapture, true);
  assert.equal(queuedAfterStop.markers.length, 1);
  assert.equal(fs.readdirSync(restartMeetingDir).some((name) => name.startsWith("audio_original.")), false);
  backend = launch(process.execPath, ["backend/server.js"], { HOME: home });
  await waitFor("http://127.0.0.1:8010/api/projects");
  await restartPage.getByRole("button", { name: "Reprendre la sauvegarde audio" }).click();
  await restartPage.getByText("Blocs audio récupérés et finalisés. Vérifiez l'écoute.", { exact: false }).waitFor({ timeout: 30000 });
  const restartOriginals = fs.readdirSync(restartMeetingDir).filter((name) => name.startsWith("audio_original."));
  assert.equal(restartOriginals.length, 1);
  const restartOriginal = path.join(restartMeetingDir, restartOriginals[0]);
  assert.equal(createHash("sha256").update(fs.readFileSync(restartOriginal)).digest("hex"), queuedAfterStop.joinedSha256);
  assert.equal(createHash("sha256").update(fs.readFileSync(firstServerChunk)).digest("hex"), firstServerHash);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(restartMeetingDir, "donnees_escale.json"), "utf8")).markers, queuedAfterStop.markers);
  assert.equal(await snapshotAudio(restartPage), null);
  const restartDecode = spawnSync("ffmpeg", ["-v", "error", "-i", restartOriginal, "-f", "null", "-"], { encoding: "utf8" });
  assert.equal(restartDecode.status, 0, restartDecode.stderr);
  assert.equal(restartDecode.stderr.trim(), "");
  console.log("RESULTAT_REDEMARRAGE_BACKEND_FIREFOX", JSON.stringify({
    signal: "SIGKILL", chunks: queuedAfterStop.chunks.length, markers: queuedAfterStop.markers.length,
    identicalBytes: true, existingChunkPreserved: true, finalized: true
  }));
  await restartContext.close();

  // Un vrai arrêt du processus, sans stop MediaRecorder ni fermeture du contexte.
  // Le profil persistant est fictif et distinct du profil personnel de Firefox.
  const profile = path.join(home, "profil firefox fictif");
  const launchPersistent = () => firefox.launchPersistentContext(profile, {
    headless: true,
    firefoxUserPrefs: { "media.navigator.streams.fake": true, "media.navigator.permission.disabled": true }
  });
  crashContext = await launchPersistent();
  let crashPage = await crashContext.newPage();
  await crashPage.goto("http://127.0.0.1:5173/");
  await crashPage.locator(".side-nav button").filter({ hasText: "Escales" }).click();
  await crashPage.route("**/api/meetings/audio-chunk", (route) => route.abort("failed"));
  await crashPage.route("**/api/meetings/save-markers", (route) => route.abort("failed"));
  await crashPage.getByLabel("Île / projet").selectOption(slug);
  await crashPage.getByLabel("Titre de l’escale").fill("Escale fictive interruption processus");
  await crashPage.getByRole("button", { name: "Démarrer l’enregistrement" }).click();
  await crashPage.getByRole("button", { name: "Arrêter la réunion" }).waitFor({ timeout: 10000 });
  await crashPage.locator(".markerGrid button").filter({ hasText: "Décision" }).click();
  let before;
  const deadline = Date.now() + 30000;
  do {
    before = await snapshotAudio(crashPage);
    if (before?.chunks.length >= 3) break;
    await delay(250);
  } while (Date.now() < deadline);
  assert.ok(before?.chunks.length >= 3, "Trois transactions de fragments doivent être confirmées avant SIGKILL.");
  assert.equal(before.session.finalizedCapture, false);
  assert.equal(before.markers.length, 1);
  const closed = crashContext.waitForEvent("close", { timeout: 15000 });
  const killedPid = killOwnedFirefox(profile);
  await closed;
  crashContext = null;
  // La fermeture du transport Playwright peut précéder la collecte du PID.
  let processGone = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { process.kill(killedPid, 0); }
    catch (error) {
      if (error.code !== "ESRCH") throw error;
      processGone = true;
      break;
    }
    await delay(50);
  }
  assert.equal(processGone, true, "Le PID Firefox doit avoir disparu avant sa relance.");
  crashContext = await launchPersistent();
  crashPage = await crashContext.newPage();
  await crashPage.goto("http://127.0.0.1:5173/");
  await crashPage.locator(".side-nav button").filter({ hasText: "Escales" }).click();
  await crashPage.getByRole("button", { name: "Exporter les fragments audio (secours)" }).waitFor({ timeout: 15000 });
  const after = await snapshotAudio(crashPage);
  assert.equal(after.session.sessionId, before.session.sessionId);
  assert.equal(after.session.finalizedCapture, false);
  assert.deepEqual(after.chunks, before.chunks, "Chaque fragment validé doit survivre avec ses octets et son indice.");
  assert.deepEqual(after.markers, before.markers);
  await crashPage.getByRole("button", { name: "Reprendre la sauvegarde audio" }).click();
  await crashPage.getByText("La récupération partielle nécessite une validation spécifique.", { exact: false }).waitFor();
  const downloadReady = crashPage.waitForEvent("download");
  await crashPage.getByRole("button", { name: "Exporter les fragments audio (secours)" }).click();
  const download = await downloadReady;
  const recoveredFile = path.join(home, "audio secours fictif.bin");
  await download.saveAs(recoveredFile);
  assert.equal(createHash("sha256").update(fs.readFileSync(recoveredFile)).digest("hex"), before.joinedSha256);
  const decoded = spawnSync("ffmpeg", ["-v", "error", "-i", recoveredFile, "-f", "null", "-"], { encoding: "utf8" });
  assert.equal(decoded.status, 0, decoded.stderr);
  const interruptedDir = path.join(meetingsRoot, before.session.meetingDirName);
  assert.equal(fs.readdirSync(interruptedDir).some((name) => name.startsWith("audio_original.")), false,
    "Un export partiel ne doit pas être présenté comme un original finalisé.");
  assert.deepEqual((await snapshotAudio(crashPage)).chunks, before.chunks, "L'export conserve les fragments locaux.");
  console.log("RESULTAT_INTERRUPTION_PROCESSUS_FIREFOX", JSON.stringify({
    signal: "SIGKILL", persisted: before.chunks.length, recovered: after.chunks.length,
    identicalBytes: true, markers: after.markers.length, emergencyAudioDecoded: true, finalized: false
  }));
} finally {
  if (crashContext) await crashContext.close();
  if (browser) await browser.close();
  for (const child of children) child.kill("SIGTERM");
  await delay(300);
  fs.rmSync(home, { recursive: true, force: true });
}
