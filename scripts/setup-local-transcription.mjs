#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { findSetupPython, transcriptionSetupPlan } from "./lib/transcription-setup.mjs";
import { localPythonPath } from "../backend/lib/runtime-paths.js";

try {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--check")) throw new Error("Usage : npm run transcription:setup [-- --check]");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const python = findSetupPython();
  for (const command of ["ffmpeg", "ffprobe"]) {
    const result = spawnSync(command, ["-version"], { encoding: "utf8", windowsHide: true, timeout: 5000 });
    if (result.error || result.status !== 0) {
      throw new Error(`${command} est requis dans le PATH. Installer le paquet FFmpeg complet puis rouvrir le terminal.`);
    }
  }
  const steps = transcriptionSetupPlan(root, python);
  if (args.includes("--check")) {
    console.log(JSON.stringify({ status: "prerequisites-ok", platform: process.platform, python: python.version,
      ffmpeg: true, ffprobe: true, localPythonEnvironment: fs.existsSync(localPythonPath(root)),
      dependenciesInstalledByThisCheck: false, modelsTested: false }, null, 2));
  } else {
    for (const step of steps) {
      const result = spawnSync(step.command, step.args, { stdio: "inherit", windowsHide: true });
      if (result.error || result.status !== 0) throw new Error("Installation Python interrompue. Corriger l'erreur affichée puis relancer ; les données utilisateur sont conservées.");
    }
    console.log("Dépendances Python installées et imports vérifiés. Les modèles restent à tester sur un audio synthétique.");
    console.log("Les poids Whisper sont téléchargés au premier usage. Pyannote nécessite les conditions du modèle et un jeton Hugging Face local.");
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
