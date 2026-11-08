import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { localPythonPath } from "../backend/lib/runtime-paths.js";
import { loadInternalToken, INTERNAL_TOKEN_HEADER } from "../backend/lib/local-access.js";

test("santé runtime : venv vide refusé, sonde partagée et API réactive pendant l'import", { timeout: 60000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vogue sante fictive "));
  let child;
  try {
    fs.mkdirSync(path.join(root, "backend"));
    fs.cpSync("backend/lib", path.join(root, "backend/lib"), { recursive: true });
    for (const file of ["transcription-server-v6.js", "local_transcribe.py", "local_diarize.py"]) fs.copyFileSync(path.join("backend", file), path.join(root, "backend", file));
    fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
    fs.symlinkSync(path.resolve("node_modules"), path.join(root, "node_modules"), process.platform === "win32" ? "junction" : "dir");
    const created = spawnSync(process.platform === "win32" ? "python" : "python3", ["-m", "venv", "--without-pip", path.join(root, ".venv-transcription")], { encoding: "utf8", timeout: 15000 });
    assert.equal(created.status, 0, created.stderr);
    const python = localPythonPath(root);
    const site = spawnSync(python, ["-c", "import sysconfig; print(sysconfig.get_paths()['purelib'])"], { encoding: "utf8", timeout: 5000 });
    assert.equal(site.status, 0, site.stderr);
    fs.writeFileSync(path.join(site.stdout.trim(), "sitecustomize.py"),
      'import os,time\nwith open(os.environ["VOGUE_TEST_PROBE_MARKER"],"a") as handle: handle.write("sonde fictive\\n")\ntime.sleep(2)\n');
    const marker = path.join(root, "sondes-fictives.txt");
    const token = loadInternalToken(path.join(root, ".config", "vogue-merry"));
    const reservation = http.createServer();
    await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
    const port = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    child = spawn(process.execPath, [path.join(root, "backend/transcription-server-v6.js")], {
      env: { ...process.env, HOME: root, USERPROFILE: root, HF_TOKEN: "", OPENAI_API_KEY: "",
        VOGUE_TRANSCRIPTION_PORT: String(port), VOGUE_TEST_PROBE_MARKER: marker }, stdio: ["ignore", "pipe", "ignore"]
    });
    let output = "";
    child.stdout.on("data", (data) => { output += String(data); });
    const request = (route, timeout = 10000) => fetch(`http://127.0.0.1:${port}/api/transcription/${route}`, {
      headers: { [INTERNAL_TOKEN_HEADER]: token }, signal: AbortSignal.timeout(timeout)
    });
    let ready = false;
    for (let attempt = 0; attempt < 150; attempt++) {
      if (child.exitCode !== null || child.signalCode) throw new Error("Moteur de recette arrêté.");
      if (output.includes(`http://127.0.0.1:${port}`)) {
        try { if ((await request("escales", 500)).ok) { ready = true; break; } } catch { /* démarrage */ }
      }
      await delay(100);
    }
    assert.ok(ready);
    const responses = Promise.allSettled([request("health"), request("health")]);
    const deadline = Date.now() + 5000;
    while (!fs.existsSync(marker) && Date.now() < deadline) await delay(25);
    assert.ok(fs.existsSync(marker), "L'import ralenti doit avoir réellement démarré.");
    assert.equal((await request("escales", 1000)).status, 200, "Une sonde lente ne doit pas bloquer les autres API.");
    const collected = await responses;
    for (const response of collected) assert.equal(response.status, "fulfilled", String(response.reason));
    const reports = await Promise.all(collected.map((response) => response.value.json()));
    for (const report of reports) {
      assert.equal(report.localEngineReady, false, "Le venv et le script présents ne prouvent pas les imports.");
      assert.equal(report.pythonDependencies.state, "checked");
      assert.equal(report.pythonDependencies.fasterWhisper, false);
      assert.equal(report.pyannoteInstalled, false);
      assert.equal(report.highPrecisionReady, false);
      assert.equal(report.modelsTested, false);
      assert.equal(report.microphoneTested, false);
      assert.equal(report.modelAccessVerified, false);
    }
    assert.equal((await request("health")).status, 200);
    assert.equal(fs.readFileSync(marker, "utf8").trim().split(/\r?\n/u).length, 1, "Les trois requêtes doivent utiliser une seule sonde Python.");
  } finally {
    if (child && child.exitCode === null && !child.signalCode) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGKILL");
      await exited;
    }
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
