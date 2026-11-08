import { loadInternalToken, INTERNAL_TOKEN_HEADER } from "../backend/lib/local-access.js";
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let engineToken;
// Les tests du moteur jouent le rôle de la façade avec un secret synthétique local.
function fetch(url, options = {}) {
  const headers = new Headers(options.headers);
  if (new URL(url).port !== "8010") headers.set(INTERNAL_TOKEN_HEADER, engineToken);
  return globalThis.fetch(url, { ...options, headers });
}

const ROOT = process.cwd();

function makeHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vogue-marry-test-"));
}

async function waitFor(url, attempts = 40) {
  let lastError;
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError || new Error(`Service indisponible : ${url}`);
}

async function withServer(script, port, callback, healthPath = port === 8010 ? "health" : "transcription/health") {
  const home = makeHome();
  engineToken = loadInternalToken(path.join(home, ".config", "vogue-merry"));
  const child = spawn(process.execPath, [script], {
    cwd: ROOT,
    env: { ...process.env, HOME: home, USERPROFILE: home },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stderr = "";
  let stdout = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

  try {
    // Ne jamais lancer une recette contre un service préexistant sur ce port.
    for (let attempt = 0; attempt < 150 && !stdout.includes(`http://127.0.0.1:${port}`); attempt++) {
      if (child.exitCode !== null || child.signalCode) throw new Error("Le serveur de recette s'est arrêté.");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(stdout.includes(`http://127.0.0.1:${port}`), "Le processus de recette doit confirmer son propre démarrage.");
    await waitFor(`http://127.0.0.1:${port}/api/${port === 8010 ? healthPath : "transcription/escales"}`);
    await callback(home);
  } catch (error) {
    if (stderr.trim()) error.message += `\nServeur : ${stderr.trim()}`;
    throw error;
  } finally {
    if (child.exitCode === null && !child.signalCode) {
      await new Promise((resolve) => {
        const forced = setTimeout(() => child.kill("SIGKILL"), 2000);
        child.once("exit", () => { clearTimeout(forced); resolve(); });
        child.kill("SIGTERM");
      });
    }
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

async function withUnifiedServer(callback) {
  const home = makeHome();
  engineToken = loadInternalToken(path.join(home, ".config", "vogue-merry"));
  const env = { ...process.env, HOME: home, VOGUE_TRANSCRIPTION_PORT: "8011" };
  const children = [
    spawn(process.execPath, ["backend/transcription-server-v6.js"], {
      cwd: ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"]
    }),
    spawn(process.execPath, ["backend/server.js"], {
      cwd: ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"]
    })
  ];

  const stderr = new Map();
  children.forEach((child, index) => {
    stderr.set(index, "");
    child.stderr.on("data", (chunk) => stderr.set(index, `${stderr.get(index)}${chunk.toString()}`));
  });

  try {
    await waitFor("http://127.0.0.1:8010/api/transcription/escales");
    await callback(home);
  } catch (error) {
    const details = Array.from(stderr.values()).filter(Boolean).join("\n");
    if (details) error.message += `\nServeurs : ${details}`;
    throw error;
  } finally {
    children.forEach((child) => child.kill("SIGTERM"));
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test("API mémoire : santé locale, CORS local et refus des chemins dangereux", async () => {
  await withServer("backend/server.js", 8010, async () => {
    const health = await fetch("http://127.0.0.1:8010/api/health", {
      headers: { Origin: "http://localhost:5173" }
    });
    assert.equal(health.status, 200);
    assert.equal(health.headers.get("access-control-allow-origin"), "http://localhost:5173");
    const payload = await health.json();
    assert.equal(payload.host, "127.0.0.1");

    const rejectedOrigin = await fetch("http://127.0.0.1:8010/api/health", {
      headers: { Origin: "https://example.invalid" }
    });
    assert.notEqual(rejectedOrigin.status, 200);

    const traversal = await fetch("http://127.0.0.1:8010/api/meetings/read-report", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:5173"
      },
      body: JSON.stringify({ projectSlug: "..", meetingDirName: ".." })
    });
    assert.equal(traversal.status, 400);
  });
});

test("les API locales refusent un Host étranger", async () => {
  for (const [script, port, healthPath] of [
    ["backend/server.js", 8010, "health"],
    ["backend/transcription-server-v6.js", 8011, "transcription/health"]
  ]) {
    await withServer(script, port, async () => {
      const url = `http://127.0.0.1:${port}/api/${healthPath}`;
      const requestWithHost = (host) => new Promise((resolve, reject) => {
        const request = http.get(url, { headers: { host, [INTERNAL_TOKEN_HEADER]: engineToken } }, (response) => {
          response.resume();
          response.on("end", () => resolve(response.statusCode));
        });
        request.on("error", reject);
      });
      assert.equal(await requestWithHost("site-externe.example"), 403);
      assert.equal(await requestWithHost(`localhost:${port}`), 200);
    }, healthPath);
  }
});

test("les deux API bloquent les modifications intersites", async () => {
  for (const [script, port, healthPath] of [
    ["backend/server.js", 8010, "health"],
    ["backend/transcription-server-v6.js", 8011, "transcription/health"]
  ]) {
    await withServer(script, port, async () => {
      const url = `http://127.0.0.1:${port}/api/verification-origine`;
      const externalOrigin = await fetch(url, {
        method: "POST",
        headers: { Origin: "https://site-externe.example" }
      });
      assert.equal(externalOrigin.status, 403);
      const crossSite = await fetch(url, {
        method: "POST",
        headers: { "Sec-Fetch-Site": "cross-site" }
      });
      assert.equal(crossSite.status, 403);
      const localOrigin = await fetch(url, {
        method: "POST",
        headers: { Origin: "http://localhost:5173" }
      });
      assert.equal(localOrigin.status, 404);
    }, healthPath);
  }
});

test("API Longue-vue : refuse les liens symboliques vers des fichiers extérieurs", async () => {
  await withServer("backend/server.js", 8010, async (home) => {
    const projects = path.join(home, "VOGUE-MERRY-DONNEES", "01_PROJETS");
    const island = path.join(projects, "ile_test");
    fs.mkdirSync(island, { recursive: true });
    const outside = path.join(home, "confidentiel.txt");
    fs.writeFileSync(outside, "SECRET_LIEN_EXTERIEUR", "utf8");
    fs.symlinkSync(outside, path.join(island, "raccourci.txt"));
    const linkedDir = path.join(home, "documents_exterieurs");
    fs.mkdirSync(linkedDir);
    fs.writeFileSync(path.join(linkedDir, "memo.md"), "SECRET_DOSSIER_EXTERIEUR", "utf8");
    fs.symlinkSync(linkedDir, path.join(island, "raccourci_dossier"), "dir");

    const base = "http://127.0.0.1:8010";
    const search = await fetch(`${base}/api/search?q=SECRET_LIEN_EXTERIEUR`);
    assert.equal(search.status, 200);
    assert.equal((await search.json()).count, 0);
    const folderSearch = await fetch(`${base}/api/search?q=SECRET_DOSSIER_EXTERIEUR`);
    assert.equal(folderSearch.status, 200);
    assert.equal((await folderSearch.json()).count, 0);

    const filePath = encodeURIComponent("ile_test/raccourci.txt");
    const read = await fetch(`${base}/api/search/read?relativePath=${filePath}`);
    assert.equal(read.status, 400);
    const folderPath = encodeURIComponent("ile_test/raccourci_dossier/memo.md");
    const folderRead = await fetch(`${base}/api/search/read?relativePath=${folderPath}`);
    assert.equal(folderRead.status, 400);
  });
});

test("API Longue-vue : rejette les traversées Unicode et conserve les noms valides", async () => {
  await withServer("backend/server.js", 8010, async (home) => {
    const root = path.join(home, "VOGUE-MERRY-DONNEES", "01_PROJETS");
    const island = path.join(root, "île_valide");
    fs.mkdirSync(island, { recursive: true });
    fs.writeFileSync(path.join(island, "café.md"), "# Texte fictif", "utf8");

    const base = "http://127.0.0.1:8010/api/search/read?relativePath=";
    const good = await fetch(base + encodeURIComponent("île_valide/café.md"));
    assert.equal(good.status, 200);
    assert.match((await good.json()).content, /Texte fictif/u);

    for (const dangerous of [
      "île_valide/\uFF0E\uFF0E/café.md",
      "île_valide/\uFF0E\uFF0E\uFF0Fcafé.md",
      "île_valide/\u202Esecret.md",
      "île_valide/\u2066secret.md",
      "île_valide/\u0001secret.md"
    ]) {
      const response = await fetch(base + encodeURIComponent(dangerous));
      assert.equal(response.status, 400, JSON.stringify(dangerous));
    }
  });
});

test("API mémoire : crée une escale, rattache un audio et la retrouve", async () => {
  await withServer("backend/server.js", 8010, async () => {
    const requestOptions = {
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:5173"
      }
    };
    const projectResponse = await fetch("http://127.0.0.1:8010/api/projects", {
      method: "POST",
      ...requestOptions,
      body: JSON.stringify({ name: "Projet démo", description: "Reprendre le cadrage sans perdre le contexte." })
    });
    assert.equal(projectResponse.status, 201);
    const projectPayload = await projectResponse.json();
    assert.equal(projectPayload.project.slug, "projet_demo");
    assert.equal("path" in projectPayload.project, false);

    const projectsResponse = await fetch("http://127.0.0.1:8010/api/projects", {
      headers: { Origin: "http://localhost:5173" }
    });
    const projectsPayload = await projectsResponse.json();
    assert.deepEqual(projectsPayload.projects[0], {
      slug: "projet_demo",
      name: "Projet démo",
      description: "Reprendre le cadrage sans perdre le contexte.",
      createdAt: projectsPayload.projects[0].createdAt
    });

    const meetingResponse = await fetch("http://127.0.0.1:8010/api/meetings/export", {
      method: "POST",
      ...requestOptions,
      body: JSON.stringify({
        projectName: "Projet démo",
        meetingDate: "2026-09-19",
        meetingType: "réunion",
        title: "Réunion test",
        participants: "Sofia, Pierre",
        context: "Test de rattachement",
        rawNotes: "décision à confirmer"
      })
    });
    assert.equal(meetingResponse.status, 201);
    const meetingPayload = await meetingResponse.json();
    assert.match(meetingPayload.meetingDirName, /^2026-09-19_reunion_reunion_test$/u);
    assert.equal("meetingDir" in meetingPayload, false);

    const audioForm = new FormData();
    audioForm.append("projectName", "Projet démo");
    audioForm.append("meetingDirName", meetingPayload.meetingDirName);
    audioForm.append("audio", new Blob(["audio-test"], { type: "audio/webm" }), "reunion.webm");
    const audioResponse = await fetch("http://127.0.0.1:8010/api/meetings/export-audio", {
      method: "POST",
      headers: { Origin: "http://localhost:5173" },
      body: audioForm
    });
    assert.equal(audioResponse.status, 201);

    const inboxResponse = await fetch("http://127.0.0.1:8010/api/inbox", {
      headers: { Origin: "http://localhost:5173" }
    });
    assert.equal(inboxResponse.status, 200);
    const inbox = await inboxResponse.json();
    assert.equal(inbox.items.length, 1);
    assert.equal(inbox.items[0].status, "Journal de bord à valider");
    assert.equal(inbox.items[0].hasAudio, true);
    assert.equal("path" in inbox.items[0], false);

    const reportResponse = await fetch("http://127.0.0.1:8010/api/meetings/read-report", {
      method: "POST",
      ...requestOptions,
      body: JSON.stringify({ projectSlug: "projet_demo", meetingDirName: meetingPayload.meetingDirName })
    });
    assert.equal(reportResponse.status, 200);
    const report = await reportResponse.json();
    assert.match(report.content, /Réunion test/u);

    const searchResponse = await fetch("http://127.0.0.1:8010/api/search?q=décision", {
      headers: { Origin: "http://localhost:5173" }
    });
    assert.equal(searchResponse.status, 200);
    const search = await searchResponse.json();
    assert.ok(search.count >= 1);
    assert.equal("filePath" in search.results[0], false);

    const sourceResponse = await fetch("http://127.0.0.1:8010/api/search/read?projectSlug=projet_demo&relativePath=projet_demo%2F01_escales_reunions%2F2026-09-19_reunion_reunion_test%2Fjournal_de_bord_exporte.md", {
      headers: { Origin: "http://localhost:5173" }
    });
    assert.equal(sourceResponse.status, 200);
    assert.match((await sourceResponse.json()).content, /Réunion test/u);

    const invalidSourceResponse = await fetch("http://127.0.0.1:8010/api/search/read?projectSlug=projet_demo&relativePath=projet_autre%2Fnotes.md", {
      headers: { Origin: "http://localhost:5173" }
    });
    assert.equal(invalidSourceResponse.status, 400);

    const validateResponse = await fetch("http://127.0.0.1:8010/api/meetings/validate", {
      method: "POST",
      ...requestOptions,
      body: JSON.stringify({ projectSlug: "projet_demo", meetingDirName: meetingPayload.meetingDirName })
    });
    assert.equal(validateResponse.status, 201);

    const secondValidateResponse = await fetch("http://127.0.0.1:8010/api/meetings/validate", {
      method: "POST",
      ...requestOptions,
      body: JSON.stringify({ projectSlug: "projet_demo", meetingDirName: meetingPayload.meetingDirName })
    });
    assert.equal(secondValidateResponse.status, 200);
    assert.equal((await secondValidateResponse.json()).status, "already-validated");

    const editValidatedResponse = await fetch("http://127.0.0.1:8010/api/meetings/save-report", {
      method: "POST",
      ...requestOptions,
      body: JSON.stringify({
        projectSlug: "projet_demo",
        meetingDirName: meetingPayload.meetingDirName,
        content: "Modification interdite après validation"
      })
    });
    assert.equal(editValidatedResponse.status, 400);

    const invalidSearchResponse = await fetch("http://127.0.0.1:8010/api/search?q=décision&projectSlug=inconnu", {
      headers: { Origin: "http://localhost:5173" }
    });
    assert.equal(invalidSearchResponse.status, 400);
  });
});

test("API mémoire : deux escales identiques restent deux traces distinctes", async () => {
  await withServer("backend/server.js", 8010, async () => {
    const requestOptions = {
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:5173"
      }
    };
    const projectResponse = await fetch("http://127.0.0.1:8010/api/projects", {
      method: "POST",
      ...requestOptions,
      body: JSON.stringify({ name: "Projet doublon" })
    });
    assert.equal(projectResponse.status, 201);

    const meetingData = {
      projectName: "Projet doublon",
      meetingDate: "2026-09-19",
      meetingType: "réunion",
      title: "Point hebdomadaire"
    };
    const firstResponse = await fetch("http://127.0.0.1:8010/api/meetings/export", {
      method: "POST",
      ...requestOptions,
      body: JSON.stringify(meetingData)
    });
    const secondResponse = await fetch("http://127.0.0.1:8010/api/meetings/export", {
      method: "POST",
      ...requestOptions,
      body: JSON.stringify(meetingData)
    });
    assert.equal(firstResponse.status, 201);
    assert.equal(secondResponse.status, 201);
    const first = await firstResponse.json();
    const second = await secondResponse.json();
    assert.equal(first.meetingDirName, "2026-09-19_reunion_point_hebdomadaire");
    assert.equal(second.meetingDirName, "2026-09-19_reunion_point_hebdomadaire_2");

    const inboxResponse = await fetch("http://127.0.0.1:8010/api/inbox", {
      headers: { Origin: "http://localhost:5173" }
    });
    const inbox = await inboxResponse.json();
    assert.equal(inbox.items.length, 2);
  });
});

test("API Coffre : propose puis valide le classement d’un document local", async () => {
  await withServer("backend/server.js", 8010, async (home) => {
    const requestOptions = {
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:5173"
      }
    };
    const projectResponse = await fetch("http://127.0.0.1:8010/api/projects", {
      method: "POST",
      ...requestOptions,
      body: JSON.stringify({ name: "Projet coffre" })
    });
    assert.equal(projectResponse.status, 201);

    const form = new FormData();
    form.append("document", new Blob(["Décision validée à conserver"], { type: "text/plain" }), "decision.txt");
    const depositResponse = await fetch("http://127.0.0.1:8010/api/water-seven/deposit", {
      method: "POST",
      headers: { Origin: "http://localhost:5173" },
      body: form
    });
    assert.equal(depositResponse.status, 201);
    const depositPayload = await depositResponse.json();

    const pendingResponse = await fetch("http://127.0.0.1:8010/api/documents", {
      headers: { Origin: "http://localhost:5173" }
    });
    assert.equal(pendingResponse.status, 200);
    const pendingPayload = await pendingResponse.json();
    assert.equal(pendingPayload.pendingCount, 1);
    assert.equal(pendingPayload.documents[0].source, "Water Seven");
    assert.equal(pendingPayload.documents[0].reviewStatus, "à valider");
    assert.equal("filePath" in pendingPayload.documents[0], false);
    assert.equal(path.isAbsolute(pendingPayload.documents[0].relativePath), false);

    const validateResponse = await fetch("http://127.0.0.1:8010/api/documents/validate", {
      method: "POST",
      ...requestOptions,
      body: JSON.stringify({ sourceId: depositPayload.deposit.id, projectSlug: "projet_coffre" })
    });
    assert.equal(validateResponse.status, 201);
    const validatedPayload = await validateResponse.json();
    assert.equal(validatedPayload.document.projectSlug, "projet_coffre");
    assert.equal(validatedPayload.document.source, "Coffre");

    const targetPath = path.join(
      home,
      "VOGUE-MERRY-DONNEES",
      "01_PROJETS",
      "projet_coffre",
      "08_coffre_documents_sources",
      "decision.txt"
    );
    assert.equal(fs.existsSync(targetPath), true);

    const storedResponse = await fetch("http://127.0.0.1:8010/api/documents?projectSlug=projet_coffre", {
      headers: { Origin: "http://localhost:5173" }
    });
    const storedPayload = await storedResponse.json();
    assert.equal(storedPayload.pendingCount, 0);
    assert.equal(storedPayload.documents[0].reviewStatus, "classé");
    assert.equal(storedPayload.documents[0].relativePath, "01_PROJETS/projet_coffre/08_coffre_documents_sources/decision.txt");
  });
});

test("API Coffre : deux dépôts immédiats ne s'écrasent pas", async () => {
  await withServer("backend/server.js", 8010, async (home) => {
    const deposit = async (contents) => {
      const form = new FormData();
      form.append("document", new Blob([contents], { type: "text/plain" }), "note.txt");
      const response = await fetch("http://127.0.0.1:8010/api/water-seven/deposit", {
        method: "POST",
        headers: { Origin: "http://localhost:5173" },
        body: form
      });
      assert.equal(response.status, 201);
      return (await response.json()).deposit;
    };
    const [first, second] = await Promise.all([deposit("premier document"), deposit("deuxième document")]);
    assert.notEqual(first.id, second.id);
    const root = path.join(home, "VOGUE-MERRY-DONNEES", "00_WATER_SEVEN_PORT_ENTREE");
    assert.equal(fs.readFileSync(path.join(root, first.id, "note.txt"), "utf8"), "premier document");
    assert.equal(fs.readFileSync(path.join(root, second.id, "note.txt"), "utf8"), "deuxième document");
    const response = await fetch("http://127.0.0.1:8010/api/documents");
    assert.equal(response.status, 200);
    assert.equal((await response.json()).pendingCount, 2);
  });
});

test("API Coffre : les noms réservés ne détruisent pas les fichiers déposés", async () => {
  await withServer("backend/server.js", 8010, async (home) => {
    for (const name of ["fil_origine.json", "classement_valide.json"]) {
      const payloadText = `DOCUMENT_UTILISATEUR_${name}`;
      const form = new FormData();
      form.append("document", new Blob([payloadText], { type: "application/json" }), name);
      const response = await fetch("http://127.0.0.1:8010/api/water-seven/deposit", {
        method: "POST",
        headers: { Origin: "http://localhost:5173" },
        body: form
      });
      assert.equal(response.status, 201);
      const payload = (await response.json()).deposit;
      const folder = path.join(home, "VOGUE-MERRY-DONNEES", "00_WATER_SEVEN_PORT_ENTREE", payload.id);
      assert.equal(fs.readFileSync(path.join(folder, `document_${name}`), "utf8"), payloadText);
      assert.equal(JSON.parse(fs.readFileSync(path.join(folder, "fil_origine.json"), "utf8")).id, payload.id);
    }
    const listing = await fetch("http://127.0.0.1:8010/api/documents");
    assert.equal(listing.status, 200);
    assert.equal((await listing.json()).pendingCount, 2);
  });
});

test("API mémoire : extrait puis valide actions et décisions des journaux", async () => {
  await withServer("backend/server.js", 8010, async (home) => {
    const requestOptions = {
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:5173"
      }
    };
    const projectResponse = await fetch("http://127.0.0.1:8010/api/projects", {
      method: "POST",
      ...requestOptions,
      body: JSON.stringify({ name: "Projet connaissance" })
    });
    assert.equal(projectResponse.status, 201);

    const meetingResponse = await fetch("http://127.0.0.1:8010/api/meetings/export", {
      method: "POST",
      ...requestOptions,
      body: JSON.stringify({
        projectName: "Projet connaissance",
        meetingDate: "2026-09-19",
        meetingType: "réunion",
        title: "Décisions et actions",
        decisions: "| Date | Cap validé / décision | Statut | Source | Impact |\n|---|---|---|---|---|\n| 2026-09-19 | Utiliser la mémoire locale | Acté | Réunion | Moins de doublons |",
        screens: "Pouvoir retrouver les besoins validés par projet.",
        actions: "- Préparer la courte transcription locale\n- Vérifier le classement du Coffre",
        rawNotes: JSON.stringify([{ type: "need", label: "Besoin utilisateur", timeLabel: "00:30" }])
      })
    });
    assert.equal(meetingResponse.status, 201);
    const meetingPayload = await meetingResponse.json();

    const beforeValidation = await fetch("http://127.0.0.1:8010/api/knowledge/action?projectSlug=projet_connaissance", {
      headers: { Origin: "http://localhost:5173" }
    });
    assert.equal(beforeValidation.status, 200);
    assert.equal((await beforeValidation.json()).count, 0);

    const journalValidation = await fetch("http://127.0.0.1:8010/api/meetings/validate", {
      method: "POST",
      ...requestOptions,
      body: JSON.stringify({ projectSlug: "projet_connaissance", meetingDirName: meetingPayload.meetingDirName })
    });
    assert.equal(journalValidation.status, 201);

    const actionsResponse = await fetch("http://127.0.0.1:8010/api/knowledge/action?projectSlug=projet_connaissance", {
      headers: { Origin: "http://localhost:5173" }
    });
    const actionsPayload = await actionsResponse.json();
    assert.equal(actionsPayload.pendingCount, 2);
    assert.equal(actionsPayload.items[0].reviewStatus, "à valider");
    assert.equal(actionsPayload.items[0].projectSlug, "projet_connaissance");

    const decisionsResponse = await fetch("http://127.0.0.1:8010/api/knowledge/decision?projectSlug=projet_connaissance", {
      headers: { Origin: "http://localhost:5173" }
    });
    const decisionsPayload = await decisionsResponse.json();
    assert.equal(decisionsPayload.pendingCount, 1);
    assert.equal(decisionsPayload.items[0].decision, "Utiliser la mémoire locale");

    const needsResponse = await fetch("http://127.0.0.1:8010/api/knowledge/need?projectSlug=projet_connaissance", {
      headers: { Origin: "http://localhost:5173" }
    });
    const needsPayload = await needsResponse.json();
    assert.equal(needsPayload.pendingCount, 2);
    assert.equal(needsPayload.items[0].need, "Pouvoir retrouver les besoins validés par projet.");
    assert.equal(needsPayload.items[1].origin, "marqueur");

    const actionToValidate = actionsPayload.items.find((item) => item.action === "Préparer la courte transcription locale");
    const actionValidation = await fetch("http://127.0.0.1:8010/api/knowledge/action/validate", {
      method: "POST",
      ...requestOptions,
      body: JSON.stringify({
        itemId: actionToValidate.id,
        projectSlug: "projet_connaissance",
        item: {
          action: actionToValidate.action,
          responsable: "Sofia",
          echeance: "2026-09-20",
          statut: "À faire"
        }
      })
    });
    assert.equal(actionValidation.status, 201);

    const decisionToValidate = decisionsPayload.items[0];
    const decisionValidation = await fetch("http://127.0.0.1:8010/api/knowledge/decision/validate", {
      method: "POST",
      ...requestOptions,
      body: JSON.stringify({
        itemId: decisionToValidate.id,
        projectSlug: "projet_connaissance",
        item: {
          decision: decisionToValidate.decision,
          date: decisionToValidate.date,
          statut: "Validé",
          impact: decisionToValidate.impact
        }
      })
    });
    assert.equal(decisionValidation.status, 201);

    const needToValidate = needsPayload.items[0];
    const needValidation = await fetch("http://127.0.0.1:8010/api/knowledge/need/validate", {
      method: "POST",
      ...requestOptions,
      body: JSON.stringify({
        itemId: needToValidate.id,
        projectSlug: "projet_connaissance",
        item: {
          need: needToValidate.need,
          context: "Besoin formulé pour éviter les recherches manuelles.",
          priority: "Haute",
          statut: "À cadrer"
        }
      })
    });
    assert.equal(needValidation.status, 201);

    const needLogPoseResponse = await fetch("http://127.0.0.1:8010/api/log-pose?projectSlug=projet_connaissance", {
      headers: { Origin: "http://localhost:5173" }
    });
    const needLogPosePayload = await needLogPoseResponse.json();
    assert.equal(needLogPosePayload.logPose.pendingReview.needs, 1);
    assert.equal(needLogPosePayload.logPose.priorityNeeds[0].need, "Pouvoir retrouver les besoins validés par projet.");

    const storedActions = JSON.parse(fs.readFileSync(path.join(
      home,
      "VOGUE-MERRY-DONNEES",
      "01_PROJETS",
      "projet_connaissance",
      "03_manoeuvres_actions",
      "manoeuvres_actions.json"
    ), "utf8"));
    const storedDecisions = JSON.parse(fs.readFileSync(path.join(
      home,
      "VOGUE-MERRY-DONNEES",
      "01_PROJETS",
      "projet_connaissance",
      "02_caps_valides_decisions",
      "caps_valides.json"
    ), "utf8"));
    assert.equal(storedActions[0].responsable, "Sofia");
    assert.equal(storedDecisions[0].statut, "Validé");

    const logPoseResponse = await fetch("http://127.0.0.1:8010/api/log-pose?projectSlug=projet_connaissance", {
      headers: { Origin: "http://localhost:5173" }
    });
    assert.equal(logPoseResponse.status, 200);
    const logPosePayload = await logPoseResponse.json();
    assert.equal(logPosePayload.logPose.lastDecision.decision, "Utiliser la mémoire locale");
    assert.equal(logPosePayload.logPose.priorityActions[0].responsable, "Sofia");
    assert.equal(logPosePayload.logPose.pendingReview.total, 2);

    const globalLogPoseResponse = await fetch("http://127.0.0.1:8010/api/log-pose", {
      headers: { Origin: "http://localhost:5173" }
    });
    assert.equal(globalLogPoseResponse.status, 200);
    const globalLogPosePayload = await globalLogPoseResponse.json();
    assert.equal(globalLogPosePayload.logPose.scope, "global");
    assert.equal(globalLogPosePayload.logPose.lastDecision.projectName, "Projet connaissance");

    const saveLogPoseResponse = await fetch("http://127.0.0.1:8010/api/log-pose/save", {
      method: "POST",
      ...requestOptions,
      body: JSON.stringify({
        projectSlug: "projet_connaissance",
        whatToRemember: "La mémoire locale est la source de vérité.",
        openQuestions: ["Tester la transcription sur le poste réel"],
        documentsToFind: ["Compte rendu de référence"],
        nextDirection: "Tester une courte transcription locale."
      })
    });
    assert.equal(saveLogPoseResponse.status, 200);

    const savedLogPose = JSON.parse(fs.readFileSync(path.join(
      home,
      "VOGUE-MERRY-DONNEES",
      "01_PROJETS",
      "projet_connaissance",
      "10_log_pose",
      "log_pose.json"
    ), "utf8"));
    const savedLogPoseMarkdown = fs.readFileSync(path.join(
      home,
      "VOGUE-MERRY-DONNEES",
      "01_PROJETS",
      "projet_connaissance",
      "10_log_pose",
      "log_pose.md"
    ), "utf8");
    assert.equal(savedLogPose.manual.nextDirection, "Tester une courte transcription locale.");
    assert.match(savedLogPoseMarkdown, /La mémoire locale est la source de vérité/u);
    assert.match(savedLogPoseMarkdown, /Tester une courte transcription locale/u);
  });
});

test("API unifiée : expose la transcription locale sur 8010", async () => {
  await withUnifiedServer(async () => {
    const response = await fetch("http://127.0.0.1:8010/api/transcription/health", {
      headers: { Origin: "http://127.0.0.1:5173" }
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), "http://127.0.0.1:5173");
    const payload = await response.json();
    assert.equal(payload.host, "127.0.0.1");
    assert.equal(payload.version, 6);
    assert.equal(payload.paidSpeakerDiarization, false);
  });
});

test("API unifiée : confirme que les interlocuteurs passent par 8010", async () => {
  await withUnifiedServer(async () => {
    const response = await fetch("http://127.0.0.1:8010/api/transcription/job-inexistant/speakers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:5173"
      },
      body: JSON.stringify({ mapping: { SPEAKER_00: "Test" } })
    });
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:5173");
  });
});

