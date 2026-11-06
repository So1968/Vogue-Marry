#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="$ROOT/.venv-transcription"
PYTHON_BIN="${PYTHON_BIN:-python3}"

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "Python 3 est requis pour la transcription locale."
  exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg est requis. Sous Pop!_OS/Ubuntu : sudo apt install ffmpeg"
  exit 1
fi

if ! command -v ffprobe >/dev/null 2>&1; then
  echo "ffprobe est requis pour contrôler la durée des audios. Installe le paquet ffmpeg complet."
  exit 1
fi

if [ ! -d "$VENV" ]; then
  echo "Création de l'environnement local Vogue Marry…"
  if ! "$PYTHON_BIN" -m venv "$VENV"; then
    echo
    echo "Le module venv manque. Sous Pop!_OS/Ubuntu :"
    echo "  sudo apt install python3-venv"
    echo "Puis relance : npm run transcription:setup"
    exit 1
  fi
fi

"$VENV/bin/python" -m pip install --upgrade pip wheel setuptools
"$VENV/bin/python" -m pip install -r "$ROOT/requirements-transcription.txt"

"$VENV/bin/python" - <<'PY'
import faster_whisper
import av
import pyannote.audio
print("Moteur local prêt : faster-whisper + PyAV + pyannote.audio")
PY

echo
echo "Dépendances Python installées. Le fonctionnement des modèles reste à vérifier sur un audio de test."
echo "Whisper large-v3-turbo sera téléchargé automatiquement au premier usage."
echo "Pour Pyannote Community-1 : accepte une fois les conditions du modèle Hugging Face"
echo "puis enregistre ton jeton HF dans l'écran Transcription de Vogue Marry."
