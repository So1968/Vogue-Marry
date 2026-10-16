import path from "node:path";

export function createProjectReader({ projectsRoot, safePathInside, readJsonIfExists }) {
  return function readProjectRecord(projectSlug) {
    const projectDir = safePathInside(projectsRoot, projectSlug);
    const metadata = readJsonIfExists(path.join(projectDir, "projet.json"));
    return {
      slug: projectSlug,
      name: metadata?.name || projectSlug.replaceAll("_", " "),
      description: metadata?.description || "",
      createdAt: metadata?.createdAt || null
    };
  };
}