test("API unifiée : confirme et persiste une correspondance", async () => {
  await withUnifiedServer(async (home) => {
    const meetingId = "projet-demo/2026-09-19_escale_reunion";
    const meetingDir = path.join(
      home,
      "VOGUE-MERRY-DONNEES",
      "01_PROJETS",
      "projet-demo",
      "01_escales_reunions",
      "2026-09-19_escale_reunion"
    );
    const jobDir = path.join(home, "VOGUE-MERRY-DONNEES", "99_TRANSCRIPTION_TESTS", "job-fixture");
    fs.mkdirSync(meetingDir, { recursive: true });
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(meetingDir, "donnees_escale.json"), JSON.stringify({
      projectName: "Projet démo",
      rawNotes: "Notes prises pendant la réunion"
    }));
    fs.writeFileSync(path.join(meetingDir, "journal_de_bord_exporte.md"), "# Journal de bord — Réunion de démonstration\n\nNotes initiales.\n", "utf8");
    fs.writeFileSync(path.join(jobDir, "status.json"), JSON.stringify({
      jobId: "job-fixture",
      state: "done",
      meetingId
    }));
    fs.writeFileSync(path.join(jobDir, "transcription.json"), JSON.stringify({
      jobId: "job-fixture",
      originalName: "reunion.wav",
      meeting: { id: meetingId, title: "Réunion de démonstration" },
      participants: ["Sofia", "Pierre"],
      segments: [
        {
          sourceSpeaker: "SPEAKER_00",
          speaker: "Intervenant 1",
          speakerConfidence: "non-identifie",
          start: 0,
          text: "Bonjour."
        },
        {
          sourceSpeaker: "SPEAKER_01",
          speaker: "Intervenant 2",
          speakerConfidence: "non-identifie",
          start: 2,
          text: "Bonjour."
        }
      ],
      unresolvedSpeakers: ["Intervenant 1", "Intervenant 2"]
    }));

    const response = await fetch("http://127.0.0.1:8010/api/transcription/job-fixture/speakers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:5173"
      },
      body: JSON.stringify({
        mapping: {
          SPEAKER_00: "Sofia",
          SPEAKER_01: "Nom qui ne fait pas partie des participants"
        }
      })
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:5173");
    const payload = await response.json();
    assert.equal(payload.persistedToMeeting, true);
    assert.deepEqual(payload.mapping, { SPEAKER_00: "Sofia" });
    assert.equal(payload.result.segments[0].speaker, "Sofia");
    assert.equal(payload.result.segments[0].speakerConfidence, "confirme-manuel");
    assert.deepEqual(payload.result.unresolvedSpeakers, ["Intervenant 2"]);

    const meetingData = JSON.parse(fs.readFileSync(path.join(meetingDir, "donnees_escale.json"), "utf8"));
    assert.deepEqual(meetingData.transcriptionSpeakerConfirmations["job-fixture"].mapping, { SPEAKER_00: "Sofia" });
    assert.equal(meetingData.transcription.status, "terminee");
    assert.equal(fs.existsSync(path.join(meetingDir, "transcription_v6.json")), true);
    assert.match(fs.readFileSync(path.join(meetingDir, "journal_de_bord_exporte.md"), "utf8"), /Transcription automatique V6/u);

    const inboxResponse = await fetch("http://127.0.0.1:8010/api/inbox", {
      headers: { Origin: "http://localhost:5173" }
    });
    assert.equal(inboxResponse.status, 200);
    const inbox = await inboxResponse.json();
    const meeting = inbox.items.find((item) => item.meetingDirName === "2026-09-19_escale_reunion");
    assert.equal(meeting.hasTranscription, true);
    assert.equal(meeting.status, "Transcription à relire");
  });
});

