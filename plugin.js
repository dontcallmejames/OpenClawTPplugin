#!/usr/bin/env node
/**
 * Minimal OpenClaw TouchPortal plugin
 * Uses raw WebSocket communication (no external dependencies)
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

class OpenClawPlugin {
    constructor() {
        this.pluginId = 'openclaw.deckard';
        this.ws = null;
        this.running = true;
        this.statusInterval = null;
        
        // Default settings
        this.openclawPath = '/usr/local/bin/openclaw';
        this.workspaceDir = '/home/dontcallmejames/.openclaw/workspace';
        
        // Model mapping
        this.modelMap = {
            openclaw_switch_model_deepseek: 'openrouter/deepseek/deepseek-v3.2',
            openclaw_switch_model_ollama: 'ollama/llama3.2:3b',
            openclaw_switch_model_claude: 'openrouter/anthropic/claude-3.5-sonnet',
            openclaw_switch_model_gpt4o: 'openrouter/openai/gpt-4o',
            openclaw_switch_model_gemini: 'openrouter/google/gemini-2.5-flash-lite'
        };
    }
    
    async runOpenClawCommand(args) {
        return new Promise((resolve) => {
            const cmd = spawn(this.openclawPath, args, {
                cwd: this.workspaceDir,
                timeout: 10000
            });
            
            let stdout = '';
            let stderr = '';
            
            cmd.stdout.on('data', (data) => stdout += data.toString());
            cmd.stderr.on('data', (data) => stderr += data.toString());
            
            cmd.on('close', (code) => {
                resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
            });
            
            cmd.on('error', (err) => {
                resolve({ code: -1, stdout: '', stderr: err.message });
            });
        });
    }
    
    parseStatusOutput(output) {
        const status = {
            model: 'unknown',
            status: 'offline',
            uptime: '0s'
        };
        
        if (!output) return status;
        
        const lines = output.split('\n');
        
        for (const line of lines) {
            if (line.includes('Sessions') && line.includes('default')) {
                const parts = line.split('default');
                if (parts.length > 1) {
                    status.model = parts[1].trim().split(' ')[0];
                    status.status = 'online';
                }
                break;
            }
        }
        
        for (const line of lines) {
            if (line.includes('Gateway service')) {
                if (line.toLowerCase().includes('running')) {
                    status.uptime = 'gateway';
                }
                break;
            }
        }
        
        return status;
    }
    
    async getAgentStatus() {
        const result = await this.runOpenClawCommand(['status']);
        if (result.code === 0) {
            const parsed = this.parseStatusOutput(result.stdout);
            if (parsed.status === 'online') return parsed;
        }
        
        const gatewayResult = await this.runOpenClawCommand(['gateway', 'status']);
        if (gatewayResult.code === 0 && gatewayResult.stdout.toLowerCase().includes('running')) {
            return { model: 'unknown', status: 'online', uptime: 'gateway' };
        }
        
        return { model: 'unknown', status: 'offline', uptime: '0s' };
    }
    
    async updateStates() {
        if (!this.ws) return;
        
        const status = await this.getAgentStatus();
        
        // Update states via TP API
        this.sendMessage({
            type: 'stateUpdate',
            id: this.pluginId,
            states: [
                { id: 'openclaw_current_model', value: status.model },
                { id: 'openclaw_agent_status', value: status.status },
                { id: 'openclaw_uptime', value: status.uptime }
            ]
        });
    }
    
    sendMessage(msg) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(msg));
        }
    }
    
    sendToast(message) {
        this.sendMessage({
            type: 'showNotification',
            id: this.pluginId,
            notification: { id: 'toast', message }
        });
    }
    
    async handleAction(actionId) {
        console.log(`[OpenClaw] Action: ${actionId}`);
        
        // Model switching
        if (this.modelMap[actionId]) {
            const model = this.modelMap[actionId];
            const result = await this.runOpenClawCommand(['message', 'webchat', `/model ${model}`]);
            if (result.code === 0) {
                this.sendToast(`Switching to ${model}`);
            } else {
                this.sendToast(`Switch failed: ${result.stderr.slice(0, 50)}`);
            }
        }
        
        else if (actionId === 'openclaw_reset_gateway') {
            const result = await this.runOpenClawCommand(['gateway', 'restart']);
            if (result.code === 0) {
                this.sendToast('Gateway restart initiated');
            } else {
                this.sendToast(`Restart failed: ${result.stderr.slice(0, 50)}`);
            }
        }
        
        else if (actionId === 'openclaw_trigger_heartbeat') {
            const file = path.join(this.workspaceDir, 'HEARTBEAT.md');
            try {
                fs.writeFileSync(file, '# Manual heartbeat\n');
                this.sendToast('Heartbeat triggered');
            } catch (err) {
                this.sendToast(`Heartbeat failed: ${err.message.slice(0, 50)}`);
            }
        }
        
        else if (actionId === 'openclaw_kill_subagents') {
            const result = await this.runOpenClawCommand(['subagents', 'kill', 'all']);
            if (result.code === 0) {
                this.sendToast('Sub‑agents terminated');
            } else {
                this.sendToast(`Kill failed: ${result.stderr.slice(0, 50)}`);
            }
        }
        
        else if (actionId === 'openclaw_toggle_thinking') {
            const result = await this.runOpenClawCommand(['message', 'webchat', '/reasoning']);
            if (result.code === 0) {
                this.sendToast('Thinking mode toggled');
            } else {
                this.sendToast(`Toggle failed: ${result.stderr.slice(0, 50)}`);
            }
        }
        
        // Update states
        setTimeout(() => this.updateStates(), 1000);
    }
    
    async run() {
        console.log('[OpenClaw] Starting minimal plugin...');
        
        // Get TP port from environment
        const tpPort = process.env.TP_PLUGIN_PORT || 12136;
        
        // Connect to TouchPortal
        this.ws = new WebSocket(`ws://127.0.0.1:${tpPort}`);
        
        this.ws.on('open', () => {
            console.log('[OpenClaw] Connected to TouchPortal');
            
            // Send plugin info
            this.sendMessage({
                type: 'info',
                id: this.pluginId,
                version: '1.0.0'
            });
            
            // Start status polling
            this.statusInterval = setInterval(() => {
                this.updateStates().catch(console.error);
            }, 30000);
            
            // Initial update
            this.updateStates();
        });
        
        this.ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                
                if (msg.type === 'action') {
                    this.handleAction(msg.actionId);
                }
                else if (msg.type === 'settings') {
                    const settings = msg.values || {};
                    this.openclawPath = settings.openclaw_path || this.openclawPath;
                    this.workspaceDir = settings.openclaw_workspace || this.workspaceDir;
                }
                else if (msg.type === 'closePlugin') {
                    this.running = false;
                }
            } catch (err) {
                console.error('[OpenClaw] Message parse error:', err);
            }
        });
        
        this.ws.on('error', (err) => {
            console.error('[OpenClaw] WebSocket error:', err.message);
        });
        
        this.ws.on('close', () => {
            console.log('[OpenClaw] Disconnected');
            this.running = false;
            if (this.statusInterval) clearInterval(this.statusInterval);
        });
        
        // Keep alive
        while (this.running) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
}

// Run plugin
const plugin = new OpenClawPlugin();

process.on('SIGINT', () => {
    console.log('\n[OpenClaw] Shutting down...');
    plugin.running = false;
    process.exit(0);
});

plugin.run().catch(console.error);