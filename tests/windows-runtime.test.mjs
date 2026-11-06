import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { localPythonPath } from "../backend/lib/runtime-paths.js";

test("Windows natif : Python dans un chemin avec espaces et services locaux avec secrets privés", {
  skip: process.platform !== "win32", timeout: 120_000
}, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "Vogue Windows fictif "));
  const children = [];
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  let logs = "";
  try {
    const venvRoot = path.join(home, "Projet avec espaces");
    fs.mkdirSync(venvRoot);
    const venv = spawnSync("python", ["-m", "venv", path.join(venvRoot, ".venv-transcription")], {
      env, encoding: "utf8", timeout: 45_000
    });
    assert.equal(venv.status, 0, venv.stderr);
    const interpreter = localPythonPath(venvRoot);
    assert.equal(spawnSync(interpreter, ["-c", "import sys; assert sys.platform == 'win32'"], { env }).status, 0);
    for (const script of ["backend/server.js", "backend/transcription-server-v6.js"]) {
      const child = spawn(process.execPath, [script], { env, stdio: ["ignore", "pipe", "pipe"] });
      child.stdout.on("data", (data) => { logs += String(data); });
      child.stderr.on("data", (data) => { logs += String(data); });
      children.push(child);
    }
    const api = "http://127.0.0.1:8010";
    let ready = false;
    for (let attempt = 0; attempt < 160; attempt++) {
      if (children.some((child) => child.exitCode !== null)) break;
      try {
        const response = await fetch(api + "/api/transcription/health", { signal: AbortSignal.timeout(500) });
        if (response.ok) { ready = true; break; }
      } catch { /* démarrage et protection ACL en cours */ }
      await delay(150);
    }
    assert.ok(ready, logs);
    const direct = await fetch("http://127.0.0.1:8011/api/transcription/health");
    assert.equal(direct.status, 403);
    const create = await fetch(api + "/api/projects", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Île Windows fictive", description: "Recette synthétique" }) });
    assert.equal(create.status, 201, await create.text());
    assert.ok(fs.existsSync(path.join(home, "VOGUE-MERRY-DONNEES", "01_PROJETS", "ile_windows_fictive")));
    const token = path.join(home, ".config", "vogue-merry", "internal_api_token");
    assert.ok(fs.existsSync(token));
    // Contrôler les SID autorisés sans afficher leurs valeurs ni le secret.
    const audit = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `
$ErrorActionPreference = 'Stop'
$acl = Get-Acl -LiteralPath $env:VOGUE_TEST_TOKEN_PATH
$allowed = @([System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value, 'S-1-5-18')
$rules = $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])
if (-not $acl.AreAccessRulesProtected) { exit 2 }
foreach ($rule in $rules) {
  if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin $allowed) { exit 3 }
}
`], { env: { ...env, VOGUE_TEST_TOKEN_PATH: token }, encoding: "utf8" });
    assert.equal(audit.status, 0, "Le secret interne doit avoir une ACL privée.");
  } finally {
    for (const child of children) {
      if (child.exitCode === null) spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    }
    await Promise.all(children.map((child) => child.exitCode !== null ? Promise.resolve() :
      Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(3000)])));
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
  }
});
