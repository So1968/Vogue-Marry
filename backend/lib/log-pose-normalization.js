export function normalizeLogPoseList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  return String(value || "")
    .split(/[\r\n;]+/u)
    .map((item) => item.replace(/^[-*]\s+/u, "").trim())
    .filter(Boolean);
}

export function normalizeLogPoseManual(value = {}) {
  return {
    whatToRemember: String(value.whatToRemember || "").trim(),
    openQuestions: normalizeLogPoseList(value.openQuestions),
    documentsToFind: normalizeLogPoseList(value.documentsToFind),
    nextDirection: String(value.nextDirection || "").trim()
  };
}

