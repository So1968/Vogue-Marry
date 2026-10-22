import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const API = "http://127.0.0.1:8010";

async function call(endpoint, method = "GET", body) {
  const response = await fetch(API + endpoint, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(3000)
  });
  return { status: response.status, payload: await response.json() };
}

test("parcours réel API locale sur une île fictive isolée : créer, reprendre, retrouver, refuser action non validée", { timeout: 25000 }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vogue-api-test-"));
  const child = spawn(process.execPath, ["backend/server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, HOME: home },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (data) => { output += String(data); });
  child.stderr.on("data", (data) => { output += String(data); });
  try {
    let ready = false;
    for (let i = 0; i < 75; i += 1) {
      if (child.exitCode !== null) throw new Error("Serveur interrompu : " + output);
      try {
        const reply = await call("/api/projects");
        if (reply.status === 200) { ready = true; break; }
      } catch { /* démarrage en cours */ }
      await delay(100);
    }
    assert.ok(ready, "Serveur local non disponible : " + output);

    const foreignRead = await fetch(API + "/api/projects", {
      headers: { Origin: "https://site-externe.example" }
    });
    assert.equal(foreignRead.status, 403, "Une page externe ne doit pas lire les projets locaux.");
    const foreignMetadataRead = await fetch(API + "/api/projects", {
      headers: { "Sec-Fetch-Site": "cross-site" }
    });
    assert.equal(foreignMetadataRead.status, 403, "Une lecture intersites signalée doit être refusée.");
    const allowedRead = await fetch(API + "/api/projects", {
      headers: { Origin: "http://127.0.0.1:5173" }
    });
    assert.equal(allowedRead.status, 200, "Le frontend local autorisé doit conserver son accès.");

    const empty = await call("/api/projects");
    assert.deepEqual(empty.payload.projects, [], "Le test ne doit utiliser aucune donnée existante.");

    const created = await call("/api/projects", "POST", { name: "Île de démonstration", description: "Projet fictif pour essai automatique" });
    assert.equal(created.status, 201, JSON.stringify(created.payload));
    const slug = created.payload.project.slug;
    assert.equal(typeof slug, "string");

    const listing = await call("/api/projects");
    assert.equal(listing.payload.projects.length, 1);
    assert.equal(listing.payload.projects[0].slug, slug);

    const remembered = await call("/api/log-pose/save", "POST", {
      projectSlug: slug,
      whatToRemember: "Décision fictive : reprendre le devis",
      openQuestions: ["Quel budget ?"],
      documentsToFind: ["Devis exemple"],
      nextDirection: "Préparer la prochaine étape fictive"
    });
    assert.equal(remembered.status, 200, JSON.stringify(remembered.payload));

    const resumed = await call("/api/log-pose?projectSlug=" + encodeURIComponent(slug));
    assert.equal(resumed.status, 200);
    assert.match(JSON.stringify(resumed.payload.logPose), /Préparer la prochaine étape fictive/u);

    const actions = await call("/api/knowledge/action?projectSlug=" + encodeURIComponent(slug));
    assert.equal(actions.status, 200);
    assert.deepEqual(actions.payload.items, []);

    const invalidUpdate = await call("/api/knowledge/action/update-status", "POST", { projectSlug: slug, itemId: "inconnu", statut: "Terminé" });
    assert.equal(invalidUpdate.status, 400, "Ne pas changer le statut d'une action non validée.");
    assert.ok(fs.existsSync(path.join(home, "VOGUE-MERRY-DONNEES", "01_PROJETS", slug)), "Données isolées de démonstration attendues.");
  } finally {
    child.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(2000)]);
    fs.rmSync(home, { recursive: true, force: true });
  }
});
