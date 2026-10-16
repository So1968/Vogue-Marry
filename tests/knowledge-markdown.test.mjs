import test from "node:test";
import assert from "node:assert/strict";
import { normalizeKnowledgeText, extractMarkdownSection, parseKnowledgeSection, pickKnowledgeValue } from "../backend/lib/knowledge-markdown.js";

test("lecture des tableaux et rubriques Markdown sans perte des valeurs", () => {
 const source = "# Mémoire\n## Actions à faire\n| Action | Responsable | Échéance |\n|---|---|---|\n| Préparer devis | Mateo | 2026-11-20 |\n\n## Décisions\n- Cap validé\n";
 const rows = parseKnowledgeSection(extractMarkdownSection(source, ["Actions à faire"]), "action");
 assert.equal(rows.length, 1);
 assert.equal(pickKnowledgeValue(rows[0], ["Action"]), "Préparer devis");
 assert.equal(pickKnowledgeValue(rows[0], ["Responsable"]), "Mateo");
 assert.equal(pickKnowledgeValue(rows[0], ["Échéance"]), "2026-11-20");
 assert.deepEqual(parseKnowledgeSection(extractMarkdownSection(source, ["Décisions"]), "decision"), [{decision:"Cap validé"}]);
});

test("correspondance des titres accentués et contenu absent", () => {
 assert.equal(normalizeKnowledgeText("  ÉCHÉANCE   "), "echeance");
 assert.deepEqual(extractMarkdownSection("## Rien\n- Non", ["Décisions"]), []);
 assert.deepEqual(parseKnowledgeSection([], "action"), []);
 assert.equal(pickKnowledgeValue({}, ["Responsable"]), "");
});
