import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { loadInternalToken, INTERNAL_TOKEN_HEADER } from "../backend/lib/local-access.js";
import { runtimeJobStatus } from "../backend/lib/transcription-job-state.js";

test("tâches : une exécution réellement active conserve sa progression", () => {
  const active = new Set(["tache_fictive"]);
  for (const state of ["queued", "transcribing", "diarizing", "verifying"]) {
    const status = Object.freeze({ state, progress: 37 });
    assert.equal(runtimeJobStatus("tache_fictive", status, active), status);
    assert.equal(runtimeJobStatus("autre_tache", status, active).state, "error");
    assert.equal(status.state, state);
    assert.equal(status.progress, 37);
  }
});

test("tâches : un résultat terminé ou une erreur existante ne sont pas reclassés", () => {
  for (const state of ["done", "error"]) {
    const status = Object.freeze({ state, progress: 100, message: "État fictif conservé" });
    assert.equal(runtimeJobStatus("ancienne_tache", status, new Set()), status);
  }
  assert.equal(runtimeJobStatus("absente", null, new Set()), null);
});

test("transcription : redémarrage, relance des tâches interrompues et cache corrigé conservé", { timeout: 60000 }, async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vogue-restart-fictif-"));
  const root = path.join(home, "VOGUE-MERRY-DONNEES", "99_TRANSCRIPTION_TESTS");
  const token = loadInternalToken(path.join(home, ".config", "vogue-merry"));
  const reservation = http.createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const base = `http://127.0.0.1:${port}/api/transcription`;
  let child;
  const request = (suffix, options = {}) => globalThis.fetch(base + suffix, {
    ...options, headers: { ...options.headers, [INTERNAL_TOKEN_HEADER]: token }, signal: AbortSignal.timeout(5000)
  });
  async function start() {
    child = spawn(process.execPath, ["backend/transcription-server-v6.js"], {
      env: { ...process.env, HOME: home, USERPROFILE: home, VOGUE_TRANSCRIPTION_PORT: String(port) },
      stdio: ["ignore", "ignore", "ignore"]
    });
    for (let attempt = 0; attempt < 150; attempt++) {
      assert.equal(child.exitCode, null, "Le backend doit rester démarré.");
      try { if ((await request("/escales")).ok) return; } catch { /* démarrage */ }
      await delay(100);
    }
    throw new Error("Démarrage du backend de recette impossible.");
  }
  async function stop() {
    if (!child || child.exitCode !== null || child.signalCode) return;
    const exited = new Promise((resolve) => child.once("exit", (_code, signal) => resolve(signal)));
    child.kill("SIGKILL");
    assert.equal(await exited, "SIGKILL");
  }
  t.after(async () => { await stop(); fs.rmSync(home, { recursive: true, force: true }); });
  const audio = Buffer.from("AUDIO_FICTIF_INTERROMPU_SANS_DONNEES_PERSONNELLES");
  function signature(bytes) {
    const audioHash = createHash("sha256").update(bytes).digest("hex");
    return createHash("sha256").update(JSON.stringify({ audioHash, mode: "local", participants: [], context: "", meetingId: "" })).digest("hex");
  }
  function seed(jobId, state, bytes, result) {
    const dir = path.join(root, jobId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "audio_original.webm"), bytes);
    fs.writeFileSync(path.join(dir, "status.json"), JSON.stringify({ jobId, state, progress: 42, cacheKey: signature(bytes) }));
    if (result) fs.writeFileSync(path.join(dir, "transcription.json"), JSON.stringify(result));
    return dir;
  }
  const pending = seed("tache_fictive_interrompue", "transcribing", audio);
  const pendingStatus = fs.readFileSync(path.join(pending, "status.json"), "utf8");
  const completedAudio = Buffer.from("AUDIO_FICTIF_TERMINE_AVEC_CORRECTION");
  const correction = { jobId: "tache_fictive_corrigee", segments: [{ text: "Correction humaine fictive", speaker: "Intervenant fictif" }], speakerOverrides: { SPEAKER_00: "Intervenant fictif" } };
  const completed = seed("tache_fictive_corrigee", "done", completedAudio, correction);
  const correctedBytes = fs.readFileSync(path.join(completed, "transcription.json"));
  await start();
  await stop();
  await start();
  const interrupted = await (await request("/tache_fictive_interrompue")).json();
  assert.equal(interrupted.state, "error", "Une tâche sans exécution active ne doit plus rester en cours après redémarrage.");
  assert.equal(interrupted.interrupted, true);
  assert.equal(interrupted.resultReady, false);
  assert.equal(interrupted.progress, 0);
  for (const state of ["queued", "diarizing", "verifying"]) {
    seed("ancienne_" + state, state, audio);
    const status = await (await request("/ancienne_" + state)).json();
    assert.equal(status.state, "error");
    assert.equal(status.interrupted, true);
  }
  async function submit(bytes) {
    const form = new FormData();
    form.append("mode", "local");
    form.append("audio", new Blob([bytes], { type: "audio/webm" }), "audio_fictif.webm");
    const response = await request("", { method: "POST", body: form });
    return { status: response.status, body: await response.json() };
  }
  const retry = await submit(audio);
  assert.equal(retry.status, 202, "Relancer doit créer une tâche, pas réutiliser une exécution disparue.");
  assert.notEqual(retry.body.jobId, "tache_fictive_interrompue");
  assert.equal(retry.body.alreadyRunning, undefined);
  assert.deepEqual(fs.readFileSync(path.join(pending, "audio_original.webm")), audio);
  assert.equal(fs.readFileSync(path.join(pending, "status.json"), "utf8"), pendingStatus, "La lecture de récupération ne réécrit pas les preuves sur disque.");
  const cached = await submit(completedAudio);
  assert.equal(cached.status, 200);
  assert.equal(cached.body.status, "cached");
  assert.equal(cached.body.jobId, "tache_fictive_corrigee");
  assert.deepEqual(fs.readFileSync(path.join(completed, "transcription.json")), correctedBytes);
  assert.deepEqual(fs.readFileSync(path.join(completed, "audio_original.webm")), completedAudio);
});