test("8011 refuse les appels directs et 8010 conserve le secret côté serveur", async () => {
  await withUnifiedServer(async (home) => {
    const tokenPath = path.join(home, ".config", "vogue-merry", "internal_api_token");
    assert.equal(fs.statSync(tokenPath).mode & 0o777, 0o600);
    for (const route of ["health", "escales", "config", "job_fictif"]) {
      for (const headers of [{}, { [INTERNAL_TOKEN_HEADER]: "faux-secret" }]) {
        const denied = await globalThis.fetch(`http://127.0.0.1:8011/api/transcription/${route}`, { headers });
        assert.equal(denied.status, 403);
        assert.deepEqual(await denied.json(), { error: "Accès réservé à la façade locale." });
      }
    }
    const directWrite = await globalThis.fetch("http://127.0.0.1:8011/api/transcription/config/hf-token", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "JETON_FICTIF_NE_PAS_ENREGISTRER" })
    });
    assert.equal(directWrite.status, 403);
    assert.equal(fs.existsSync(path.join(home, ".config", "vogue-merry", "huggingface_token")), false);
    const gateway = await fetch("http://127.0.0.1:8010/api/transcription/health", {
      headers: { [INTERNAL_TOKEN_HEADER]: "tentative-de-substitution" }
    });
    assert.equal(gateway.status, 200);
    assert.equal(gateway.headers.get(INTERNAL_TOKEN_HEADER), null);
    assert.ok(!(await gateway.text()).includes(engineToken));
  });
});

