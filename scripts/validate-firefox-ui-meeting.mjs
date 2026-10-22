// Test Firefox de la vraie interface Vogue Mary, sur données fictives et HOME jetable.
// Il ne s'appuie pas sur la voix ou les fichiers de l'utilisateur.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { firefox } from "playwright";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "vogue-e2e-ui-"));
const children = [];
let browser;
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
  launch(process.execPath, ["backend/server.js"], { HOME: home });
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

  console.log("RESULTAT_INTERFACE_FIREFOX", JSON.stringify({
    escales: folders.length, audio: originals[0], markers: meta.markers.length, title
  }));
} finally {
  if (browser) await browser.close();
  for (const child of children) child.kill("SIGTERM");
  await delay(300);
  fs.rmSync(home, { recursive: true, force: true });
}
