#!/usr/bin/env python3
"""
OpenClaw TouchPortal plugin
Controls OpenClaw instance via TouchPortal buttons and displays status.
"""

import os
import subprocess
import sys
import time
import threading

try:
    import TouchPortalAPI as TP
except ImportError:
    print("TouchPortalAPI not installed. Please run: pip install touchportal-api")
    sys.exit(1)


class OpenClawPlugin:
    def __init__(self):
        self.pluginId = "openclaw.deckard"
        self.tp_client = None
        self.running = True
        self.status_thread = None
        
        # Default settings
        self.openclaw_path = "/usr/local/bin/openclaw"
        self.workspace_dir = "/home/dontcallmejames/.openclaw/workspace"
        
        # Model mapping
        self.model_map = {
            "openclaw_switch_model_deepseek": "openrouter/deepseek/deepseek-v3.2",
            "openclaw_switch_model_ollama": "ollama/llama3.2:3b",
            "openclaw_switch_model_claude": "openrouter/anthropic/claude-3.5-sonnet",
            "openclaw_switch_model_gpt4o": "openrouter/openai/gpt-4o",
            "openclaw_switch_model_gemini": "openrouter/google/gemini-2.5-flash-lite"
        }
        
    def run_openclaw_command(self, args, cwd=None):
        """Run an OpenClaw command and return output."""
        cmd = [self.openclaw_path] + args
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                cwd=cwd or self.workspace_dir,
                timeout=10
            )
            return result.returncode, result.stdout.strip(), result.stderr.strip()
        except subprocess.TimeoutExpired:
            return -1, "", "Command timed out"
        except FileNotFoundError:
            return -1, "", f"OpenClaw not found at {self.openclaw_path}"
        except Exception as e:
            return -1, "", str(e)
    
    def parse_status_output(self, output):
        """Parse openclaw status output to extract model, uptime, etc."""
        status = {
            "model": "unknown",
            "status": "offline",
            "uptime": "0s",
            "session": "unknown"
        }
        
        if not output:
            return status
        
        lines = output.split('\n')
        
        # Look for model info in Sessions line
        for line in lines:
            if "Sessions" in line and "default" in line:
                # Example: "Sessions        │ 15 active · default deepseek/deepseek-v3.2 (128k ctx)"
                parts = line.split('default')
                if len(parts) > 1:
                    model_part = parts[1].strip().split()[0]
                    status["model"] = model_part
                    status["status"] = "online"
                break
        
        # Look for runtime/uptime in Gateway line
        for line in lines:
            if "Gateway service" in line:
                if "running" in line.lower():
                    status["uptime"] = "gateway"
                break
        
        # Check for active agents
        for line in lines:
            if "Agents" in line:
                if "active" in line.lower():
                    status["status"] = "online"
                break
        
        return status
    
    def get_agent_status(self):
        """Get current agent status by running openclaw status."""
        # Try to get session status
        rc, out, err = self.run_openclaw_command(["status"])
        if rc == 0:
            parsed = self.parse_status_output(out)
            if parsed["status"] == "online":
                return parsed
        
        # Fallback: check if gateway is running
        rc, out, err = self.run_openclaw_command(["gateway", "status"])
        if rc == 0 and "running" in out.lower():
            return {
                "model": "unknown", 
                "status": "online", 
                "uptime": "gateway", 
                "session": "gateway"
            }
        
        return {
            "model": "unknown", 
            "status": "offline", 
            "uptime": "0s", 
            "session": "none"
        }
    
    def update_states(self):
        """Update all TouchPortal states."""
        if not self.tp_client:
            return
        
        status = self.get_agent_status()
        
        # Update model state
        self.tp_client.stateUpdate("openclaw_current_model", status["model"])
        
        # Update agent status
        self.tp_client.stateUpdate("openclaw_agent_status", status["status"])
        
        # Update uptime
        self.tp_client.stateUpdate("openclaw_uptime", status["uptime"])
    
    def status_poller(self):
        """Background thread to poll status every 30 seconds."""
        while self.running:
            self.update_states()
            time.sleep(30)
    
    # TouchPortal event handlers
    def on_connect(self, data):
        print(f"[OpenClaw] Connected to TouchPortal: {data}")
        self.tp_client.stateUpdate("openclaw_agent_status", "connecting")
        
        # Load settings
        settings = data.get('settings', {})
        self.openclaw_path = settings.get('openclaw_path', self.openclaw_path)
        self.workspace_dir = settings.get('openclaw_workspace', self.workspace_dir)
        
        # Start status polling
        self.status_thread = threading.Thread(target=self.status_poller, daemon=True)
        self.status_thread.start()
        
        # Initial status update
        self.update_states()
    
    def on_action(self, data):
        action_id = data.get('actionId')
        print(f"[OpenClaw] Action triggered: {action_id}")
        
        # Model switching
        if action_id in self.model_map:
            model = self.model_map[action_id]
            # Send /model command to active session via message
            rc, out, err = self.run_openclaw_command([
                "message", 
                "webchat", 
                f"/model {model}"
            ])
            if rc == 0:
                self.tp_client.send_toast(f"Switching to {model}")
            else:
                self.tp_client.send_toast(f"Switch failed: {err[:50]}")
        
        elif action_id == "openclaw_reset_gateway":
            rc, out, err = self.run_openclaw_command(["gateway", "restart"])
            if rc == 0:
                self.tp_client.send_toast("Gateway restart initiated")
            else:
                self.tp_client.send_toast(f"Restart failed: {err[:50]}")
        
        elif action_id == "openclaw_trigger_heartbeat":
            # Trigger heartbeat by writing to HEARTBEAT.md
            heartbeat_file = os.path.join(self.workspace_dir, "HEARTBEAT.md")
            try:
                with open(heartbeat_file, 'w') as f:
                    f.write("# Manual heartbeat triggered via TouchPortal\n")
                self.tp_client.send_toast("Heartbeat triggered")
            except Exception as e:
                self.tp_client.send_toast(f"Heartbeat failed: {str(e)[:50]}")
        
        elif action_id == "openclaw_kill_subagents":
            # Kill all sub-agents via subagents tool
            rc, out, err = self.run_openclaw_command([
                "subagents", 
                "kill", 
                "all"
            ])
            if rc == 0:
                self.tp_client.send_toast("Sub‑agents terminated")
            else:
                self.tp_client.send_toast(f"Kill failed: {err[:50]}")
        
        elif action_id == "openclaw_toggle_thinking":
            # Toggle /reasoning mode
            rc, out, err = self.run_openclaw_command([
                "message", 
                "webchat", 
                "/reasoning"
            ])
            if rc == 0:
                self.tp_client.send_toast("Thinking mode toggled")
            else:
                self.tp_client.send_toast(f"Toggle failed: {err[:50]}")
        
        # Update states after action
        time.sleep(1)
        self.update_states()
    
    def on_settings_update(self, data):
        print(f"[OpenClaw] Settings updated: {data}")
        settings = data.get('values', {})
        self.openclaw_path = settings.get('openclaw_path', self.openclaw_path)
        self.workspace_dir = settings.get('openclaw_workspace', self.workspace_dir)
    
    def on_disconnect(self, data):
        print(f"[OpenClaw] Disconnected: {data}")
        self.running = False
        if self.status_thread:
            self.status_thread.join(timeout=2)
    
    def run(self):
        """Main plugin loop."""
        print("[OpenClaw] Starting OpenClaw TouchPortal plugin...")
        
        # Create client
        self.tp_client = TP.Client(
            pluginId=self.pluginId,
            sleepPeriod=0.05,
            autoClose=False
        )
        
        # Register event handlers
        self.tp_client.on(TP.TYPES.onConnect, self.on_connect)
        self.tp_client.on(TP.TYPES.onAction, self.on_action)
        self.tp_client.on(TP.TYPES.onSettingsUpdate, self.on_settings_update)
        self.tp_client.on(TP.TYPES.onShutdown, self.on_disconnect)
        
        # Record start time for uptime
        self.start_time = time.time()
        
        # Connect and run
        try:
            self.tp_client.connect()
            print("[OpenClaw] Plugin running. Press Ctrl+C to stop.")
            while self.running:
                time.sleep(1)
        except KeyboardInterrupt:
            print("\n[OpenClaw] Shutting down...")
        finally:
            self.running = False
            self.tp_client.disconnect()


if __name__ == "__main__":
    plugin = OpenClawPlugin()
    plugin.run()