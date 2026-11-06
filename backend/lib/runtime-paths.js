import path from "node:path";

export function localPythonPath(projectRoot, platform = process.platform) {
  const paths = platform === "win32" ? path.win32 : path.posix;
  return platform === "win32"
    ? paths.join(projectRoot, ".venv-transcription", "Scripts", "python.exe")
    : paths.join(projectRoot, ".venv-transcription", "bin", "python");
}
