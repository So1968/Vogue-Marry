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
