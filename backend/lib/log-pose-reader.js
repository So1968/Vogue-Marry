import fs from "node:fs";
import path from "node:path";

export function makeLogPoseReader({ projectsRoot, safePathInside, readJsonIfExists, normalizeLogPoseManual, extractMarkdownSection, defaults }) {
  return function readLogPoseManual(projectSlug) {
  const directory = safePathInside(projectsRoot, projectSlug, "10_log_pose");
  const jsonPath = path.join(directory, "log_pose.json");
  const stored = readJsonIfExists(jsonPath);
  if (stored) return normalizeLogPoseManual(stored.manual || stored);

  const markdownPath = path.join(directory, "log_pose.md");
  if (!fs.existsSync(markdownPath)) return { ...defaults };
  const content = fs.readFileSync(markdownPath, "utf8");
  const sectionText = (heading) => extractMarkdownSection(content, [heading])
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("|") && !/^---+$/u.test(line))
    .join(" ")
    .trim();
  const sectionList = (heading) => extractMarkdownSection(content, [heading])
    .map((line) => line.trim().replace(/^[-*]\s+/u, ""))
    .filter((line) => line && !line.startsWith("|") && !/^---+$/u.test(line));

  return normalizeLogPoseManual({
    whatToRemember: sectionText("Ce qu’il faut retenir"),
    openQuestions: sectionList("Questions ouvertes"),
    documentsToFind: sectionList("Documents à retrouver"),
    nextDirection: sectionText("Prochaine direction utile")
  });
}

}
