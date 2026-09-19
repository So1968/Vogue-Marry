import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Compass } from "lucide-react";
import { loadLogPose } from "../../lib/local-api.js";

function formatDate(value) {
  if (!value || value === "À confirmer") return value || "Date à confirmer";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(date);
}

function LogPosePending({ logPose }) {
  if (!logPose?.pendingReview?.total) return null;
  return (
    <p className="log-pending">
      {logPose.pendingReview.total} élément{logPose.pendingReview.total > 1 ? "s" : ""} attend{logPose.pendingReview.total > 1 ? "ent" : ""} encore une validation.
    </p>
  );
}

export default function LogPoseView({ projectSlug = "", onOpen }) {
  const [logPose, setLogPose] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setLogPose(await loadLogPose(projectSlug));
    } catch (requestError) {
      setError(requestError.message || "Impossible de lire le Log Pose.");
    } finally {
      setLoading(false);
    }
  }, [projectSlug]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const lastDecision = logPose?.lastDecision;
  const lastMeeting = logPose?.lastMeeting;
  const actions = logPose?.priorityActions || [];
  const needs = logPose?.priorityNeeds || [];

  return (
    <aside className="log-pose" aria-label="Log Pose">
      <h2>Log Pose</h2>
      <div className="log-ornament" />
      <div className="log-compass"><Compass size={82} /></div>
      {loading ? <p className="log-state">Lecture de la reprise de contexte…</p> : null}
      {error ? <p className="log-state error">{error}</p> : null}
      {!loading && !error && logPose ? (
        <>
          <section className="log-section">
            <label>Dernière position</label>
            <strong>{logPose.position}</strong>
            <p>{logPose.whatToRemember}</p>
          </section>
          <section className="log-section">
            <label>Dernier cap validé</label>
            <strong>{lastDecision?.decision || "Aucun cap validé"}</strong>
            <p>{lastDecision ? `${formatDate(lastDecision.date)} · ${lastDecision.statut || "Statut à préciser"}` : "Les décisions apparaîtront après validation."}</p>
          </section>
          <section className="log-section">
            <label>Manœuvres prioritaires</label>
            {actions.length ? (
              <ul className="log-list">
                {actions.slice(0, 3).map((action) => <li key={action.id}>{action.action}</li>)}
              </ul>
            ) : <p>Aucune manœuvre prioritaire validée.</p>}
          </section>
          <section className="log-section">
            <label>Besoins à cadrer</label>
            {needs.length ? (
              <ul className="log-list">
                {needs.slice(0, 3).map((need) => <li key={need.id}>{need.need}</li>)}
              </ul>
            ) : <p>Aucun besoin validé à cadrer.</p>}
          </section>
          <section className="log-section">
            <label>À surveiller</label>
            <p>{logPose.openQuestions?.length ? logPose.openQuestions.slice(0, 2).join(" · ") : "Aucune question ouverte enregistrée."}</p>
            <p>{logPose.documentsToFind?.length ? `Document : ${logPose.documentsToFind[0]}` : "Aucun document à retrouver."}</p>
          </section>
          <section className="log-section">
            <label>Reprendre ici</label>
            <strong>{logPose.nextDirection}</strong>
            <p>{lastMeeting ? `${lastMeeting.title} · ${formatDate(lastMeeting.date)}` : "Aucune escale enregistrée."}</p>
            <LogPosePending logPose={logPose} />
          </section>
        </>
      ) : null}
      <button type="button" className="log-button" onClick={onOpen} disabled={!onOpen}>
        Voir les éléments à reprendre <ChevronRight size={18} />
      </button>
    </aside>
  );
}
