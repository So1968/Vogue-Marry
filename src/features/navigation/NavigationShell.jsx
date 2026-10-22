import { Anchor, Bell, BookOpen, ClipboardList, ChevronRight, Compass, FolderOpen, Map, Mic, Sailboat, Settings, ShipWheel, Telescope } from "lucide-react";

const MENU = [
  { id: "pont", label: "Pont", sublabel: "Vue d’ensemble", icon: ShipWheel },
  { id: "iles", label: "Îles", sublabel: "Vos projets", icon: Map },
  { id: "vigie", label: "Vigie", sublabel: "Alertes de toutes les îles", icon: Bell },
  { id: "escales", label: "Escales", sublabel: "Réunions & comités", icon: Anchor },
  { id: "journal", label: "Journal", sublabel: "Comptes rendus", icon: BookOpen },
  { id: "besoins", label: "Besoins", sublabel: "Construction", icon: ClipboardList },
  { id: "coffre", label: "Coffre", sublabel: "Documents", icon: FolderOpen },
  { id: "longuevue", label: "Longue-vue", sublabel: "Toutes les îles & recherche", icon: Telescope },
  { id: "manoeuvres", label: "Manœuvres", sublabel: "Actions à mener", icon: Sailboat },
  { id: "caps", label: "Caps validés", sublabel: "Décisions actées", icon: Compass }
];

export function Sidebar({ active, onChange, projectCount, meetingCount, journalCount }) {
  const counts = { iles: projectCount, escales: meetingCount, journal: journalCount };
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-rose"><Compass size={38} /></div>
        <h1>Vogue Marry</h1>
        <p>Le journal de bord<br />qui vous aide à garder<br />le cap sur vos projets.</p>
      </div>
      <nav className="side-nav">
        {MENU.map(({ id, label, sublabel, icon: Icon }) => (
          <button key={id} className={active === id ? "active" : ""} onClick={() => onChange(id)}>
            <span className="nav-icon"><Icon size={25} /></span>
            <span className="nav-label"><strong>{label}</strong><span>{sublabel}</span></span>
            {counts[id] ? <span className="nav-count">{counts[id]}</span> : null}
          </button>
        ))}
        <a className="transcription-shortcut" href="/transcription" aria-label="Ouvrir la transcription des réunions"><Mic size={22} /><span>Transcrire une escale</span></a>
      </nav>
      <div className="captain-card">
        <div className="captain-avatar">M</div>
        <div><strong>Mémoire locale</strong><span>Données privées sur cet ordinateur</span></div>
        <ChevronRight size={18} />
      </div>
      <div className="sidebar-tools">
        <button aria-label="Réglages"><Settings size={21} /></button>
        <button aria-label="Alertes"><Bell size={21} /></button>
        <button aria-label="Aide"><Compass size={21} /></button>
      </div>
    </aside>
  );
}

export function StageHeader({ active, project }) {
  const current = MENU.find((item) => item.id === active) || MENU[0];
  const titles = {
    pont: ["Pont du navire", "Reprendre le cap sur vos projets actifs"],
    iles: ["Mes îles", "Voir l’état et la direction de chaque projet"],
    vigie: ["La Vigie", "Alertes et échéances de toutes les îles"],
    escales: ["Escales", "Préparer, vivre et transmettre les réunions"],
    journal: ["Journal de bord", "Conserver la mémoire longue du projet"],
    coffre: ["Coffre", "Ranger les documents et les preuves utiles"],
    longuevue: ["Longue-vue", "Explorer toutes les îles et leurs mémoires"],
    manoeuvres: ["Manœuvres", "Voir les actions à mener et les prochaines relances"],
    caps: ["Caps validés", "Retrouver les décisions déjà actées"]
  };
  const [title, subtitle] = project
    ? [project.name.toUpperCase(), `${project.detail} · ${project.status}`]
    : titles[current.id];
  return (
    <header className={`stage-header${project ? " project-mode" : ""}`}>
      <div className="lantern-mark"><Compass size={26} /></div>
      <div className="header-title">
        <p>Vogue Marry · {project ? project.island : current.label}</p>
        <h2>{title}</h2>
        <div className="header-rule" />
        <span>{subtitle}</span>
      </div>
      <div className="header-tools">
        <button aria-label="Notifications"><Bell size={20} /></button>
        <button aria-label="Réglages"><Settings size={20} /></button>
      </div>
    </header>
  );
}