test("lectures navigateur : refuse les autres ports locaux et préserve les médias de l'interface", async () => {
  for (const [script, port, healthPath] of [
    ["backend/server.js", 8010, "health"],
    ["backend/transcription-server-v6.js", 8011, "transcription/health"]
  ]) {
    await withServer(script, port, async () => {
      const url = `http://127.0.0.1:${port}/api/${healthPath}`;
      for (const headers of [
        { "Sec-Fetch-Site": "same-site" },
        { "Sec-Fetch-Site": "none" },
        { "Sec-Fetch-Site": "same-site", Referer: "http://localhost:9999/page" },
        { "Sec-Fetch-Site": "cross-site", Referer: "http://localhost:5173/" },
        { Origin: "null" }
      ]) assert.equal((await fetch(url, { headers })).status, 403, JSON.stringify(headers));
      for (const origin of ["http://localhost:5173", "http://127.0.0.1:5173"]) {
        const media = await fetch(url, {
          headers: { "Sec-Fetch-Site": "same-site", "Sec-Fetch-Dest": "audio", Referer: `${origin}/` }
        });
        assert.equal(media.status, 200);
        assert.equal(media.headers.get("cache-control"), "no-store");
        assert.equal(media.headers.get("x-content-type-options"), "nosniff");
      }
    }, healthPath);
  }
});

