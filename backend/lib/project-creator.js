import path from "node:path";

export function makeProjectCreator({ projectsRoot, slugify, safePathInside, ensureDir, writeFileIfMissing, syncLogPose, readProjectRecord }) {
  return function createProjectStructure(projectName, projectDescription = "") {
  const slug = slugify(projectName);
  if (!slug) throw new Error("Nom de projet invalide.");

  const baseDir = safePathInside(projectsRoot, slug);
  ensureDir(baseDir);
  writeFileIfMissing(
    path.join(baseDir, "projet.json"),
    JSON.stringify({
      version: 1,
      slug,
      name: String(projectName).trim(),
      description: String(projectDescription || "").trim().slice(0, 2000),
      createdAt: new Date().toISOString()
    }, null, 2)
  );

  const folders = [
    "00_carte_ile",
    "01_escales_reunions",
    "02_caps_valides_decisions",
    "03_manoeuvres_actions",
    "04_regles_methodes",
    "05_ecrans_parcours",
    "06_donnees_imports_interfaces",
    "07_questions_blocages",
    "08_coffre_documents_sources",
    "09_exports_livrables",
    "10_log_pose"
  ];

  folders.forEach((folder) => ensureDir(path.join(baseDir, folder)));

  writeFileIfMissing(
    path.join(baseDir, "README_PROJET.md"),
`# Île / projet — ${projectName}

Ce dossier contient la mémoire navigable du projet dans Vogue Merry.

Structure :
- 00_carte_ile : reprise rapide du fil et vue générale
- 01_escales_reunions : audios, transcriptions, journaux de bord
- 02_caps_valides_decisions : décisions consolidées
- 03_manoeuvres_actions : plan d'actions
- 04_regles_methodes : règles, méthodes et arbitrages
- 05_ecrans_parcours : écrans, parcours et besoins identifiés
- 06_donnees_imports_interfaces : sources, imports, interfaces, mappings
- 07_questions_blocages : questions ouvertes et blocages
- 08_coffre_documents_sources : documents d'origine, pièces et preuves
- 09_exports_livrables : livrables générés
- 10_log_pose : synthèse du cap et prochaine direction
`
  );

  writeFileIfMissing(
    path.join(baseDir, "00_carte_ile", "carte_ile.md"),
`# Carte de l’île — ${projectName}

## Objectif du projet

## Contexte

## Périmètre

## Équipage / acteurs clés

## État actuel

## Dernier cap validé

## Manœuvres en cours

## Questions ouvertes

## Points de vigilance

## Prochaine direction
`
  );

  writeFileIfMissing(path.join(baseDir, "02_caps_valides_decisions", "caps_valides.md"), `# Caps validés / décisions — ${projectName}\n\n| Date | Cap validé / décision | Statut | Source | Impact |\n|---|---|---|---|---|\n`);
  writeFileIfMissing(path.join(baseDir, "03_manoeuvres_actions", "manoeuvres_actions.md"), `# Manœuvres / actions — ${projectName}\n\n| Action | Responsable | Échéance | Statut | Source |\n|---|---|---|---|---|\n`);
  writeFileIfMissing(path.join(baseDir, "04_regles_methodes", "regles_methodes.md"), `# Règles / méthodes — ${projectName}\n\n| Règle / méthode | Statut | Source | Points ouverts |\n|---|---|---|---|\n`);
  writeFileIfMissing(path.join(baseDir, "05_ecrans_parcours", "ecrans_parcours.md"), `# Écrans / parcours — ${projectName}\n\n| Écran / parcours | Objectif | Règles associées | Points ouverts |\n|---|---|---|---|\n`);
  writeFileIfMissing(path.join(baseDir, "05_ecrans_parcours", "besoins.md"), `# Besoins identifiés — ${projectName}\n\n| Besoin | Contexte / preuve | Priorité | Statut | Source |\n|---|---|---|---|---|\n`);
  writeFileIfMissing(path.join(baseDir, "06_donnees_imports_interfaces", "donnees_imports_interfaces.md"), `# Données / imports / interfaces — ${projectName}\n\n| Élément | Source | Usage | Points ouverts |\n|---|---|---|---|\n`);
  writeFileIfMissing(path.join(baseDir, "07_questions_blocages", "questions_blocages.md"), `# Questions ouvertes / blocages — ${projectName}\n\n| Date | Sujet | Statut | Responsable | Source |\n|---|---|---|---|---|\n`);
  writeFileIfMissing(path.join(baseDir, "10_log_pose", "log_pose.md"), `# Log Pose — ${projectName}\n\n## Ce qu’il faut retenir\n\n## Dernier cap validé\n\n## Manœuvres prioritaires\n\n## Questions ouvertes\n\n## Documents à retrouver\n\n## Prochaine direction utile\n`);
  syncLogPose(slug);

  return readProjectRecord(slug);
}
}
