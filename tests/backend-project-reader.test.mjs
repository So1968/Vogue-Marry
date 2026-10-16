import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createProjectReader } from "../backend/lib/project-reader.js";
import { safePathInside } from "../backend/lib/path-guards.js";

test("lit les métadonnées du projet et conserve les valeurs de repli", () => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), "vogue-project-reader-"));
 try {
  const island = path.join(root, "ile_test");
  fs.mkdirSync(island);
  const reader = createProjectReader({
   projectsRoot: root,
   safePathInside,
   readJsonIfExists: (file) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null
  });
  assert.deepEqual(reader("ile_test"), { slug: "ile_test", name: "ile test", description: "", createdAt: null });
  fs.writeFileSync(path.join(island, "projet.json"), JSON.stringify({name:"Île de démonstration",description:"Fictive",createdAt:"2026-10-16"}));
  assert.deepEqual(reader("ile_test"), { slug: "ile_test", name: "Île de démonstration", description: "Fictive", createdAt: "2026-10-16" });
  assert.throws(() => reader("../secret"), /Chemin de données invalide/u);
 } finally { fs.rmSync(root, {recursive:true,force:true}); }
});
