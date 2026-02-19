#!/usr/bin/env python3
"""
OpenClaw TouchPortal plugin
Controls OpenClaw instance via TouchPortal buttons and displays status.
"""

import os
import subprocess
import sys
import time
import json
import threading
from pathlib import Path

# Add current directory to path for local imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

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
    
    def get_agent_status(self):
        """Get current agent status (model, uptime, etc.)."""
        # Try to get session status
        rc, out, err = self.run_openclaw_command(["status"])
        if rc == 0:
            # Parse status output (simplistic)
            if "model" in out.lower():
                lines = out.split('\n')
                model_line = next((l for l in lines if "model" in l.lower()), "")
                return {
                    "model": model_line.split(":")[-1].strip() if ":" in model_line else "unknown",
                    "status": "online",
                    "raw": out[:100]
                }
        
        # Fallback: check if gateway is running
        rc, out, err = self.run_openclaw_command(["gateway", "status"])
        if rc == 0 and "running" in out.lower():
            return {"model": "unknown", "status": "online", "raw": "gateway running"}
        
        return {"model": "unknown", "status": "offline", "raw": err or "No response"}
    
    def update_states(self):
        """Update all TouchPortal states."""
        if not self.tp_client:
            return
        
        status = self.get_agent_status()
        
        # Update model state
        self.tp_client.stateUpdate("openclaw_current_model", status["model"])
        
        # Update agent status
        self.tp_client.stateUpdate("openclaw_agent_status", status["status"])
        
        # Simple uptime placeholder (could read from logs)
        # For now, just show time since plugin started
        if hasattr(self, 'start_time'):
            uptime = int(time.time() - self.start_time)
            self.tp_client.stateUpdate("openclaw_uptime", f"{uptime}s")
    
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
        
        if action_id == "openclaw_reset_gateway":
            rc, out, err = self.run_openclaw_command(["gateway", "restart"])
            if rc == 0:
                self.tp_client.send_toast(f"Gateway restart initiated: {out[:50]}")
            else:
                self.tp_client.send_toast(f"Restart failed: {err[:50]}")
        
        elif action_id == "openclaw_switch_model":
            model = data.get('data', [{}])[0].get('value') if data.get('data') else None
            if model:
                # Use /model command via message to active session
                # This is a placeholder - actual implementation would need
                # to send a message to the active OpenClaw session
                self.tp_client.send_toast(f"Switching to model: {model} (not implemented)")
                # Example: self.run_openclaw_command(["message", "session", f"/model {model}"])
        
        elif action_id == "openclaw_trigger_heartbeat":
            # Trigger heartbeat by sending HEARTBEAT.md check
            heartbeat_file = os.path.join(self.workspace_dir, "HEARTBEAT.md")
            if os.path.exists(heartbeat_file):
                with open(heartbeat_file, 'r') as f:
                    content = f.read()
                # Simple notification
                self.tp_client.send_toast("Heartbeat triggered (check logs)")
            else:
                self.tp_client.send_toast("No HEARTBEAT.md file found")
        
        # Update states after action
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