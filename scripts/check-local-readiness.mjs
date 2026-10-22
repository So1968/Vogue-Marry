#!/usr/bin/env node
// Diagnostic non destructif et sans lecture des enregistrements personnels.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function executable(command) {
  const result = spawnSync(command, ["-version"], { encoding: "utf8", timeout: 5000 });
  return result.status === 0;
}
async function endpoint(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return { reachable: true, status: response.status };
  } catch { return { reachable: false }; }
}
const home = os.homedir();
const root = path.join(home, "VOGUE-MERRY-DONNEES");
const projectRoot = path.resolve(".");
const venv = path.join(projectRoot, ".venv-transcription", "bin", "python");
const report = {
  node: process.version,
  supportedNode: Number(process.versions.node.split(".")[0]) >= 22,
  ffmpeg: executable("ffmpeg"),
  ffprobe: executable("ffprobe"),
  localPythonEnvironment: fs.existsSync(venv),
  dataRootPresent: fs.existsSync(root),
  api: await endpoint("http://127.0.0.1:8010/api/health"),
  transcription: await endpoint("http://127.0.0.1:8011/api/transcription/health")
};
console.log(JSON.stringify(report, null, 2));
