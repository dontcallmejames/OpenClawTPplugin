# OpenClaw TouchPortal Plugin

Control your OpenClaw instance from TouchPortal.

## Features

- **Reset Gateway** – Restart OpenClaw gateway with one button
- **Switch Models** – Change between different AI models (DeepSeek, Ollama, Claude, GPT, Gemini)
- **Agent Status** – Display current model, uptime, and connection status
- **Trigger Heartbeat** – Manually trigger a heartbeat check

## Installation

1. Install Python 3.7+ if not already installed
2. Install the plugin dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Copy the `OpenClawTPplugin` folder to your TouchPortal plugins directory:
   - Windows: `%ProgramFiles%\TouchPortal\plugins\`
   - macOS: `/Applications/TouchPortal.app/Contents/plugins/`
   - Linux: `~/.local/share/TouchPortal/plugins/`
4. Restart TouchPortal
5. Open TouchPortal → Plugins → Find "OpenClaw" and enable it

## Configuration

The plugin has two settings in TouchPortal:

1. **OpenClaw path** – Path to the `openclaw` executable (default: `/usr/local/bin/openclaw`)
2. **Workspace directory** – Path to your OpenClaw workspace (default: `/home/dontcallmejames/.openclaw/workspace`)

Adjust these if your OpenClaw installation is in a different location.

## Usage

### Actions Category
- **Reset Gateway** – Immediately restarts the OpenClaw gateway service
- **Switch Model** – Dropdown to select and switch between different AI models
- **Trigger Heartbeat** – Forces a heartbeat check (updates status, checks emails/calendar)

### Status Category
Displays real-time information:
- **Current model** – Which model is active
- **Agent status** – Online/offline
- **Uptime** – How long the plugin has been connected

## Development

### File Structure
- `entry.tp` – Plugin manifest (defines actions, states, settings)
- `plugin.py` – Main plugin logic
- `requirements.txt` – Python dependencies
- `README.md` – This file
- `LICENSE` – MIT license

### Adding New Features
1. Add actions/states to `entry.tp`
2. Implement handlers in `plugin.py`
3. Test locally with TouchPortal

### Icons
Place icon files (PNG, 72x72) in the plugin directory:
- `icon-actions.png` – Actions category icon
- `icon-status.png` – Status category icon

## License

MIT – See LICENSE file.