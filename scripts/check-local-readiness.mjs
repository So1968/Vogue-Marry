#!/usr/bin/env node
import { localPythonPath } from "../backend/lib/runtime-paths.js";
// Diagnostic non destructif et sans lecture des enregistrements personnels.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isSupportedNode, probeLocalService } from "./lib/local-readiness.mjs";

function executable(command) {
  const result = spawnSync(command, ["-version"], { encoding: "utf8", timeout: 5000 });
  return result.status === 0;
}
const home = os.homedir();
const root = path.join(home, "VOGUE-MERRY-DONNEES");
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const venv = localPythonPath(projectRoot);
const [api, transcription] = await Promise.all([
  probeLocalService("http://127.0.0.1:8010/api/health", "vogue-marry-local-backend"),
  probeLocalService("http://127.0.0.1:8010/api/transcription/health", "vogue-marry-transcription")
]);
const report = {
  node: process.version,
  supportedNode: isSupportedNode(process.versions.node),
  ffmpeg: executable("ffmpeg"),
  ffprobe: executable("ffprobe"),
  localPythonEnvironment: fs.existsSync(venv),
  dataRootPresent: fs.existsSync(root),
  api,
  transcription
};
console.log(JSON.stringify(report, null, 2));