test("transcription : corrections historisées, origine conservée et répétition idempotente", async () => {
  await withUnifiedServer(async (home) => {
    const root = path.join(home, "VOGUE-MERRY-DONNEES");
    const dir = path.join(root, "99_TRANSCRIPTION_TESTS", "job-historique-fictif");
    const meetingDir = path.join(root, "01_PROJETS", "ile_fictive", "01_escales_reunions", "escale_fictive");
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(meetingDir, { recursive: true });
    const original = JSON.stringify({ jobId: "job-historique-fictif", participants: ["Voix fictive A", "Voix fictive B"],
      meeting: { id: "ile_fictive/escale_fictive" },
      segments: [{ sourceSpeaker: "SPEAKER_00", speaker: "Intervenant 1", speakerConfidence: "non-identifie", text: "Texte synthétique." }],
      unresolvedSpeakers: ["Intervenant 1"] });
    fs.writeFileSync(path.join(dir, "transcription.json"), original);
    fs.writeFileSync(path.join(dir, "transcription_locale_brute.json"), "ORIGINAL_TECHNIQUE_FICTIF");
    fs.writeFileSync(path.join(dir, "audio_original.webm"), "AUDIO_FICTIF");
    fs.writeFileSync(path.join(meetingDir, "donnees_escale.json"), "{}");
    fs.writeFileSync(path.join(meetingDir, "journal_de_bord_exporte.md"), "Correction humaine fictive avant confirmation.\n");
    fs.writeFileSync(path.join(meetingDir, "journal_de_bord_valide.md"), "JOURNAL_VALIDE_FICTIF");
    const confirm = async (mapping) => {
      const response = await fetch("http://127.0.0.1:8010/api/transcription/job-historique-fictif/speakers", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mapping })
      });
      return { status: response.status, data: await response.json() };
    };
    assert.equal((await confirm({ VOIX_INEXISTANTE: "Voix fictive A" })).status, 400);
    assert.equal(fs.existsSync(path.join(dir, "99_versions")), false);
    const first = await confirm({ SPEAKER_00: "Voix fictive A" });
    assert.equal(first.status, 200);
    assert.deepEqual(first.data.unresolvedSpeakers, []);
    assert.equal(fs.readFileSync(path.join(dir, "transcription_originale.json"), "utf8"), original);
    const versions = () => fs.readdirSync(path.join(dir, "99_versions"));
    assert.equal(versions().length, 1);
    const firstVersion = path.join(dir, "99_versions", versions()[0]);
    assert.equal(fs.readFileSync(path.join(firstVersion, "moteur", "transcription.json"), "utf8"), original);
    assert.equal(fs.readFileSync(path.join(firstVersion, "escale", "journal_de_bord_exporte.md"), "utf8"), "Correction humaine fictive avant confirmation.\n");
    const corrected = fs.readFileSync(path.join(dir, "transcription.json"), "utf8");
    assert.equal((await confirm({ SPEAKER_00: "Voix fictive A" })).data.persistedToMeeting, true);
    assert.equal(versions().length, 1);
    assert.equal(fs.readFileSync(path.join(dir, "transcription.json"), "utf8"), corrected);
    assert.equal((await confirm({ SPEAKER_00: "Voix fictive B" })).status, 200);
    assert.equal(versions().length, 2);
    assert.equal(fs.readFileSync(path.join(dir, "transcription_originale.json"), "utf8"), original);
    assert.equal(fs.readFileSync(path.join(dir, "transcription_locale_brute.json"), "utf8"), "ORIGINAL_TECHNIQUE_FICTIF");
    assert.equal(fs.readFileSync(path.join(dir, "audio_original.webm"), "utf8"), "AUDIO_FICTIF");
    assert.equal(fs.readFileSync(path.join(meetingDir, "journal_de_bord_valide.md"), "utf8"), "JOURNAL_VALIDE_FICTIF");
    // Une publication partielle ne doit pas être bloquée par l'idempotence des noms.
    const interrupted = JSON.parse(fs.readFileSync(path.join(dir, "transcription.json"), "utf8"));
    interrupted.persistedToMeeting = false;
    fs.writeFileSync(path.join(dir, "transcription.json"), JSON.stringify(interrupted));
    assert.equal((await confirm({ SPEAKER_00: "Voix fictive B" })).data.result.persistedToMeeting, true);
    assert.equal(versions().length, 3);
    // Si l'historique ne peut pas être copié, refuser avant toute correction.
    fs.unlinkSync(path.join(meetingDir, "journal_de_bord_exporte.md"));
    fs.symlinkSync(path.join(dir, "transcription_locale_brute.json"), path.join(meetingDir, "journal_de_bord_exporte.md"));
    const beforeFailure = fs.readFileSync(path.join(dir, "transcription.json"), "utf8");
    assert.equal((await confirm({ SPEAKER_00: "Voix fictive A" })).status, 500);
    assert.equal(fs.readFileSync(path.join(dir, "transcription.json"), "utf8"), beforeFailure);
    assert.equal(versions().length, 3);
  });
});

