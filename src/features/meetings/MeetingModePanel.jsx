import { useEffect, useRef, useState } from "react";
import MeetingMode from "../../components/MeetingMode.jsx";
import { exportMeeting, saveMeetingMarkers, uploadMeetingAudioChunk } from "../../lib/local-api.js";
import { keepAudioChunk, pendingAudioChunks, rememberAudioSession, recoverAudioSession } from "../../lib/audio-chunk-queue.js";
import { preparePartialAudioExport } from "../../lib/audio-partial-recovery.js";
import { syncAudioSession } from "../../lib/audio-chunk-sync.js";
import { keepLocalMarkers, recoverLocalMarkers, clearLocalMarkers } from "../../lib/meeting-marker-backup.js";

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
  const startingRef = useRef(false);
  const streamRef = useRef(null);
  const writesRef = useRef(Promise.resolve());
  const uploadsRef = useRef(Promise.resolve());
  const chunkWriteErrorRef = useRef(null);
  const markerWritesRef = useRef(Promise.resolve());
  const markerErrorRef = useRef(null);
  const activeSessionRef = useRef(null);
  const [recoverableSession, setRecoverableSession] = useState(() => recoverAudioSession());
  const markersRef = useRef([]);
  const mountedRef = useRef(true);

  useEffect(() => {
    if (!recoverableSession?.sessionId) return;
    try {
      const restored = recoverLocalMarkers(recoverableSession.sessionId);
      markersRef.current = restored;
      setMarkers(restored);
    } catch (restoreError) {
      setError("Marqueurs locaux à examiner : " + restoreError.message);
    }
  }, [recoverableSession?.sessionId]);

  useEffect(() => {
    if (!projectSlug && projects[0]?.slug) setProjectSlug(projects[0].slug);
  }, [projectSlug, projects]);

  useEffect(() => {
    const refreshRecoverableSession = () => setRecoverableSession(recoverAudioSession());
    window.addEventListener("storage", refreshRecoverableSession);
    return () => window.removeEventListener("storage", refreshRecoverableSession);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const selectedProject = projects.find((project) => project.slug === projectSlug) || null;

  async function startRecording() {
    // Empêcher deux clics rapides de créer deux escales avec un même micro.
    if (startingRef.current || recorderRef.current) return;
    startingRef.current = true;
    try {
      await startRecordingOnce();
    } finally {
      startingRef.current = false;
    }
  }

  async function startRecordingOnce() {
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
    const liveSession = recoverAudioSession();
    if (recoverableSession || liveSession?.sessionId) {
      if (liveSession?.sessionId) setRecoverableSession(liveSession);
      setError("Une réunion précédente reste à récupérer. Terminez d'abord sa sauvegarde.");
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
      const meeting = await exportMeeting({
        projectName: selectedProject.name,
        meetingDate: new Date().toISOString().slice(0, 10),
        meetingType,
        title: title.trim(),
        participants: parseParticipants(participants),
        context: context.trim(),
        rawNotes: JSON.stringify(markersRef.current)
      });
      const session = {
        sessionId: crypto.randomUUID(), projectName: selectedProject.name,
        projectSlug: meeting.projectSlug,
        meetingDirName: meeting.meetingDirName, count: 0, finalizedCapture: false
      };
      rememberAudioSession(session);
      activeSessionRef.current = session;
      markerWritesRef.current = Promise.resolve();
      markerErrorRef.current = null;
      setRecoverableSession(session);
      writesRef.current = Promise.resolve();
      uploadsRef.current = Promise.resolve();
      chunkWriteErrorRef.current = null;
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (!event.data.size) return;
        const index = session.count;
        session.count += 1;
        rememberAudioSession(session);
        writesRef.current = writesRef.current
          .then(async () => {
            if (chunkWriteErrorRef.current) return;
            await keepAudioChunk(session.sessionId, index, event.data);
            // Le bloc est d'abord durable dans IndexedDB ; l'envoi n'efface jamais cette copie.
            // Les envois sont ordonnés et une panne réseau ne stoppe pas la capture.
            uploadsRef.current = uploadsRef.current
              .then(() => uploadMeetingAudioChunk({
                projectName: session.projectName,
                meetingDirName: session.meetingDirName,
                index,
                blob: event.data
              }))
              .catch(() => {
                // La reprise finale consultera les blocs réellement reçus par le serveur.
              });
          })
          .catch((writeError) => {
            chunkWriteErrorRef.current = writeError;
            if (mountedRef.current) {
              setError("Stockage audio local interrompu : " + writeError.message + ". Conservez les données du navigateur.");
            }
            // Ne pas continuer à enregistrer si le stockage local est défaillant.
            if (recorder.state === "recording") recorder.stop();
          });
      };
      recorder.onstop = async () => {
        if (mountedRef.current) {
          setIsRecording(false);
          setSaving(true);
        }
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        try {
          await writesRef.current;
          if (chunkWriteErrorRef.current) throw chunkWriteErrorRef.current;
          // L'audio est récupérable dès que le dernier bloc est stocké localement.
          // Une panne du serveur de marqueurs ne doit pas le laisser « incomplet ».
          session.finalizedCapture = true;
          rememberAudioSession(session);
          await markerWritesRef.current;
          await savePendingMarkers(session);
          await uploadsRef.current;
          await syncAudioSession(session);
          if (!mountedRef.current) return;
          clearLocalMarkers(session.sessionId);
          setRecoverableSession(null);
          activeSessionRef.current = null;
          setNotice("Audio finalisé et sauvegardé. Vérifiez la lecture avant toute utilisation importante.");
          setMarkers([]);
          markersRef.current = [];
          setTitle("");
          setMeetingType("réunion");
          setParticipants("");
          setContext("");
          onSaved?.();
        } catch (saveError) {
          if (mountedRef.current) setError("Audio à récupérer : " + (saveError.message || "sauvegarde incomplète"));
        } finally {
          if (mountedRef.current) setSaving(false);
        }
      };
      recorder.start(5000);
      setIsRecording(true);
    } catch (recordingError) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setError(recordingError.message || "Le microphone n’a pas pu être activé.");
    }
  }

  async function savePendingMarkers(session) {
    const pending = recoverLocalMarkers(session.sessionId);
    if (!pending.length) return;
    await saveMeetingMarkers({ projectSlug: session.projectSlug, meetingDirName: session.meetingDirName, markers: pending });
    markerErrorRef.current = null;
  }

  async function retryMarkerSave() {
    if (!recoverableSession || saving || isRecording) return;
    setSaving(true);
    setError("");
    try {
      await savePendingMarkers(recoverableSession);
      clearLocalMarkers(recoverableSession.sessionId);
      setNotice("Marqueurs confirmés sur le serveur. L'audio reste à récupérer séparément.");
    } catch (saveError) {
      setError("Marqueurs non confirmés : " + (saveError.message || "échec réseau"));
    } finally {
      setSaving(false);
    }
  }

  async function retryAudioSave() {
    if (!recoverableSession || saving || isRecording) return;
    if (!recoverableSession.finalizedCapture) {
      setError("L’enregistrement a été interrompu avant la fin. Les fragments disponibles sont conservés. La récupération partielle nécessite une validation spécifique.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await savePendingMarkers(recoverableSession);
      const result = await syncAudioSession(recoverableSession);
      if (["ok", "already-finalized"].includes(result.status)) {
        clearLocalMarkers(recoverableSession.sessionId);
        setRecoverableSession(null);
        setNotice("Blocs audio récupérés et finalisés. Vérifiez l'écoute.");
        onSaved?.();
      }
    } catch (saveError) {
      setError("La récupération reste nécessaire : " + (saveError.message || "échec de transfert"));
    } finally {
      setSaving(false);
    }
  }

  async function exportEmergencyAudio() {
    if (!recoverableSession?.sessionId || saving || isRecording) return;
    setError("");
    try {
      const chunks = await pendingAudioChunks(recoverableSession.sessionId);
      const { blob, extension, count } = preparePartialAudioExport(chunks);
      const url = URL.createObjectURL(blob);
      try {
        const link = document.createElement("a");
        link.href = url;
        link.download = `vogue-mary-secours-${recoverableSession.sessionId}.${extension}`;
        document.body.appendChild(link);
        link.click();
        link.remove();
      } finally {
        // Laisser au navigateur le temps d'initialiser le téléchargement.
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
      setNotice(`Export de secours demandé (${count} fragments). Il peut être incomplet ou illisible ; les blocs locaux sont conservés.`);
    } catch (exportError) {
      setError("Export de secours impossible : " + exportError.message);
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
    const session = activeSessionRef.current;
    if (!session) return;
    const snapshot = [...markersRef.current];
    try {
      keepLocalMarkers(session.sessionId, snapshot);
    } catch (backupError) {
      markerErrorRef.current = backupError;
      setError("Impossible de conserver le marqueur localement : " + backupError.message);
      return;
    }
    markerWritesRef.current = markerWritesRef.current
      .then(() => saveMeetingMarkers({
        projectSlug: session.projectSlug,
        meetingDirName: session.meetingDirName,
        markers: snapshot
      }))
      .then(() => { markerErrorRef.current = null; })
      .catch((saveError) => {
        markerErrorRef.current = saveError;
        if (mountedRef.current) {
          setError("Marqueur non confirmé sur disque : " + (saveError.message || "erreur réseau"));
        }
      });
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
            <input value={participants} onChange={(event) => setParticipants(event.target.value)} disabled={isRecording || saving} placeholder="Intervenant 1, Intervenant 2…" />
          </label>
          <label className="meeting-context-field">
            Objectif / contexte de l’escale
            <textarea value={context} onChange={(event) => setContext(event.target.value)} disabled={isRecording || saving} placeholder="Pourquoi cette réunion a lieu, ce qu’il faut comprendre ou décider…" rows={2} />
          </label>
        </div>
      </div>
      {recoverableSession && !isRecording ? (
        <div className="meeting-notice">
          Une sauvegarde audio est en attente. Ne videz pas les données du navigateur.
          <button type="button" disabled={saving} onClick={retryMarkerSave}>Sauvegarder les marqueurs</button>
          <button type="button" disabled={saving} onClick={retryAudioSave}>Reprendre la sauvegarde audio</button>
          <button type="button" disabled={saving} onClick={exportEmergencyAudio}>Exporter les fragments audio (secours)</button>
        </div>
      ) : null}
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
