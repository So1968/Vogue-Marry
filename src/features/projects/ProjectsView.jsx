import { useMemo, useState } from "react";
import { createProject } from "../../lib/local-api.js";
import { makeProjectViewModel } from "./project-utils.js";

export default function ProjectsView({ projects, meetings, loading, error, onOpenProject, onSaved }) {
  const [mode, setMode] = useState("cards");
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState("");
  const [formNotice, setFormNotice] = useState("");
  const viewModels = useMemo(
    () => projects.map((project, index) => makeProjectViewModel(project, meetings, index)),
    [projects, meetings]
  );

  async function handleCreateProject(event) {
    event.preventDefault();
    const name = projectName.trim();
    if (!name) {
      setFormError("Donnez un nom à l’île avant de l’enregistrer.");
      return;
    }

    setCreating(true);
    setFormError("");
    setFormNotice("");
    try {
      await createProject({ name, description: projectDescription.trim() });
      await onSaved?.();
      setProjectName("");
      setProjectDescription("");
      setFormNotice("Île créée dans la mémoire locale.");
    } catch (requestError) {
      setFormError(requestError.message || "Impossible de créer cette île.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="islands-view">
      <div className="islands-toolbar">
        <p>Les Îles sont chargées depuis la mémoire locale de Vogue Marry.</p>
        <div className="view-switch" aria-label="Mode d’affichage des îles">
          <button type="button" className={mode === "cards" ? "active" : ""} onClick={() => setMode("cards")}>Cartes</button>
          <button type="button" className={mode === "list" ? "active" : ""} onClick={() => setMode("list")}>Liste</button>
        </div>
      </div>

      <form className="project-create-form" onSubmit={handleCreateProject}>
        <div>
          <p className="data-kicker">Nouvelle île</p>
          <h3>Commencer une mémoire projet</h3>
          <p>Le nom et le contexte restent rattachés aux escales, journaux et documents.</p>
        </div>
        <label>
          Nom du projet
          <input
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
            placeholder="Ex. Refonte du parcours client"
            maxLength={160}
          />
        </label>
        <label>
          Contexte de reprise <span>(facultatif)</span>
          <textarea
            value={projectDescription}
            onChange={(event) => setProjectDescription(event.target.value)}
            placeholder="Objectif, périmètre ou prochain cap…"
            maxLength={2000}
            rows={2}
          />
        </label>
        <button type="submit" disabled={creating}>{creating ? "Création…" : "Créer l’île"}</button>
        {formError ? <p className="form-message error">{formError}</p> : null}
        {formNotice ? <p className="form-message">{formNotice}</p> : null}
      </form>

      {loading ? <p className="data-state">Lecture des projets locaux…</p> : null}
      {error ? <p className="data-state error">{error}</p> : null}
      {!loading && !error && !viewModels.length ? (
        <div className="data-empty">
          <h3>Aucune île enregistrée</h3>
          <p>Créez la première île ci-dessus pour commencer à conserver le fil du projet.</p>
        </div>
      ) : null}

      {!loading && !error && viewModels.length > 0 && mode === "cards" ? (
        <div className="island-project-grid">
          {viewModels.map((project) => (
            <article className="project-card" key={project.slug}>
              <div className="project-card-top">
                <div>
                  <small>Île / projet</small>
                  <h3>{project.name}</h3>
                </div>
                <span className={`project-status ${project.tone}`}>{project.status}</span>
              </div>
              <div className="project-meta">
                <div><label>État de la mémoire</label><p>{project.cap}</p></div>
                <div><label>Prochaine reprise</label><p>{project.next}</p></div>
              </div>
              <button type="button" className="project-open-button" onClick={() => onOpenProject(project)}>Ouvrir →</button>
            </article>
          ))}
        </div>
      ) : null}

      {!loading && !error && viewModels.length > 0 && mode === "list" ? (
        <div className="island-project-list">
          <div className="project-row header" aria-hidden="true">
            <span>Projet</span><span>État</span><span>Mémoire</span><span>Prochaine reprise</span><span />
          </div>
          {viewModels.map((project) => (
            <article className="project-row" key={project.slug}>
              <div><strong>{project.name}</strong><span className="project-island">{project.detail}</span></div>
              <span className={`project-status ${project.tone}`}>{project.status}</span>
              <p>{project.cap}</p>
              <p>{project.next}</p>
              <button type="button" className="project-open-button" onClick={() => onOpenProject(project)}>Ouvrir →</button>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
