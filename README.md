# OpenClaw TouchPortal Plugin

Control your OpenClaw instance from TouchPortal.

**No Python required** — runs on Node.js or as standalone executable.

## Features

- **Reset Gateway** – Restart OpenClaw gateway with one button
- **Switch Models** – Individual buttons for different AI models:
  - DeepSeek V3.2 (default)
  - Llama3.2 3B (local Ollama)
  - Claude 3.5 Sonnet
  - GPT‑4o
  - Gemini 2.5 Flash Lite
- **Kill Sub‑Agents** – Terminate all running sub‑agents
- **Toggle Thinking Mode** – Enable/disable reasoning mode (`/reasoning`)
- **Trigger Heartbeat** – Manually trigger a heartbeat check
- **Agent Status** – Display current model, uptime, and connection status

## Installation

### Option A: Node.js Runtime (Recommended)

1. Ensure **Node.js 16+** is installed (already on your Raspberry Pi)
2. Install the plugin dependencies:
   ```bash
   npm install
   ```
3. Copy the entire `OpenClawTPplugin` folder to your TouchPortal plugins directory:
   - Windows: `%ProgramFiles%\TouchPortal\plugins\`
   - macOS: `/Applications/TouchPortal.app/Contents/plugins/`
   - Linux: `~/.local/share/TouchPortal/plugins/`
4. Restart TouchPortal
5. Open TouchPortal → Plugins → Find "OpenClaw" and enable it

### Option B: Standalone Executable (Linux ARM64)

Build a standalone executable for your Raspberry Pi (bundles Node.js runtime):

```bash
npm run build
```

This creates `openclaw-tp-plugin` executable. Copy it along with `entry.tp` and icons to your plugins directory.

## Configuration

The plugin has two settings in TouchPortal:

1. **OpenClaw path** – Path to the `openclaw` executable (default: `/usr/local/bin/openclaw`)
2. **Workspace directory** – Path to your OpenClaw workspace (default: `/home/dontcallmejames/.openclaw/workspace`)

Adjust these if your OpenClaw installation is in a different location.

## Usage

### Actions Category
- **Reset Gateway** – Immediately restarts the OpenClaw gateway service
- **Model: [Name]** – Switch to the selected AI model
- **Kill Sub‑Agents** – Terminate all running sub‑agents
- **Toggle Thinking Mode** – Enable/disable reasoning mode
- **Trigger Heartbeat** – Forces a heartbeat check

### Status Category
Displays real-time information:
- **Current model** – Which model is active
- **Agent status** – Online/offline
- **Uptime** – Gateway uptime or plugin runtime

## Development

### File Structure
- `entry.tp` – Plugin manifest (defines actions, states, settings)
- `plugin.js` – Main plugin logic (Node.js, uses raw WebSocket)
- `package.json` – Node.js dependencies (`ws` only) and build config
- `icon-actions.png`, `icon-status.png` – Category icons (72×72)
- `README.md` – This file
- `LICENSE` – MIT license

### Building Executable
```bash
npm run build
```
Creates a standalone executable for Linux ARM64 (Raspberry Pi). Uses `pkg` to bundle Node.js runtime.

### Testing Locally
```bash
npm start
```
Runs the plugin in console mode for debugging.

## How It Works

The plugin communicates with OpenClaw via its CLI (`openclaw` command):

1. **Status polling** – Runs `openclaw status` every 30 seconds to update states
2. **Actions** – Executes commands like `openclaw gateway restart`, `openclaw message webchat /model ...`
3. **Heartbeat** – Writes to `HEARTBEAT.md` to trigger manual heartbeat

## Troubleshooting

- **Plugin won't start**: Check Node.js is installed (`node --version`)
- **Commands fail**: Verify OpenClaw path setting points to correct executable
- **Model switching doesn't work**: Ensure you have an active webchat session
- **No status updates**: Check if OpenClaw gateway is running (`openclaw gateway status`)

## License

MIT – See LICENSE file.