import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const PORT = 18012;
const API = `http://127.0.0.1:${PORT}`;

test("transcription : récupérer uniquement l'audio original d'une escale connue", { timeout: 25000 }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vogue-original-escale-"));
  const root = path.join(home, "VOGUE-MERRY-DONNEES", "01_PROJETS", "ile_fictive", "01_escales_reunions");
  const meeting = path.join(root, "reunion_test");
  fs.mkdirSync(meeting, { recursive: true });
  fs.writeFileSync(path.join(meeting, "donnees_escale.json"), JSON.stringify({
    title: "Escale fictive", meetingDate: "2026-10-22",
    participants: "Intervenant 1, Intervenant 2"
  }));
  const source = "CONTENU_FICTIF_SANS_DONNEES_PERSONNELLES";
  fs.writeFileSync(path.join(meeting, "audio_original.webm"), source);
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
    for (let i = 0; i < 90; i++) {
      if (child.exitCode !== null) break;
      try {
        const response = await fetch(API + "/api/transcription/health", { signal: AbortSignal.timeout(500) });
        if (response.ok) { ready = true; break; }
      } catch { /* démarrage */ }
      await delay(100);
    }
    assert.ok(ready, logs);
    const list = await (await fetch(API + "/api/transcription/escales")).json();
    assert.equal(list.escales[0].audioFileName, "audio_original.webm");

    const file = await fetch(API + "/api/transcription/escales/ile_fictive/reunion_test/audio");
    assert.equal(file.status, 200);
    assert.equal(await file.text(), source);
    assert.equal(file.headers.get("cache-control"), "no-store");

    const absent = await fetch(API + "/api/transcription/escales/ile_fictive/reunion_absente/audio");
    assert.equal(absent.status, 404);

    fs.renameSync(path.join(meeting, "audio_original.webm"), path.join(meeting, "audio_original.webm.bak"));
    const noAudio = await fetch(API + "/api/transcription/escales/ile_fictive/reunion_test/audio");
    assert.equal(noAudio.status, 409);
    assert.ok(fs.existsSync(path.join(meeting, "audio_original.webm.bak")), "Jamais de modification des originaux.");
  } finally {
    child.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(2000)]);
    fs.rmSync(home, { recursive: true, force: true });
  }
});
