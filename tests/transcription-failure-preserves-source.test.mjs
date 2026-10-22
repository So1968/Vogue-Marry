import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const PORT = 18011;
const BASE = `http://127.0.0.1:${PORT}`;

test("échec de transcription : audio original conservé et état d'erreur lisible", { timeout: 35000 }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vogue-transcription-echec-"));
  const child = spawn(process.execPath, ["backend/transcription-server-v6.js"], {
    cwd: process.cwd(),
    env: { ...process.env, HOME: home, VOGUE_TRANSCRIPTION_PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let logs = "";
  child.stdout.on("data", (buffer) => { logs += String(buffer); });
  child.stderr.on("data", (buffer) => { logs += String(buffer); });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 90; attempt += 1) {
      if (child.exitCode !== null) throw new Error("Moteur arrêté : " + logs);
      try {
        const response = await fetch(BASE + "/api/transcription/health", { signal: AbortSignal.timeout(500) });
        if (response.status === 200) { ready = true; break; }
      } catch { /* démarrage */ }
      await delay(100);
    }
    assert.ok(ready, "Le moteur local ne démarre pas : " + logs);

    const source = "AUDIO_FICTIF_NON_DECODABLE_VOGUE_MARY";
    const form = new FormData();
    form.append("mode", "local");
    form.append("audio", new Blob([source], { type: "audio/webm" }), "fictif.webm");
    const start = await fetch(BASE + "/api/transcription", {
      method: "POST", body: form, signal: AbortSignal.timeout(5000)
    });
    assert.equal(start.status, 202, await start.text().catch(() => ""));
    // Le résultat de la soumission est une tâche asynchrone ; retrouver son identifiant.
    const dataRoot = path.join(home, "VOGUE-MERRY-DONNEES", "99_TRANSCRIPTION_TESTS");
    let jobId = "";
    let state = null;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const dirs = fs.readdirSync(dataRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"));
      if (dirs.length) {
        jobId = dirs[0].name;
        const response = await fetch(BASE + "/api/transcription/" + encodeURIComponent(jobId), {
          signal: AbortSignal.timeout(1000)
        });
        if (response.ok) {
          state = await response.json();
          if (state.state === "error") break;
        }
      }
      await delay(100);
    }
    assert.equal(state?.state, "error", "Une donnée invalide doit provoquer un échec propre, pas un succès fictif.");
    assert.ok(jobId);
    const original = path.join(dataRoot, jobId, "audio_original.webm");
    assert.ok(fs.existsSync(original), "La source ne doit jamais disparaître après un échec de transcription.");
    assert.equal(fs.readFileSync(original, "utf8"), source);
    assert.equal(fs.existsSync(path.join(dataRoot, jobId, "transcription.json")), false);
  } finally {
    child.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(2000)]);
    fs.rmSync(home, { recursive: true, force: true });
  }
});
