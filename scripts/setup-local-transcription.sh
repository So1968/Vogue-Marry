#!/usr/bin/env bash
# Compatibilité avec l'ancienne commande Unix ; l'installateur commun est en Node.
set -euo pipefail
exec node "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/setup-local-transcription.mjs" "$@"