test("mémoire projet : escale → résultat synthétique → journal relu → validations → Log Pose", async () => {
  await withUnifiedServer(async (home) => {
    const api = async (route, body) => {
      const response = await fetch("http://127.0.0.1:8010" + route, body ? {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
      } : {});
      const payload = await response.json();
      assert.ok(response.ok, `${route}: ${response.status} ${JSON.stringify(payload)}`);
      return payload;
    };
    const projectName = "Île parcours mémoire fictif";
    const project = await api("/api/projects", { name: projectName });
    const projectSlug = project.project.slug;
    const meeting = await api("/api/meetings/export", { projectName, title: "Escale mémoire fictive", meetingDate: "2026-11-06",
      participants: "Voix fictive A", actions: "- Préparer la recette fictive", decisions: "- Garder les sources locales" });
    const meetingDirName = meeting.meetingDirName;
    const coordinates = { projectSlug, meetingDirName };
    const form = new FormData();
    form.append("projectName", projectName); form.append("meetingDirName", meetingDirName);
    form.append("audio", new Blob(["AUDIO_FICTIF_NON_DECODABLE"], { type: "audio/webm" }), "fictif.webm");
    assert.equal((await fetch("http://127.0.0.1:8010/api/meetings/export-audio", { method: "POST", body: form })).status, 201);
    // Résultat moteur injecté : cette recette n'exécute pas les modèles de reconnaissance.
    const dir = path.join(home, "VOGUE-MERRY-DONNEES", "99_TRANSCRIPTION_TESTS", "job-parcours-fictif");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "transcription.json"), JSON.stringify({ jobId: "job-parcours-fictif", participants: ["Voix fictive A"],
      meeting: { id: `${projectSlug}/${meetingDirName}` }, segments: [{ sourceSpeaker: "SPEAKER_00", speaker: "Intervenant 1",
        speakerConfidence: "non-identifie", text: "Conservons la source et préparons la recette.", start: 0 }] }));
    await api("/api/transcription/job-parcours-fictif/speakers", { mapping: { SPEAKER_00: "Voix fictive A" } });
    const report = await api("/api/meetings/read-report", coordinates);
    assert.match(report.content, /Voix fictive A/u);
    await api("/api/meetings/save-report", { ...coordinates, content: report.content + "\nNote humaine fictive relue.\n" });
    const actionsRoute = `/api/knowledge/action?projectSlug=${projectSlug}`;
    assert.equal((await api(actionsRoute)).items.length, 0, "Aucune proposition avant validation du journal.");
    await api("/api/meetings/validate", coordinates);
    assert.equal((await api("/api/meetings/validate", coordinates)).status, "already-validated");
    const actions = await api(actionsRoute);
    const decisions = await api(`/api/knowledge/decision?projectSlug=${projectSlug}`);
    assert.equal(actions.items.length, 1); assert.equal(decisions.items.length, 1);
    const logRoute = `/api/log-pose?projectSlug=${projectSlug}`;
    const pending = (await api(logRoute)).logPose;
    assert.equal(pending.priorityActions.length, 0); assert.equal(pending.lastDecision, null);
    assert.equal(pending.pendingReview.actions, 1); assert.equal(pending.pendingReview.decisions, 1);
    const action = await api("/api/knowledge/action/validate", { projectSlug, itemId: actions.items[0].id, item: { statut: "En cours" } });
    await api("/api/knowledge/decision/validate", { projectSlug, itemId: decisions.items[0].id });
    await api("/api/log-pose/save", { projectSlug, whatToRemember: "Repère humain fictif.", nextDirection: "Vérifier le parcours fictif." });
    const resumed = (await api(logRoute)).logPose;
    assert.equal(resumed.lastDecision.decision, "Garder les sources locales");
    assert.equal(resumed.priorityActions[0].id, action.item.id);
    assert.equal(resumed.pendingReview.total, 0);
    assert.equal(resumed.whatToRemember, "Repère humain fictif.");
    const projectDir = path.join(home, "VOGUE-MERRY-DONNEES", "01_PROJETS", projectSlug);
    const persisted = JSON.parse(fs.readFileSync(path.join(projectDir, "10_log_pose", "log_pose.json"), "utf8"));
    assert.equal(persisted.lastDecision.id, resumed.lastDecision.id);
    await api("/api/knowledge/action/update-status", { projectSlug, itemId: action.item.id, statut: "Terminé" });
    assert.equal((await api(logRoute)).logPose.priorityActions.length, 0);
    assert.equal((await api(logRoute)).logPose.whatToRemember, "Repère humain fictif.");
    assert.equal(fs.readFileSync(path.join(projectDir, "01_escales_reunions", meetingDirName, "audio_original.webm"), "utf8"), "AUDIO_FICTIF_NON_DECODABLE");
  });
});

