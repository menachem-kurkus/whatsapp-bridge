#!/bin/zsh
# Saves a key in the Mac Keychain. Nothing shows while you paste, and the key is never written to a file.
#   ./set-key.sh            the WhatsApp agent's API key (WhatsApp > Settings > Agents > your agent > Chat info > API key)
#   ./set-key.sh model      the AI model's API key (Anthropic, OpenAI, OpenRouter, Gemini ...), if your model needs one
cd "${0:A:h}"
if [[ -n "$1" && "$1" != "model" ]]; then echo "Use ./set-key.sh (WhatsApp key) or ./set-key.sh model (the AI model's key). Nothing saved."; exit 1; fi
[[ -f config.json ]] || { echo "Make config.json first (copy config.example.json)."; exit 1; }
SERVICE=$(node -e 'const c=require("./config.json"); console.log(process.argv[1]==="model" ? ((c.model||{}).keychainService||"whatsapp-agent-kit-model") : (c.keychainService||"whatsapp-agent-kit"))' "$1" 2>/dev/null)
if [[ -z "$SERVICE" ]]; then echo "config.json could not be read (check it for a missing comma or quote)."; exit 1; fi
print -n "Paste the ${1:-WhatsApp} key, then press Return (nothing will show): "
read -rs KEY; echo
if [[ -z "$KEY" ]]; then echo "No key pasted, nothing saved."; exit 1; fi
security add-generic-password -U -a "$USER" -s "$SERVICE" -w "$KEY" && echo "Saved in the Keychain as \"$SERVICE\"."
unset KEY
launchctl kickstart -k gui/$(id -u)/com.whatsapp-agent-kit 2>/dev/null && echo "The helper restarted and will connect within a minute."
