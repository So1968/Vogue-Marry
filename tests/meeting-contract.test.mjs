import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const API = "http://127.0.0.1:8010";

async function json(route, data) {
  const response = await fetch(API + route, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(5000)
  });
  return { status: response.status, data: await response.json() };
}

test("contrat Réunion : export, audio, journal, validation et protection des écrits validés", { timeout: 30000 }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vogue-reunion-contrat-"));
  const child = spawn(process.execPath, ["backend/server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, HOME: home },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", (buffer) => { stderr += String(buffer); });

  try {
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (child.exitCode !== null) break;
      try {
        const response = await fetch(API + "/api/health", { signal: AbortSignal.timeout(500) });
        if (response.ok) { ready = true; break; }
      } catch { /* démarrage en cours */ }
      await delay(100);
    }
    assert.ok(ready, "Serveur indisponible : " + stderr);

    const project = await json("/api/projects", { name: "Île de contrat fictive", description: "Test sans données privées" });
    assert.equal(project.status, 201, JSON.stringify(project.data));
    const projectSlug = project.data.project.slug;

    const exported = await json("/api/meetings/export", {
      projectName: "Île de contrat fictive",
      meetingDate: "2026-10-21",
      meetingType: "réunion",
      title: "Test de non-régression",
      participants: "Intervenant fictif 1, Intervenant fictif 2",
      context: "Contexte de démonstration",
      decisions: "",
      rules: "",
      screens: "",
      openQuestions: "",
      actions: "",
      risks: "",
      keywords: "",
      rawNotes: "Marqueur fictif à 00:03"
    });
    assert.equal(exported.status, 201, JSON.stringify(exported.data));
    assert.equal(exported.data.projectSlug, projectSlug);
    const meetingDirName = exported.data.meetingDirName;
    assert.ok(meetingDirName);
    const meetingPath = path.join(home, "VOGUE-MERRY-DONNEES", "01_PROJETS", projectSlug, "01_escales_reunions", meetingDirName);
    assert.ok(fs.existsSync(path.join(meetingPath, "donnees_escale.json")));
    assert.ok(fs.existsSync(path.join(meetingPath, "journal_de_bord_exporte.md")));
    assert.match(fs.readFileSync(path.join(meetingPath, "journal_de_bord_exporte.md"), "utf8"), /Intervenant fictif 1/u);

    const invalidAudio = new FormData();
    invalidAudio.append("projectName", "Île de contrat fictive");
    invalidAudio.append("meetingDirName", "reunion_absente");
    invalidAudio.append("audio", new Blob(["audio fictif"], { type: "audio/webm" }), "reunion.webm");
    const absentResponse = await fetch(API + "/api/meetings/export-audio", { method: "POST", body: invalidAudio });
    assert.equal(absentResponse.status, 400, "Une escale inexistante ne doit pas recevoir d'audio.");

    const form = new FormData();
    form.append("projectName", "Île de contrat fictive");
    form.append("meetingDirName", meetingDirName);
    form.append("audio", new Blob(["contenu audio simulé"], { type: "audio/webm" }), "reunion.webm");
    const audioResponse = await fetch(API + "/api/meetings/export-audio", { method: "POST", body: form });
    assert.equal(audioResponse.status, 201);
    const audioData = await audioResponse.json();
    assert.equal(audioData.audioFileName, "audio_original.webm");
    assert.equal(fs.readFileSync(path.join(meetingPath, "audio_original.webm"), "utf8"), "contenu audio simulé");

    const duplicateForm = new FormData();
    duplicateForm.append("projectName", "Île de contrat fictive");
    duplicateForm.append("meetingDirName", meetingDirName);
    duplicateForm.append("audio", new Blob(["contenu audio simulé"], { type: "audio/webm" }), "reunion.webm");
    const duplicate = await fetch(API + "/api/meetings/export-audio", { method: "POST", body: duplicateForm });
    assert.equal(duplicate.status, 200, "Réessayer le même bloc audio doit être idempotent.");
    assert.equal((await duplicate.json()).status, "already-uploaded");

    const differentForm = new FormData();
    differentForm.append("projectName", "Île de contrat fictive");
    differentForm.append("meetingDirName", meetingDirName);
    differentForm.append("audio", new Blob(["contenu audio différent"], { type: "audio/webm" }), "reunion.webm");
    const conflict = await fetch(API + "/api/meetings/export-audio", { method: "POST", body: differentForm });
    assert.equal(conflict.status, 409, "Un autre audio ne doit pas écraser la source.");
    assert.equal(fs.readFileSync(path.join(meetingPath, "audio_original.webm"), "utf8"), "contenu audio simulé");

    // Tester la nouvelle API de blocs sur une seconde escale fictive.
    const chunkMeeting = await json("/api/meetings/export", {
      projectName: "Île de contrat fictive", title: "Test audio par blocs",
      meetingDate: "2026-10-21", meetingType: "réunion", participants: "Intervenant fictif"
    });
    assert.equal(chunkMeeting.status, 201);
    const chunkName = chunkMeeting.data.meetingDirName;
    async function sendChunk(index, content) {
      const payload = new FormData();
      payload.append("projectName", "Île de contrat fictive");
      payload.append("meetingDirName", chunkName);
      payload.append("index", String(index));
      payload.append("audio", new Blob([content], { type: "audio/webm" }), "chunk.webm");
      const response = await fetch(API + "/api/meetings/audio-chunk", { method: "POST", body: payload });
      return { status: response.status, data: await response.json() };
    }
    // Les index et chemins malformés ne doivent jamais produire de fichier.
    assert.equal((await sendChunk(-1, "bloc-invalide")).status, 400);
    assert.equal((await sendChunk(100001, "bloc-invalide")).status, 400);
    const forbidden = new FormData();
    forbidden.append("projectName", "Île de contrat fictive");
    forbidden.append("meetingDirName", "../autre_dossier");
    forbidden.append("index", "0");
    forbidden.append("audio", new Blob(["attaque fictive"]), "bloc.webm");
    const traversalResponse = await fetch(API + "/api/meetings/audio-chunk", {
      method: "POST", body: forbidden
    });
    assert.equal(traversalResponse.status, 400);
    const empty = new FormData();
    empty.append("projectName", "Île de contrat fictive");
    empty.append("meetingDirName", chunkName);
    empty.append("index", "0");
    empty.append("audio", new Blob([]), "bloc.webm");
    const emptyResponse = await fetch(API + "/api/meetings/audio-chunk", {
      method: "POST", body: empty
    });
    assert.equal(emptyResponse.status, 400);
    assert.equal((await json("/api/meetings/audio-chunks-finalize", {
      projectName: "Île de contrat fictive", meetingDirName: chunkName, count: 0
    })).status, 400);
    assert.equal((await sendChunk(0, "bloc-0")).status, 201);
    assert.equal((await sendChunk(0, "bloc-0")).data.status, "already-uploaded");
    assert.equal((await sendChunk(0, "bloc-different")).status, 409);
    assert.equal((await sendChunk(2, "bloc-2")).status, 201);
    const state = await json("/api/meetings/audio-chunks-status", {
      projectName: "Île de contrat fictive", meetingDirName: chunkName
    });
    assert.deepEqual(state.data.received, [0, 2]);
    const missing = await json("/api/meetings/audio-chunks-finalize", {
      projectName: "Île de contrat fictive", meetingDirName: chunkName, count: 3
    });
    assert.equal(missing.status, 409);
    assert.equal((await sendChunk(1, "bloc-1")).status, 201);
    assert.equal((await sendChunk(3, "bloc-3")).status, 201);
    const truncated = await json("/api/meetings/audio-chunks-finalize", {
      projectName: "Île de contrat fictive", meetingDirName: chunkName, count: 3
    });
    assert.equal(truncated.status, 409, "Le serveur refuse d'oublier un dernier bloc enregistré.");
    const final = await json("/api/meetings/audio-chunks-finalize", {
      projectName: "Île de contrat fictive", meetingDirName: chunkName, count: 4
    });
    assert.equal(final.status, 201, JSON.stringify(final.data));
    const chunkAudio = path.join(home, "VOGUE-MERRY-DONNEES", "01_PROJETS",
      projectSlug, "01_escales_reunions", chunkName, "audio_original.webm");
    assert.equal(fs.readFileSync(chunkAudio, "utf8"), "bloc-0bloc-1bloc-2bloc-3");
    const retryFinal = await json("/api/meetings/audio-chunks-finalize", {
      projectName: "Île de contrat fictive", meetingDirName: chunkName, count: 4
    });
    assert.equal(retryFinal.status, 200);
    assert.equal(retryFinal.data.status, "already-finalized");
    const secondFinal = await json("/api/meetings/audio-chunks-finalize", {
      projectName: "Île de contrat fictive", meetingDirName: chunkName, count: 3
    });
    assert.equal(secondFinal.status, 409);
    assert.equal(fs.readFileSync(chunkAudio, "utf8"), "bloc-0bloc-1bloc-2bloc-3");

    // Interruption simulée : blocs 0 et 2 arrivés, réseau repris plus tard.
    const resumedMeeting = await json("/api/meetings/export", {
      projectName: "Île de contrat fictive", title: "Reprise après interruption",
      meetingDate: "2026-10-22", meetingType: "réunion", participants: "Intervenant fictif"
    });
    assert.equal(resumedMeeting.status, 201);
    const resumedName = resumedMeeting.data.meetingDirName;
    async function resumeChunk(index, body) {
      const payload = new FormData();
      payload.append("projectName", "Île de contrat fictive");
      payload.append("meetingDirName", resumedName);
      payload.append("index", String(index));
      payload.append("audio", new Blob([body], { type: "audio/webm" }), "part.webm");
      const response = await fetch(API + "/api/meetings/audio-chunk", { method: "POST", body: payload });
      return { status: response.status, data: await response.json() };
    }
    assert.equal((await resumeChunk(0, "A")).status, 201);
    assert.equal((await resumeChunk(2, "C")).status, 201);
    const interruptedStatus = await json("/api/meetings/audio-chunks-status", {
      projectName: "Île de contrat fictive", meetingDirName: resumedName
    });
    assert.deepEqual(interruptedStatus.data.received, [0, 2]);
    const premature = await json("/api/meetings/audio-chunks-finalize", {
      projectName: "Île de contrat fictive", meetingDirName: resumedName, count: 3
    });
    assert.equal(premature.status, 409, "Aucune finalisation avec un bloc manquant.");
    const resumedAudio = path.join(home, "VOGUE-MERRY-DONNEES", "01_PROJETS",
      projectSlug, "01_escales_reunions", resumedName, "audio_original.webm");
    assert.equal(fs.existsSync(resumedAudio), false);
    assert.equal((await resumeChunk(0, "A")).data.status, "already-uploaded");
    assert.equal((await resumeChunk(1, "B")).status, 201);
    const completed = await json("/api/meetings/audio-chunks-finalize", {
      projectName: "Île de contrat fictive", meetingDirName: resumedName, count: 3
    });
    assert.equal(completed.status, 201);
    assert.equal(fs.readFileSync(resumedAudio, "utf8"), "ABC");
    assert.equal((await json("/api/meetings/audio-chunks-finalize", {
      projectName: "Île de contrat fictive", meetingDirName: resumedName, count: 3
    })).data.status, "already-finalized");

    const marker = { id: "repere-1", type: "decision", timeSeconds: 12, label: "Décision" };
    const markerSaved = await json("/api/meetings/save-markers", {
      projectSlug, meetingDirName, markers: [marker]
    });
    assert.equal(markerSaved.status, 200);
    const markerRepeated = await json("/api/meetings/save-markers", {
      projectSlug, meetingDirName, markers: [marker]
    });
    assert.equal(markerRepeated.data.count, 1, "Réessayer ne doit pas dupliquer un marqueur.");
    const persisted = JSON.parse(fs.readFileSync(path.join(meetingPath, "donnees_escale.json"), "utf8"));
    assert.equal(persisted.markers[0].id, "repere-1");
    assert.equal(persisted.rawNotes, "Marqueur fictif à 00:03", "Les notes originales doivent rester intactes.");
    const invalidMarker = await json("/api/meetings/save-markers", {
      projectSlug, meetingDirName, markers: [{ id: "bad", timeSeconds: -4, type: "action" }]
    });
    assert.equal(invalidMarker.status, 400);

    const initial = await json("/api/meetings/read-report", { projectSlug, meetingDirName });
    assert.equal(initial.status, 200);
    assert.equal(initial.data.reportType, "exporte");

    const draft = "# Journal de bord fictif\n\n## Caps validés / décisions prises\n\nDécision de test uniquement.";
    const saved = await json("/api/meetings/save-report", { projectSlug, meetingDirName, content: draft });
    assert.equal(saved.status, 200);
    const updated = await json("/api/meetings/read-report", { projectSlug, meetingDirName });
    assert.match(updated.data.content, /Décision de test uniquement/u);

    const validated = await json("/api/meetings/validate", { projectSlug, meetingDirName });
    assert.equal(validated.status, 201, JSON.stringify(validated.data));
    const repeated = await json("/api/meetings/validate", { projectSlug, meetingDirName });
    assert.equal(repeated.status, 200);
    assert.equal(repeated.data.status, "already-validated");

    const protectedChange = await json("/api/meetings/save-report", {
      projectSlug, meetingDirName, content: "Modification non autorisée"
    });
    assert.equal(protectedChange.status, 400);
    const finalReport = await json("/api/meetings/read-report", { projectSlug, meetingDirName });
    assert.equal(finalReport.data.reportType, "valide");
    assert.match(finalReport.data.content, /Décision de test uniquement/u);
    assert.doesNotMatch(finalReport.data.content, /Modification non autorisée/u);

    const inbox = await fetch(API + "/api/inbox");
    assert.equal(inbox.status, 200);
    const items = (await inbox.json()).items;
    const meeting = items.find((item) => item.meetingDirName === meetingDirName);
    assert.equal(meeting?.hasAudio, true);
    assert.equal(meeting?.hasValidatedReport, true);
    assert.equal(meeting?.status, "Validé");

    const versionDir = path.join(meetingPath, "99_versions");
    assert.ok(fs.readdirSync(versionDir).some((name) => name.includes("avant_sauvegarde")));
  } finally {
    child.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(2000)]);
    fs.rmSync(home, { recursive: true, force: true });
  }
});