test("mémoire après panne : revalider un journal répare le Log Pose sans modifier le journal", async () => {
  await withServer("backend/server.js", 8010, async (home) => {
    const call = async (route, body) => {
      const response = await fetch("http://127.0.0.1:8010" + route, body ? {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
      } : {});
      return { status: response.status, body: await response.json() };
    };
    const project = await call("/api/projects", { name: "Île fictive reprise journal" });
    assert.equal(project.status, 201);
    const projectSlug = project.body.project.slug;
    const meeting = await call("/api/meetings/export", { projectName: "Île fictive reprise journal", title: "Journal fictif relu", actions: "- Action fictive à confirmer" });
    const coordinates = { projectSlug, meetingDirName: meeting.body.meetingDirName };
    const report = await call("/api/meetings/read-report", coordinates);
    assert.equal((await call("/api/meetings/save-report", { ...coordinates, content: report.body.content + "\nNote humaine fictive conservée.\n" })).status, 200);
    assert.equal((await call("/api/log-pose/save", { projectSlug, whatToRemember: "Repère manuel fictif" })).status, 200);
    const projectDir = path.join(home, "VOGUE-MERRY-DONNEES", "01_PROJETS", projectSlug);
    const logMarkdown = path.join(projectDir, "10_log_pose", "log_pose.md");
    fs.renameSync(logMarkdown, logMarkdown + ".avant-panne-fictive");
    fs.mkdirSync(logMarkdown); // Refus d'écriture du document dérivé, pas de données réelles.
    assert.equal((await call("/api/meetings/validate", coordinates)).status, 400);
    const validated = path.join(projectDir, "01_escales_reunions", coordinates.meetingDirName, "journal_de_bord_valide.md");
    const original = fs.readFileSync(validated);
    assert.match(original.toString(), /Note humaine fictive conservée/u);
    fs.rmdirSync(logMarkdown);
    const retry = await call("/api/meetings/validate", coordinates);
    assert.equal(retry.status, 200);
    assert.equal(retry.body.status, "already-validated");
    assert.equal(fs.existsSync(logMarkdown), true, "Une relance doit réparer le document dérivé absent.");
    assert.deepEqual(fs.readFileSync(validated), original);
    const log = JSON.parse(fs.readFileSync(path.join(projectDir, "10_log_pose", "log_pose.json"), "utf8"));
    assert.equal(log.manual.whatToRemember, "Repère manuel fictif");
    assert.equal(log.pendingReview.actions, 1);
    assert.equal((await call("/api/meetings/save-report", { ...coordinates, content: "Ne pas remplacer un journal validé" })).status, 400);
    assert.deepEqual(fs.readFileSync(validated), original);
  });
});

test("mémoire après panne : revalider une action répare les dérivés sans doublon ni perte humaine", async () => {
  await withServer("backend/server.js", 8010, async (home) => {
    const call = async (route, body) => {
      const response = await fetch("http://127.0.0.1:8010" + route, body ? {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
      } : {});
      return { status: response.status, body: await response.json() };
    };
    const project = await call("/api/projects", { name: "Île fictive reprise action" });
    const projectSlug = project.body.project.slug;
    const meeting = await call("/api/meetings/export", { projectName: "Île fictive reprise action", title: "Escale fictive", actions: "- Action préexistante fictive\n- Action initiale fictive", decisions: "- Décision fictive locale" });
    assert.equal((await call("/api/meetings/validate", { projectSlug, meetingDirName: meeting.body.meetingDirName })).status, 201);
    const proposals = await call(`/api/knowledge/action?projectSlug=${projectSlug}`);
    assert.equal(proposals.body.items.length, 2);
    assert.equal((await call("/api/knowledge/action/validate", { projectSlug, itemId: proposals.body.items[0].id, item: { statut: "Terminé" } })).status, 201);
    const itemId = proposals.body.items[1].id;
    const projectDir = path.join(home, "VOGUE-MERRY-DONNEES", "01_PROJETS", projectSlug);
    const actionDir = path.join(projectDir, "03_manoeuvres_actions");
    const markdown = path.join(actionDir, "manoeuvres_actions.md");
    fs.renameSync(markdown, markdown + ".avant-panne-fictive");
    fs.mkdirSync(markdown);
    assert.equal((await call("/api/knowledge/action/validate", { projectSlug, itemId, item: { action: "Action corrigée par une personne fictive", statut: "En cours" } })).status, 400);
    const canonical = path.join(actionDir, "manoeuvres_actions.json");
    const accepted = fs.readFileSync(canonical);
    assert.equal(JSON.parse(accepted).length, 2);
    fs.rmdirSync(markdown);
    assert.equal((await call("/api/knowledge/action/validate", { projectSlug, itemId, item: { action: "NE PAS REMPLACER LA CORRECTION" } })).status, 200);
    assert.equal(fs.existsSync(markdown), true, "Une relance doit recréer le Markdown après publication JSON partielle.");
    assert.match(fs.readFileSync(markdown, "utf8"), /Action corrigée par une personne fictive/u);
    assert.deepEqual(fs.readFileSync(canonical), accepted, "La relance ne réécrit pas la validation humaine existante.");
    const log = JSON.parse(fs.readFileSync(path.join(projectDir, "10_log_pose", "log_pose.json"), "utf8"));
    assert.equal(log.priorityActions[0].id, itemId);
    assert.equal(log.priorityActions[0].action, "Action corrigée par une personne fictive");
    assert.equal((await call(`/api/knowledge/action?projectSlug=${projectSlug}`)).body.items.length, 2);
  });
});

