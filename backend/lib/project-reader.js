
export function createProjectReader({ projectsRoot, safePathInside, readJsonIfExists }) {
  return function readProjectRecord(projectSlug) {
    const projectDir = safePathInside(projectsRoot, projectSlug);
    const metadata = readJsonIfExists(safePathInside(projectDir, "projet.json"));
    return {
      slug: projectSlug,
      name: metadata?.name || projectSlug.replaceAll("_", " "),
      description: metadata?.description || "",
      createdAt: metadata?.createdAt || null
    };
  };
}
