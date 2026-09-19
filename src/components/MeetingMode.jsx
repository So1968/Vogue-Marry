import { useEffect, useRef, useState } from "react";
import {
  Mic,
  Square,
  Flag,
  CheckCircle2,
  HelpCircle,
  AlertTriangle,
  Monitor,
  Calculator,
  ListTodo,
  ShieldAlert,
  ClipboardList
} from "lucide-react";

const markerTypes = [
  { key: "decision", label: "Décision", icon: CheckCircle2 },
  { key: "action", label: "Action", icon: ListTodo },
  { key: "question", label: "Question", icon: HelpCircle },
  { key: "a_verifier", label: "À vérifier", icon: Flag },
  { key: "regle_calcul", label: "Règle de calcul", icon: Calculator },
  { key: "ecran", label: "Écran / fonctionnalité", icon: Monitor },
  { key: "need", label: "Besoin utilisateur", icon: ClipboardList },
  { key: "blocage", label: "Blocage", icon: AlertTriangle },
  { key: "point_sensible", label: "Point sensible", icon: ShieldAlert }
];

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

export default function MeetingMode({
  projectName,
  reportTitle,
  onStartRecording,
  onStopRecording,
  isRecording,
  onAddMarker,
  markers = []
}) {
  const [seconds, setSeconds] = useState(0);
  const startedAtRef = useRef(null);

  useEffect(() => {
    let interval = null;

    if (isRecording) {
      if (!startedAtRef.current) {
        startedAtRef.current = Date.now();
        setSeconds(0);
      }

      interval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);
        setSeconds(elapsed);
      }, 500);
    } else {
      startedAtRef.current = null;
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRecording]);

  function handleMarker(type) {
    const marker = {
      id: crypto.randomUUID(),
      type: type.key,
      label: type.label,
      timeSeconds: seconds,
      timeLabel: formatTime(seconds),
      createdAt: new Date().toISOString()
    };

    onAddMarker(marker);
  }

  return (
    <section className="meetingMode">
      <div className="meetingTop">
        <div>
          <p className="eyebrow">Mode réunion</p>
          <h2>{reportTitle || "Réunion sans titre"}</h2>
          <p>{projectName || "Aucun projet sélectionné"}</p>
        </div>

        <div className={isRecording ? "bigTimer recording" : "bigTimer"}>
          <span>{isRecording ? "REC" : "PRÊT"}</span>
          <strong>{formatTime(seconds)}</strong>
        </div>
      </div>

      <div className="meetingControls">
        {!isRecording ? (
          <button className="startMeetingButton" onClick={onStartRecording}>
            <Mic size={22} />
            Démarrer l’enregistrement
          </button>
        ) : (
          <button className="stopMeetingButton" onClick={onStopRecording}>
            <Square size={22} />
            Arrêter la réunion
          </button>
        )}
      </div>

      <div className="markerZone">
        <h3>Marqueurs rapides</h3>
        <p>
          Pendant la réunion, ne saisis rien. Clique seulement quand un point important arrive.
        </p>

        <div className="markerGrid">
          {markerTypes.map((type) => {
            const Icon = type.icon;
            return (
              <button
                key={type.key}
                className="markerButton"
                disabled={!isRecording}
                onClick={() => handleMarker(type)}
              >
                <Icon size={18} />
                {type.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="markerHistory">
        <h3>Repères posés</h3>

        {markers.length ? (
          <div className="markerList">
            {markers.map((marker) => (
              <div key={marker.id} className="markerItem">
                <strong>{marker.timeLabel}</strong>
                <span>{marker.label}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty">
            Aucun marqueur pour l’instant. C’est normal : l’idée est de cliquer très peu.
          </p>
        )}
      </div>
    </section>
  );
}
