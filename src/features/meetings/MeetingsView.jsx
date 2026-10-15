import { useState } from "react";
import MeetingModePanel from "./MeetingModePanel.jsx";
import { localApi, saveMeetingReport, validateMeeting } from "../../lib/local-api.js";

function formatDate(value) {
  if (!value) return "Date à confirmer";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(date);
}

function MeetingJournalCard({ meeting, onChanged }) {
  const [report, setReport] = useState(null);
  const [draftReport, setDraftReport] = useState("");
  const [reportType, setReportType] = useState("");
  const [busy, setBusy] = useState(false);
  const [savingReport, setSavingReport] = useState(false);
  const [notice, setNotice] = useState("");

  async function toggleReport() {
    if (report !== null) {
      setReport(null);
      return;
    }

    setBusy(true);
    setNotice("");
    try {
      const payload = await localApi("/api/meetings/read-report", {
        method: "POST",
        body: JSON.stringify({
          projectSlug: meeting.projectSlug,
          meetingDirName: meeting.meetingDirName
        })
      });
      setReport(payload.content || "");
      setDraftReport(payload.content || "");
      setReportType(payload.reportType || "exporte");
    } catch (error) {
      setNotice(error.message || "Impossible de lire le journal.");
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    setSavingReport(true);
    setNotice("");
    try {
      await saveMeetingReport({
        projectSlug: meeting.projectSlug,
        meetingDirName: meeting.meetingDirName,
        content: draftReport
      });
      setReport(draftReport);
      setNotice("Corrections enregistrées dans la version de travail.");
      onChanged?.();
    } catch (error) {
      setNotice(error.message || "Impossible d’enregistrer les corrections.");
    } finally {
      setSavingReport(false);
    }
  }

  async function validateReport() {
    setBusy(true);
    setNotice("");
    try {
      if (report !== null && report !== draftReport) {
        await saveMeetingReport({
          projectSlug: meeting.projectSlug,
          meetingDirName: meeting.meetingDirName,
          content: draftReport
        })
        setReport(draftReport);
      }
      await validateMeeting({
        projectSlug: meeting.projectSlug,
        meetingDirName: meeting.meetingDirName
      });
      setNotice("Journal validé dans la mémoire locale.");
      onChanged?.();
      setReport(null);
      setDraftReport("");
      setReportType("");
    } catch (error) {
      setNotice(error.message || "Impossible de valider le journal.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="generic-card meeting-card">
      <small>{meeting.projectName}</small>
      <h3>{meeting.title}</h3>
      <p className="meeting-date">{formatDate(meeting.date)} · {meeting.meetingType || "Escale"}</p>
      <p>{meeting.status}</p>
      <div className="meeting-flags">
        {meeting.hasAudio ? <span>Audio</span> : null}
        {meeting.hasTranscription ? <span>Transcription</span> : null}
        {meeting.hasReport ? <span>Journal</span> : null}
        {meeting.hasValidatedReport ? <span>Validé</span> : null}
      </div>
      {meeting.hasReport ? (
        <div className="meeting-actions">
          <button type="button" onClick={toggleReport} disabled={busy}>
            {busy ? "Chargement…" : report !== null ? "Masquer le journal" : "Lire le journal"}
          </button>
          {!meeting.hasValidatedReport ? <button type="button" onClick={validateReport} disabled={busy}>Valider</button> : null}
        </div>
      ) : null}
      {notice ? <p className="meeting-notice">{notice}</p> : null}
      {report !== null ? (
        <div className="meeting-report">
          <small>Version {reportType === "valide" ? "validée" : "exportée"}</small>
          {reportType === "valide" ? <pre>{report}</pre> : (
            <>
              <textarea
                aria-label="Journal de bord modifiable"
                value={draftReport}
                onChange={(event) => setDraftReport(event.target.value)}
                rows={18}
              />
              {draftReport !== report ? (
                <div className="meeting-report-actions">
                  <button type="button" onClick={saveDraft} disabled={savingReport || busy}>
                    {savingReport ? "Enregistrement…" : "Enregistrer les corrections"}
                  </button>
                  <span>La validation protègera cette version.</span>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </article>
  );
}

export default function MeetingsView({ meetings, projects = [], loading, error, journalOnly = false, onSaved }) {
  const visibleMeetings = journalOnly
    ? meetings.filter((meeting) => meeting.hasReport)
    : meetings;

  return (
    <section className="generic-view meetings-view">
      <div className="data-toolbar">
        <div>
          <p className="data-kicker">Mémoire locale</p>
          <h3>{journalOnly ? "Journaux de bord" : "Escales enregistrées"}</h3>
          <p>Les réunions et leurs états viennent de `01_PROJETS`.</p>
        </div>
        <span className="data-count">{visibleMeetings.length}</span>
      </div>
      {loading ? <p className="data-state">Lecture des escales locales…</p> : null}
      {error ? <p className="data-state error">{error}</p> : null}
      {!journalOnly ? <MeetingModePanel projects={projects} onSaved={onSaved} /> : null}
      {!loading && !error && !visibleMeetings.length ? (
        <div className="data-empty">
          <h3>{journalOnly ? "Aucun journal exporté" : "Aucune escale enregistrée"}</h3>
          <p>Les données réelles apparaîtront ici dès qu’une escale sera créée.</p>
        </div>
      ) : null}
      <div className="meeting-list">
        {visibleMeetings.map((meeting) => (
          <MeetingJournalCard
            key={`${meeting.projectSlug}/${meeting.meetingDirName}`}
            meeting={meeting}
            onChanged={onSaved}
          />
        ))}
      </div>
    </section>
  );
}
