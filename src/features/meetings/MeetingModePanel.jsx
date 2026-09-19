import { useEffect, useRef, useState } from "react";
import MeetingMode from "../../components/MeetingMode.jsx";
import { exportMeeting, exportMeetingAudio } from "../../lib/local-api.js";

function parseParticipants(value) {
  return String(value || "")
    .split(/[,;\n|]+/u)
    .map((item) => item.trim())
    .filter(Boolean)
    .join(", ");
}

export default function MeetingModePanel({ projects, onSaved }) {
  const [projectSlug, setProjectSlug] = useState(projects[0]?.slug || "");
  const [title, setTitle] = useState("");
  const [meetingType, setMeetingType] = useState("réunion");
  const [participants, setParticipants] = useState("");
  const [context, setContext] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [markers, setMarkers] = useState([]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const markersRef = useRef([]);
  const mountedRef = useRef(true);

  useEffect(() => {
    if (!projectSlug && projects[0]?.slug) setProjectSlug(projects[0].slug);
  }, [projectSlug, projects]);

  useEffect(() => () => {
    mountedRef.current = false;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const selectedProject = projects.find((project) => project.slug === projectSlug) || null;

  async function startRecording() {
    setError("");
    setNotice("");
    if (!selectedProject) {
      setError("Sélectionnez d’abord une île / un projet.");
      return;
    }
    if (!title.trim()) {
      setError("Donnez un titre à cette escale avant de démarrer.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("L’enregistrement audio n’est pas disponible dans ce navigateur.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        const audioBlob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        if (!mountedRef.current) return;
        try {
          const meeting = await exportMeeting({
            projectName: selectedProject.name,
            meetingDate: new Date().toISOString().slice(0, 10),
            meetingType,
            title: title.trim(),
            participants: parseParticipants(participants),
            context: context.trim(),
            rawNotes: JSON.stringify(markersRef.current)
          });
          await exportMeetingAudio({
            projectName: selectedProject.name,
            meetingDirName: meeting.meetingDirName,
            blob: audioBlob
          });
          setNotice("Escale, marqueurs et audio enregistrés dans la mémoire locale.");
          setMarkers([]);
          markersRef.current = [];
          setTitle("");
          setMeetingType("réunion");
          setParticipants("");
          setContext("");
          onSaved?.();
        } catch (saveError) {
          setError(saveError.message || "Impossible d’enregistrer l’escale.");
        } finally {
          setSaving(false);
        }
      };
      recorder.start();
      setIsRecording(true);
    } catch (recordingError) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setError(recordingError.message || "Le microphone n’a pas pu être activé.");
    }
  }

  function stopRecording() {
    if (!recorderRef.current) return;
    setSaving(true);
    setIsRecording(false);
    recorderRef.current.stop();
  }

  function addMarker(marker) {
    markersRef.current = [...markersRef.current, marker];
    setMarkers(markersRef.current);
  }

  return (
    <section className="meeting-mode-shell">
      <div className="meeting-setup">
        <div>
          <p className="data-kicker">Nouvelle escale</p>
          <h3>Préparer la réunion</h3>
          <p>Choisissez l’île, les participants, puis posez seulement les marqueurs importants pendant l’échange.</p>
        </div>
        <div className="meeting-setup-fields">
          <label>
            Île / projet
            <select value={projectSlug} onChange={(event) => setProjectSlug(event.target.value)} disabled={isRecording || saving}>
              <option value="">Sélectionner un projet</option>
              {projects.map((project) => <option value={project.slug} key={project.slug}>{project.name}</option>)}
            </select>
          </label>
          <label>
            Titre de l’escale
            <input value={title} onChange={(event) => setTitle(event.target.value)} disabled={isRecording || saving} placeholder="Ex. réunion de cadrage" />
          </label>
          <label>
            Type d’escale
            <select value={meetingType} onChange={(event) => setMeetingType(event.target.value)} disabled={isRecording || saving}>
              <option value="réunion">Réunion</option>
              <option value="entretien">Entretien</option>
              <option value="atelier besoins">Atelier besoins</option>
              <option value="comité">Comité</option>
              <option value="suivi">Suivi</option>
            </select>
          </label>
          <label>
            Participants
            <input value={participants} onChange={(event) => setParticipants(event.target.value)} disabled={isRecording || saving} placeholder="Sofia, Pierre…" />
          </label>
          <label className="meeting-context-field">
            Objectif / contexte de l’escale
            <textarea value={context} onChange={(event) => setContext(event.target.value)} disabled={isRecording || saving} placeholder="Pourquoi cette réunion a lieu, ce qu’il faut comprendre ou décider…" rows={2} />
          </label>
        </div>
      </div>
      {notice ? <p className="meeting-notice">{notice}</p> : null}
      {error ? <p className="data-state error">{error}</p> : null}
      <MeetingMode
        projectName={selectedProject?.name}
        reportTitle={title}
        onStartRecording={startRecording}
        onStopRecording={stopRecording}
        isRecording={isRecording}
        onAddMarker={addMarker}
        markers={markers}
      />
      {saving ? <p className="data-state">Enregistrement de l’escale et de l’audio…</p> : null}
    </section>
  );
}