test("API mémoire : refus des liens externes pour les journaux, fragments et Log Pose", async () => {
  await withServer("backend/server.js", 8010, async (home) => {
    const api = async (route, body) => {
      const response = await fetch("http://127.0.0.1:8010" + route, body ? {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
      } : {});
      return { status: response.status, text: await response.text() };
    };
    const outside = path.join(home, "hors-memoire-fictif");
    const outsideMeeting = path.join(outside, "01_escales_reunions", "escale_fictive");
    fs.mkdirSync(outsideMeeting, { recursive: true });
    const original = path.join(outsideMeeting, "journal_de_bord_exporte.md");
    fs.writeFileSync(original, "ORIGINAL_FICTIF_HORS_RACINE");
    const projects = path.join(home, "VOGUE-MERRY-DONNEES", "01_PROJETS");
    fs.mkdirSync(projects, { recursive: true });
    fs.symlinkSync(outside, path.join(projects, "ile_liee"), "dir");
    const linked = { projectSlug: "ile_liee", meetingDirName: "escale_fictive" };
    for (const route of ["read-report", "save-report", "validate"]) {
      const result = await api("/api/meetings/" + route, { ...linked, content: "NE_PAS_ECRIRE" });
      assert.equal(result.status, 400, route);
      assert.ok(!result.text.includes(outside));
      assert.ok(!result.text.includes("ORIGINAL_FICTIF_HORS_RACINE"));
    }
    assert.equal(fs.readFileSync(original, "utf8"), "ORIGINAL_FICTIF_HORS_RACINE");
    await api("/api/projects", { name: "Projet audit fictif" });
    const exported = await api("/api/meetings/export", { projectName: "Projet audit fictif", title: "Escale audit fictive" });
    assert.equal(exported.status, 201, exported.text);
    const data = JSON.parse(exported.text);
    const coordinates = { projectSlug: data.projectSlug, meetingDirName: data.meetingDirName };
    const meeting = path.join(projects, data.projectSlug, "01_escales_reunions", data.meetingDirName);
    fs.renameSync(path.join(meeting, "journal_de_bord_exporte.md"), path.join(meeting, "journal_original_fictif.md"));
    fs.symlinkSync(original, path.join(meeting, "journal_de_bord_exporte.md"));
    assert.equal((await api("/api/meetings/read-report", coordinates)).status, 400);
    assert.equal((await api("/api/meetings/save-report", { ...coordinates, content: "NE_PAS_ECRIRE" })).status, 400);
    assert.equal(fs.readFileSync(original, "utf8"), "ORIGINAL_FICTIF_HORS_RACINE");
    fs.symlinkSync(outside, path.join(meeting, "audio_chunks"), "dir");
    assert.equal((await api("/api/meetings/audio-chunks-status", {
      projectName: "Projet audit fictif", meetingDirName: data.meetingDirName
    })).status, 400);
    const logFile = path.join(projects, data.projectSlug, "10_log_pose", "log_pose.json");
    const outsideJson = path.join(outside, "log_pose_fictif.json");
    fs.writeFileSync(outsideJson, '{"whatToRemember":"DONNEE_FICTIVE_HORS_RACINE"}');
    fs.renameSync(logFile, logFile + ".original-fictif");
    fs.symlinkSync(outsideJson, logFile);
    const logRead = await api(`/api/log-pose?projectSlug=${data.projectSlug}`);
    assert.equal(logRead.status, 400);
    assert.ok(!logRead.text.includes("DONNEE_FICTIVE_HORS_RACINE"));
    assert.equal((await api("/api/log-pose/save", { projectSlug: data.projectSlug, whatToRemember: "NE_PAS_ECRIRE" })).status, 400);
    assert.equal(fs.readFileSync(outsideJson, "utf8"), '{"whatToRemember":"DONNEE_FICTIVE_HORS_RACINE"}');
  });
});

test("API transcription : refuse un job ou un résultat lié hors mémoire", async () => {
  await withUnifiedServer(async (home) => {
    const root = path.join(home, "VOGUE-MERRY-DONNEES", "99_TRANSCRIPTION_TESTS");
    const outside = path.join(home, "transcription-exterieure-fictive");
    fs.mkdirSync(outside);
    const result = path.join(outside, "transcription.json");
    fs.writeFileSync(result, '{"text":"TRANSCRIPTION_FICTIVE_HORS_RACINE"}');
    fs.writeFileSync(path.join(outside, "status.json"), '{"state":"done"}');
    fs.symlinkSync(outside, path.join(root, "job_lie_fictif"), "dir");
    const regular = path.join(root, "job_regulier_fictif"); fs.mkdirSync(regular);
    fs.symlinkSync(result, path.join(regular, "transcription.json"));
    for (const route of ["job_lie_fictif", "job_lie_fictif/result", "job_regulier_fictif/result"]) {
      const response = await fetch("http://127.0.0.1:8010/api/transcription/" + route);
      assert.equal(response.status, 400, route);
      const text = await response.text();
      assert.ok(!text.includes(outside));
      assert.ok(!text.includes("TRANSCRIPTION_FICTIVE_HORS_RACINE"));
    }
    const beforeFiles = fs.readdirSync(outside);
    fs.symlinkSync(outside, path.join(root, "_uploads"), "dir");
    const form = new FormData();
    form.append("audio", new Blob(["AUDIO_SYNTHETIQUE"], { type: "audio/webm" }), "fictif.webm");
    const upload = await fetch("http://127.0.0.1:8010/api/transcription", { method: "POST", body: form });
    assert.equal(upload.status, 400);
    assert.deepEqual(fs.readdirSync(outside), beforeFiles);
    assert.equal((await fetch("http://127.0.0.1:8010/api/transcription/escales")).status, 200, "Le refus ne doit pas arrêter le moteur.");
    assert.equal(fs.readFileSync(result, "utf8"), '{"text":"TRANSCRIPTION_FICTIVE_HORS_RACINE"}');
  });
});
