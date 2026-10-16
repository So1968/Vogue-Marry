import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeProjectCreator } from "../backend/lib/project-creator.js";
import { safePathInside } from "../backend/lib/path-guards.js";

test("création d'une île fictive, complète et sans écrasement des fichiers existants", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vogue-creator-"));
  const slugify = (value) => String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const ensureDir = (dir) => fs.mkdirSync(dir, { recursive: true });
  const writeFileIfMissing = (file, content) => { if (!fs.existsSync(file)) fs.writeFileSync(file, content, "utf8"); };
  let syncCount = 0;
  const readProjectRecord = (slug) => JSON.parse(fs.readFileSync(path.join(root, slug, "projet.json"), "utf8"));
  const create = makeProjectCreator({ projectsRoot: root, slugify, safePathInside, ensureDir, writeFileIfMissing, syncLogPose: () => { syncCount += 1; }, readProjectRecord });
  try {
    assert.throws(() => create("  "), /Nom de projet invalide/u);
    const project = create("ile exemple", "Description fictive");
    assert.equal(project.slug, "ile_exemple");
    assert.equal(project.description, "Description fictive");
    const base = path.join(root, project.slug);
    for (const dir of ["00_carte_ile", "01_escales_reunions", "02_caps_valides_decisions", "03_manoeuvres_actions", "04_regles_methodes", "05_ecrans_parcours", "06_donnees_imports_interfaces", "07_questions_blocages", "08_coffre_documents_sources", "09_exports_livrables", "10_log_pose"]) {
      assert.ok(fs.statSync(path.join(base, dir)).isDirectory(), dir);
    }
    const file = path.join(base, "00_carte_ile", "carte_ile.md");
    fs.writeFileSync(file, "NOTE EXISTANTE À PRÉSERVER", "utf8");
    fs.writeFileSync(path.join(base, "projet.json"), JSON.stringify({ ...project, description: "Texte préservé" }), "utf8");
    create("ile exemple", "Description à ignorer");
    assert.equal(fs.readFileSync(file, "utf8"), "NOTE EXISTANTE À PRÉSERVER");
    assert.equal(readProjectRecord(project.slug).description, "Texte préservé");
    assert.equal(syncCount, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
