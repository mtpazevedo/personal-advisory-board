#!/bin/bash
# ── Personal Advisory Board — One-Time Setup ──────────────────────────────────

set -e

echo ""
echo "  Personal Advisory Board — Setup"
echo "  ────────────────────────────────"

# 1. Install Homebrew if missing
if ! command -v brew &>/dev/null; then
  echo "  → Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Add brew to PATH for Apple Silicon
  if [[ -f /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  fi
else
  echo "  ✓ Homebrew found"
fi

# 2. Install Node.js if missing
if ! command -v node &>/dev/null; then
  echo "  → Installing Node.js via Homebrew..."
  brew install node
else
  echo "  ✓ Node.js $(node --version) found"
fi

# 3. Install npm dependencies
echo "  → Installing dependencies..."
npm install

# 4. Create .env if it doesn't exist
if [ ! -f .env ]; then
  cp .env.example .env
  echo ""
  echo "  ⚠️  Almost there! Open the .env file and add your Anthropic API key:"
  echo "     ANTHROPIC_API_KEY=sk-ant- 
  echo "  Get your key at: https://console.anthropic.com"
else
  echo "  ✓ .env file found"
fi

echo ""
echo "  ✓ Setup complete!"
echo ""
echo "  To start the app:"
echo "    npm start"
echo ""
echo "  Then open: http://localhost:3000"
echo ""
