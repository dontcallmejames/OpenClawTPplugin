#!/usr/bin/env node
/**
 * OpenClaw TouchPortal plugin (remote gateway version)
 * Uses OpenClaw's HTTP /tools/invoke API — no complex WebSocket protocol needed.
 */

const net = require('net');
const https = require('https');
const http = require('http');

class OpenClawRemotePlugin {
    constructor() {
        this.pluginId = 'openclaw.deckard';
        this.tpSocket = null;
        this.running = true;
        this.statusInterval = null;

        // Settings (configured in TouchPortal plugin settings)
        this.gatewayUrl = 'http://192.168.1.191:18789';   // Pi gateway HTTP base URL
        this.authToken = '5ded5065b332507fde2eef8ffd4ba0453bf1fc230c124dfe'; // default token

        // Model mapping (action id -> model string)
        this.modelMap = {
            openclaw_switch_model_deepseek: 'openrouter/deepseek/deepseek-v3.2',
            openclaw_switch_model_ollama: 'ollama/llama3.2:3b',
            openclaw_switch_model_claude: 'anthropic/claude-sonnet-4-6',
            openclaw_switch_model_gpt4o: 'openrouter/openai/gpt-4o',
            openclaw_switch_model_gemini: 'openrouter/google/gemini-2.5-flash-lite'
        };
    }

