import { useEffect, useState } from "react";
import { loadKnowledge } from "../../lib/local-api.js";
import LogPoseView from "../log-pose/LogPoseView.jsx";

export default function IslandProjectView({ project, onBack, initialSection = "carte", onPositionChange, onOpenManoeuvres }) {
  const [section, setSection] = useState(initialSection);
  useEffect(() => { onPositionChange(project.slug, section); }, [onPositionChange, project.slug, section]);
  const [projectActions, setProjectActions] = useState([]);
  const [actionsLoading, setActionsLoading] = useState(true);
  const [actionsError, setActionsError] = useState("");
  useEffect(() => {
    let active = true;
    loadKnowledge("action", project.slug)
      .then(({ items }) => {
        if (active) {
          setProjectActions(items);
          setActionsError("");
        }
      })
      .catch((error) => {
        if (active) setActionsError(error.message || "Impossible de charger les manœuvres.");
      })
      .finally(() => { if (active) setActionsLoading(false); });
    return () => { active = false; };
  }, [project.slug]);
  const latestMeeting = project.meetings?.[0] || null;
  const openMeetings = (project.meetings || []).filter((meeting) => meeting.status !== "Validé");
  const sections = {
    cap: {
      label: "Cap",
      subtitle: "Ce que les données connues permettent de reprendre maintenant",
      items: [
        ["État actuel", project.status],
        ["Dernière escale", latestMeeting?.title || "Aucune escale enregistrée"],
        ["Date", latestMeeting?.date || "À confirmer"],
        ["Prochaine reprise", project.next]
      ]
    },
    journal: {
      label: "Journal de bord",
      subtitle: "Les escales déjà enregistrées sur cette île",
      items: project.meetings?.length
        ? project.meetings.map((meeting) => [meeting.title, `${meeting.date || "Date à confirmer"} · ${meeting.status}`])
        : [["Aucune escale", "Le journal sera alimenté dès qu’une réunion sera exportée."]]
    },
    manoeuvres: {
      label: "Manœuvres",
      subtitle: "Actions du projet issues des journaux, avec leur état de validation",
      items: actionsError
        ? [["Erreur de chargement", actionsError]]
        : actionsLoading
          ? [["Chargement", "Lecture des actions du projet…"]]
          : projectActions.length
            ? projectActions.map((action) => [
                action.action || "Action à préciser",
                `${action.reviewStatus === "à valider" ? "À valider" : action.statut || "Validée"} · ${action.responsable || "Responsable à préciser"} · ${action.echeance || "Sans échéance"}`
              ])
            : [["Aucune action enregistrée", "Les actions apparaîtront après validation des journaux de bord."]]
    },
    arsenal: {
      label: "Arsenal",
      subtitle: "Les traces actuellement rattachées au projet",
      items: [
        ["Escales", `${project.meetings?.length || 0} escale${project.meetings?.length > 1 ? "s" : ""}`],
        ["Audios", `${project.meetings?.filter((meeting) => meeting.hasAudio).length || 0} fichier${project.meetings?.filter((meeting) => meeting.hasAudio).length > 1 ? "s" : ""}`],
        ["Journaux", `${project.meetings?.filter((meeting) => meeting.hasReport).length || 0} journal${project.meetings?.filter((meeting) => meeting.hasReport).length > 1 ? "x" : ""}`],
        ["Source", "Mémoire locale Vogue Marry"]
      ]
    }
  };
  const currentSection = sections[section];
  const returnToMap = () => setSection("carte");

  return (
    <section className="project-world-view">
      <div className="project-world-top">
        {section === "carte" ? (
          <button type="button" className="back-to-islands" onClick={onBack}>← Mes îles</button>
        ) : (
          <button type="button" className="back-to-islands" onClick={returnToMap}>← Carte de l’île</button>
        )}
        <span className="world-kicker">{section === "carte" ? "La carte est le menu du projet" : `${project.island} · ${currentSection.label}`}</span>
      </div>

      {section === "manoeuvres" ? <button type="button" className="back-to-islands" onClick={() => onOpenManoeuvres(project.slug)}>Gérer et valider les manœuvres →</button> : null}
      {section === "carte" ? (
        <div className="project-island-home">
          <LogPoseView key={project.slug} projectSlug={project.slug} onNavigate={setSection} />
          <section className="mind-map-shell" aria-label="Carte mentale du projet">
          <div className="mind-map-heading">
            <small>{project.island}</small>
            <h3>Carte mentale</h3>
            <span>Choisir une branche pour entrer dans l’espace correspondant.</span>
          </div>
          <div className="mind-map">
            <button type="button" className="mind-branch mind-branch-cap" onClick={() => setSection("cap")}>
              <strong>Cap</strong><span>Où va le projet ?</span>
            </button>
            <span className="mind-link north" aria-hidden="true" />

            <button type="button" className="mind-branch mind-branch-journal" onClick={() => setSection("journal")}>
              <strong>Journal</strong><span>Ce qui s’est passé</span>
            </button>
            <span className="mind-link west" aria-hidden="true" />

            <article className="mind-center">
              <small>Projet · {project.status}</small>
              <strong>{project.name}</strong>
              <p>{project.detail}</p>
              <div className="mind-center-meta">
                <span>{project.meetings?.length || 0} escale{project.meetings?.length > 1 ? "s" : ""}</span>
                <span>{openMeetings.length} ouverte{openMeetings.length > 1 ? "s" : ""}</span>
                <span>{latestMeeting?.date || "Aucune date"}</span>
              </div>
            </article>

            <span className="mind-link east" aria-hidden="true" />
            <button type="button" className="mind-branch mind-branch-manoeuvres" onClick={() => setSection("manoeuvres")}>
              <strong>Manœuvres</strong><span>Ce qu’on fait maintenant</span>
            </button>

            <span className="mind-link south" aria-hidden="true" />
            <button type="button" className="mind-branch mind-branch-arsenal" onClick={() => setSection("arsenal")}>
              <strong>Arsenal</strong><span>Ce qu’on a pour agir</span>
            </button>

            <div className="mind-resume" aria-label="Point de reprise du projet">
              <div>
                <small>Position actuelle</small>
                <strong>{project.status}</strong>
              </div>
              <div>
                <small>Reprendre ici</small>
                <strong>{project.next}</strong>
                <span>{project.detail}</span>
              </div>
            </div>
          </div>
          </section>
        </div>
      ) : (
        <article className="world-section">
          <div className="world-section-header">
            <small>{project.island}</small>
            <h3>{currentSection.label}</h3>
            <span>{currentSection.subtitle}</span>
          </div>
          <div className="world-items">
            {currentSection.items.map(([title, text]) => (
              <div className="world-item" key={title}>
                <strong>{title}</strong>
                <span>{text}</span>
              </div>
            ))}
          </div>
        </article>
      )}
    </section>
  );
}

