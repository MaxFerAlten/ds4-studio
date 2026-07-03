#!/usr/bin/env bash
set -euo pipefail

repomix \
  --style markdown \
  --split-output 10mb \
  --output ds4studio.md \
  --ignore "**/node_modules/**,**/__pycache__/**,**/.*/**,**/temp/**,**/tmp/**,**/ultimate/**,**/reasoningfromagentic/**,**/*.json,**/*.txt,**/gguf-tools/**,**/docs/**,**/ggml/**,**/tools/**,**/aphify-out/**"