    // Call OpenClaw's /tools/invoke HTTP endpoint
    invokeTool(tool, args = {}, sessionKey = 'main') {
        return new Promise((resolve, reject) => {
            const body = JSON.stringify({ tool, args, sessionKey });
            const url = new URL(`${this.gatewayUrl}/tools/invoke`);
            const isHttps = url.protocol === 'https:';
            const lib = isHttps ? https : http;

            const options = {
                hostname: url.hostname,
                port: url.port || (isHttps ? 443 : 80),
                path: '/tools/invoke',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body),
                    'Authorization': `Bearer ${this.authToken}`
                }
            };

            const req = lib.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        console.log(`[OpenClaw] ← ${res.statusCode} (${tool}):`, JSON.stringify(parsed).slice(0, 120));
                        resolve({ status: res.statusCode, body: parsed });
                    } catch {
                        console.log(`[OpenClaw] ← ${res.statusCode} (${tool}): ${data.slice(0, 120)}`);
                        resolve({ status: res.statusCode, body: data });
                    }
                });
            });

            req.on('error', reject);
            req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
            req.write(body);
            req.end();
            console.log(`[OpenClaw] → POST /tools/invoke (${tool})`);
        });
    }

    // Convenience: run a shell command on the Pi via exec tool
    async runCommand(command) {
        return this.invokeTool('exec', { command });
    }

    // Send message to TouchPortal (raw TCP JSON line)
    sendToTP(msg) {
        if (this.tpSocket && !this.tpSocket.destroyed) {
            this.tpSocket.write(JSON.stringify(msg) + '\n');
        }
    }

    sendToast(message) {
        this.sendToTP({
            type: 'showNotification',
            id: this.pluginId,
            notification: { id: 'toast', message }
        });
    }

    updateState(stateId, value) {
        this.sendToTP({
            type: 'stateUpdate',
            id: this.pluginId,
            states: [{ id: stateId, value: String(value) }]
        });
    }

    async fetchStatus() {
        try {
            const res = await this.invokeTool('exec', { command: 'openclaw gateway status --short 2>/dev/null || echo "running"' });
            if (res.status === 200) {
                this.updateState('openclaw_agent_status', 'online');
            } else {
                this.updateState('openclaw_agent_status', 'error');
            }
        } catch {
            this.updateState('openclaw_agent_status', 'offline');
        }
    }

    async handleAction(actionId) {
        console.log(`[OpenClaw] Action: ${actionId}`);

        try {
            // Model switching
            if (this.modelMap[actionId]) {
                const model = this.modelMap[actionId];
                const res = await this.runCommand(`openclaw message webchat '/model ${model}'`);
                if (res.status === 200) {
                    this.sendToast(`Switching to ${model}`);
                    this.updateState('openclaw_current_model', model);
                } else {
                    this.sendToast(`Switch failed (${res.status})`);
                    console.error('[OpenClaw] Model switch failed:', res.body);
                }
            }

            else if (actionId === 'openclaw_reset_gateway') {
                // Fire-and-forget — gateway restart will cut the connection
                this.runCommand('openclaw gateway restart').catch(() => {});
                this.sendToast('Gateway restart initiated');
                this.updateState('openclaw_agent_status', 'restarting');
            }

            else if (actionId === 'openclaw_trigger_heartbeat') {
                const res = await this.runCommand(
                    'echo "# Manual heartbeat" > /home/dontcallmejames/.openclaw/workspace/HEARTBEAT.md'
                );
                if (res.status === 200) {
                    this.sendToast('Heartbeat triggered');
                } else {
                    this.sendToast(`Heartbeat failed (${res.status})`);
                }
            }

            else if (actionId === 'openclaw_kill_subagents') {
                const res = await this.invokeTool('subagents', { action: 'kill', target: 'all' });
                if (res.status === 200) {
                    this.sendToast('Sub-agents terminated');
                } else {
                    this.sendToast(`Kill failed (${res.status})`);
                }
            }

            else if (actionId === 'openclaw_toggle_thinking') {
                const res = await this.runCommand("openclaw message webchat '/reasoning'");
                if (res.status === 200) {
                    this.sendToast('Thinking mode toggled');
                } else {
                    this.sendToast(`Toggle failed (${res.status})`);
                }
            }

        } catch (err) {
            console.error(`[OpenClaw] Action ${actionId} error:`, err.message);
            this.sendToast(`Error: ${err.message.slice(0, 50)}`);
        }

        // Refresh status after action
        setTimeout(() => this.fetchStatus(), 2000);
    }

    // Parse TP settings — values come as array [{name: value}, ...] or plain object
    parseSettings(values) {
        if (!values) return {};
        if (Array.isArray(values)) {
            return values.reduce((acc, item) => Object.assign(acc, item), {});
        }
        return values;
    }

    // TouchPortal connection (raw TCP, JSONL protocol)
    connectToTouchPortal(port = 12136) {
        console.log(`[OpenClaw] Connecting to TouchPortal on port ${port}`);
        this.tpSocket = net.createConnection(port, '127.0.0.1');

        let buf = '';

        this.tpSocket.on('connect', () => {
            console.log('[OpenClaw] TouchPortal connected');
            // Pair with TouchPortal
            this.sendToTP({ type: 'pair', id: this.pluginId });

            // Delay initial status check to allow TP to send settings first
            setTimeout(() => this.fetchStatus(), 2000);

            // Poll status every 30s
            this.statusInterval = setInterval(() => this.fetchStatus(), 30000);
        });

        this.tpSocket.on('data', (chunk) => {
            buf += chunk.toString();
            const lines = buf.split('\n');
            buf = lines.pop(); // keep incomplete last line in buffer
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                try {
                    const msg = JSON.parse(trimmed);
                    if (msg.type === 'action') {
                        this.handleAction(msg.actionId);
                    }
                    else if (msg.type === 'settings') {
                        const settings = this.parseSettings(msg.values);
                        console.log('[OpenClaw] Settings received:', JSON.stringify(settings).slice(0, 120));
                        if (settings.gateway_url) {
                            this.gatewayUrl = settings.gateway_url.replace(/\/ws$/, '').replace(/\/$/, '');
                            console.log(`[OpenClaw] Gateway URL: ${this.gatewayUrl}`);
                        }
                        if (settings.auth_token && settings.auth_token.trim()) {
                            this.authToken = settings.auth_token.trim();
                            console.log('[OpenClaw] Auth token updated from TP settings');
                        } else {
                            console.log('[OpenClaw] auth_token not in TP settings, using default');
                        }
                        setTimeout(() => this.fetchStatus(), 500);
                    }
                    else if (msg.type === 'closePlugin') {
                        this.running = false;
                    }
                } catch (err) {
                    console.error('[OpenClaw] TP parse error:', err.message, '| line:', trimmed.slice(0, 80));
                }
            }
        });

        this.tpSocket.on('error', (err) => {
            console.error('[OpenClaw] TP error:', err.message);
        });

        this.tpSocket.on('close', () => {
            console.log('[OpenClaw] TouchPortal disconnected');
            this.running = false;
            if (this.statusInterval) clearInterval(this.statusInterval);
        });
    }

    async run() {
        console.log('[OpenClaw] Starting remote plugin (HTTP mode)...');
        const tpPort = process.env.TP_PLUGIN_PORT || 12136;
        this.connectToTouchPortal(tpPort);

        // Keep alive
        while (this.running) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
}

const plugin = new OpenClawRemotePlugin();

process.on('SIGINT', () => {
    console.log('\n[OpenClaw] Shutting down...');
    plugin.running = false;
    process.exit(0);
});

plugin.run().catch(console.error);
