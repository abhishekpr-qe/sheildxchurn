#!/bin/bash
set -euo pipefail

CORTEX_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Installing Aspora Cortex for ShieldXChurn..."
echo ""

# CLAUDE.md → global (applies to all projects)
cp "$CORTEX_DIR/CLAUDE.md" ~/CLAUDE.md
echo "  Installed ~/CLAUDE.md (Cortex global engineering standards)"

echo ""
echo "Done. Start a new Claude Code session to use Cortex."
echo ""
echo "Next steps:"
echo "  - For skills, see: https://github.com/Vance-Club/ai-velocity"
echo "  - Cortex repo: https://github.com/Vance-Club/aspora-cortex"
echo "  - Project-specific CLAUDE.md is at: $CORTEX_DIR/CLAUDE.md"
