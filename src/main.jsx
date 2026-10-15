import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import TranscriptionView from "./TranscriptionView.jsx";
import "./demo-stabilisation.css";
import "./carte-mentale-aventure.css";

const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
const root = createRoot(document.getElementById("root"));

root.render(pathname === "/transcription" ? <TranscriptionView /> : <App />);
