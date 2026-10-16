import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLogPoseList, normalizeLogPoseManual } from "../backend/lib/log-pose-normalization.js";

test("Log Pose : préserve les notes et nettoie les listes sans perte d'ordre", () => {
  assert.deepEqual(normalizeLogPoseManual({
    whatToRemember: "  Dernier échange  ",
    openQuestions: "- Question A\n* Question B; Question C",
    documentsToFind: [" devis ", "", null, "facture"],
    nextDirection: "  Relancer demain "
  }), {
    whatToRemember: "Dernier échange",
    openQuestions: ["Question A", "Question B", "Question C"],
    documentsToFind: ["devis", "facture"],
    nextDirection: "Relancer demain"
  });
});
test("Log Pose : les champs absents n'interrompent pas la reprise", () => {
  assert.deepEqual(normalizeLogPoseManual(), {
    whatToRemember: "", openQuestions: [], documentsToFind: [], nextDirection: ""
  });
  assert.deepEqual(normalizeLogPoseList(""), []);
});
