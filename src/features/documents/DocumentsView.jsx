import { useCallback, useEffect, useState } from "react";
import { depositDocument, loadDocuments, validateDocument } from "../../lib/local-api.js";

function formatDate(value) {
  if (!value) return "Date à confirmer";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(date);
}

function DocumentCard({ document, projects, selectedProject, onProjectChange, onValidate, busy }) {
  const pending = document.reviewStatus === "à valider";
  const analysis = document.analysis;

  return (
    <article className="generic-card document-card">
      <div className="document-card-heading">
        <div>
          <small>{document.source}</small>
          <h3>{document.fileName}</h3>
        </div>
        <span className={`document-status${pending ? " pending" : ""}`}>{pending ? "À valider" : "Classé"}</span>
      </div>
      <p className="document-meta">{document.category} · {document.size} · {formatDate(document.modifiedAt)}</p>
      {document.projectName ? <p className="document-project">Île liée : <strong>{document.projectName}</strong></p> : null}
      <p className="document-path">Mémoire locale · {document.relativePath}</p>

      {pending ? (
        <div className="document-review">
          <div>
            <strong>Proposition de classement</strong>
            <span>{analysis?.category || "Document"} · {analysis?.project || "Île à choisir"}</span>
            {analysis?.reason ? <span>{analysis.reason}</span> : null}
          </div>
          {analysis?.warnings?.length ? (
            <ul>
              {analysis.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          ) : <p className="document-clear">Aucun avertissement détecté.</p>}
          <div className="document-review-actions">
            <label>
              Valider dans l’île
              <select value={selectedProject} onChange={(event) => onProjectChange(document.id, event.target.value)} disabled={busy}>
                <option value="">Choisir une île</option>
                {projects.map((project) => <option value={project.slug} key={project.slug}>{project.name}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => onValidate(document)} disabled={busy || !selectedProject}>
              {busy ? "Classement…" : "Valider le classement"}
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

export default function DocumentsView({ projects = [] }) {
  const [documents, setDocuments] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [projectFilter, setProjectFilter] = useState("");
  const [selectedProjects, setSelectedProjects] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refreshDocuments = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await loadDocuments(projectFilter);
      setDocuments(payload.documents);
      setPendingCount(payload.pendingCount);
    } catch (requestError) {
      setError(requestError.message || "Le Coffre local est indisponible.");
    } finally {
      setLoading(false);
    }
  }, [projectFilter]);

  useEffect(() => {
    refreshDocuments();
  }, [refreshDocuments]);

  async function handleDeposit(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setBusy("upload");
    setError("");
    setNotice("");
    try {
      const payload = await depositDocument(file);
      const suggestion = payload.deposit?.analysis?.category || "document à classer";
      setNotice(`Document déposé dans Water Seven. Proposition : ${suggestion}.`);
      await refreshDocuments();
    } catch (requestError) {
      setError(requestError.message || "Impossible de déposer ce document.");
    } finally {
      setBusy("");
    }
  }

  function chooseProject(documentId, projectSlug) {
    setSelectedProjects((current) => ({ ...current, [documentId]: projectSlug }));
  }

  async function handleValidate(document) {
    const projectSlug = selectedProjects[document.id];
    if (!projectSlug) return;

    setBusy(document.id);
    setError("");
    setNotice("");
    try {
      await validateDocument({ sourceId: document.id, projectSlug });
      setNotice(`${document.fileName} est maintenant rangé dans le Coffre de l’île.`);
      await refreshDocuments();
    } catch (requestError) {
      setError(requestError.message || "Impossible de valider ce classement.");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="generic-view documents-view">
      <div className="data-toolbar">
        <div>
          <p className="data-kicker">Coffre</p>
          <h3>Documents locaux</h3>
          <p>Les fichiers restent sur cet ordinateur. Le classement proposé est toujours validé par vous.</p>
        </div>
        <span className="data-count">{pendingCount ? `${pendingCount} à valider` : documents.length}</span>
      </div>

      <div className="documents-toolbar">
        <label>
          Filtrer par île
          <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} disabled={busy === "upload"}>
            <option value="">Toutes les îles</option>
            {projects.map((project) => <option value={project.slug} key={project.slug}>{project.name}</option>)}
          </select>
        </label>
        <label className="document-upload-button">
          <span>{busy === "upload" ? "Dépôt…" : "Déposer un document"}</span>
          <input type="file" onChange={handleDeposit} disabled={busy === "upload"} />
        </label>
      </div>

      {notice ? <p className="meeting-notice">{notice}</p> : null}
      {error ? <p className="data-state error">{error}</p> : null}
      {loading ? <p className="data-state">Lecture des documents locaux…</p> : null}
      {!loading && !error && !documents.length ? (
        <div className="data-empty">
          <h3>Le Coffre est vide</h3>
          <p>Déposez un document ou rangez une pièce jointe dans une île pour la retrouver ici.</p>
        </div>
      ) : null}
      <div className="document-list">
        {documents.map((document) => (
          <DocumentCard
            key={document.id}
            document={document}
            projects={projects}
            selectedProject={selectedProjects[document.id] || ""}
            onProjectChange={chooseProject}
            onValidate={handleValidate}
            busy={busy === document.id}
          />
        ))}
      </div>
    </section>
  );
}
