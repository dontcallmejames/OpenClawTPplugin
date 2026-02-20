#!/usr/bin/env node
/**
 * OpenClaw TouchPortal plugin (remote gateway version)
 * Connects to OpenClaw gateway WebSocket API from gaming PC
 */

const WebSocket = require('ws');

class OpenClawRemotePlugin {
    constructor() {
        this.pluginId = 'openclaw.deckard';
        this.tpWs = null;          // TouchPortal WebSocket
        this.ocWs = null;          // OpenClaw gateway WebSocket
        this.running = true;
        this.statusInterval = null;

        // Settings (configured in TouchPortal plugin settings)
        this.gatewayUrl = 'ws://192.168.1.191:18789/ws';
        this.authToken = '';

        // Model mapping (action id -> model string)
        this.modelMap = {
            openclaw_switch_model_deepseek: 'openrouter/deepseek/deepseek-v3.2',
            openclaw_switch_model_ollama: 'ollama/llama3.2:3b',
            openclaw_switch_model_claude: 'anthropic/claude-sonnet-4-6',
            openclaw_switch_model_gpt4o: 'openrouter/openai/gpt-4o',
            openclaw_switch_model_gemini: 'openrouter/google/gemini-2.5-flash-lite'
        };

        // Request ID counter
        this.reqId = 1;
    }

    // Send JSON-RPC to OpenClaw gateway
    sendGatewayRpc(method, params = {}) {
        if (!this.ocWs || this.ocWs.readyState !== WebSocket.OPEN) {
            console.error('[OpenClaw] Gateway not connected');
            return null;
        }

        const id = this.reqId++;
        const msg = {
            jsonrpc: '2.0',
            id,
            method,
            params: { ...params, token: this.authToken }
        };

        this.ocWs.send(JSON.stringify(msg));
        return id;
    }

    // Send message to TouchPortal
    sendToTP(msg) {
        if (this.tpWs && this.tpWs.readyState === WebSocket.OPEN) {
            this.tpWs.send(JSON.stringify(msg));
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

    async connectToGateway() {
        console.log(`[OpenClaw] Connecting to gateway: ${this.gatewayUrl}`);

        this.ocWs = new WebSocket(this.gatewayUrl);

        this.ocWs.on('open', () => {
            console.log('[OpenClaw] Gateway WebSocket connected');
            this.sendToast('Connected to OpenClaw');
            this.updateState('openclaw_agent_status', 'online');
        });

        this.ocWs.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.result && msg.result.status) {
                    const status = msg.result.status;
                    if (status.model) {
                        this.updateState('openclaw_current_model', status.model);
                    }
                }
            } catch (err) {
                console.error('[OpenClaw] Gateway message parse error:', err);
            }
        });

        this.ocWs.on('error', (err) => {
            console.error('[OpenClaw] Gateway error:', err.message);
            this.updateState('openclaw_agent_status', 'error');
        });

        this.ocWs.on('close', () => {
            console.log('[OpenClaw] Gateway disconnected');
            this.updateState('openclaw_agent_status', 'offline');
            // Reconnect after delay
            if (this.running) {
                setTimeout(() => this.connectToGateway(), 5000);
            }
        });
    }

    async fetchStatus() {
        this.sendGatewayRpc('status.get');
        this.updateState('openclaw_uptime', 'remote');
    }

    async handleAction(actionId) {
        console.log(`[OpenClaw] Action: ${actionId}`);

        if (this.modelMap[actionId]) {
            const model = this.modelMap[actionId];
            this.sendGatewayRpc('message.send', {
                channel: 'webchat',
                message: `/model ${model}`
            });
            this.sendToast(`Switching to ${model}`);
        }

        else if (actionId === 'openclaw_reset_gateway') {
            this.sendGatewayRpc('gateway.restart');
            this.sendToast('Gateway restart initiated');
        }

        else if (actionId === 'openclaw_trigger_heartbeat') {
            this.sendGatewayRpc('file.write', {
                path: '/home/dontcallmejames/.openclaw/workspace/HEARTBEAT.md',
                content: '# Manual heartbeat\n'
            });
            this.sendToast('Heartbeat triggered');
        }

        else if (actionId === 'openclaw_kill_subagents') {
            this.sendGatewayRpc('subagents.kill', { target: 'all' });
            this.sendToast('Sub-agents terminated');
        }

        else if (actionId === 'openclaw_toggle_thinking') {
            this.sendGatewayRpc('message.send', {
                channel: 'webchat',
                message: '/reasoning'
            });
            this.sendToast('Thinking mode toggled');
        }

        // Refresh status after action
        setTimeout(() => this.fetchStatus(), 1000);
    }

    // Parse TP settings — values come as an array of {name: value} objects
    parseSettings(values) {
        if (!values) return {};
        // TP sends values as an array: [{"setting_name": "value"}, ...]
        if (Array.isArray(values)) {
            return values.reduce((acc, item) => Object.assign(acc, item), {});
        }
        // Or as a plain object (some versions)
        return values;
    }

    // TouchPortal connection
    connectToTouchPortal(port = 12136) {
        console.log(`[OpenClaw] Connecting to TouchPortal on port ${port}`);

        this.tpWs = new WebSocket(`ws://127.0.0.1:${port}`);

        this.tpWs.on('open', () => {
            console.log('[OpenClaw] TouchPortal connected');

            // Send plugin info/pair message
            this.sendToTP({
                type: 'pair',
                id: this.pluginId
            });

            // Connect to OpenClaw gateway
            this.connectToGateway();

            // Start status polling every 30s
            this.statusInterval = setInterval(() => {
                this.fetchStatus();
            }, 30000);
        });

        this.tpWs.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());

                if (msg.type === 'action') {
                    this.handleAction(msg.actionId);
                }
                else if (msg.type === 'settings') {
                    const settings = this.parseSettings(msg.values);
                    if (settings.gateway_url) {
                        this.gatewayUrl = settings.gateway_url;
                        console.log(`[OpenClaw] Gateway URL updated: ${this.gatewayUrl}`);
                        if (this.ocWs) this.ocWs.close();
                        this.connectToGateway();
                    }
                    if (settings.auth_token) {
                        this.authToken = settings.auth_token;
                        console.log('[OpenClaw] Auth token updated');
                    }
                }
                else if (msg.type === 'closePlugin') {
                    this.running = false;
                }
            } catch (err) {
                console.error('[OpenClaw] TP message error:', err);
            }
        });

        this.tpWs.on('error', (err) => {
            console.error('[OpenClaw] TP error:', err.message);
        });

        this.tpWs.on('close', () => {
            console.log('[OpenClaw] TouchPortal disconnected');
            this.running = false;
            if (this.statusInterval) clearInterval(this.statusInterval);
            if (this.ocWs) this.ocWs.close();
        });
    }

    async run() {
        console.log('[OpenClaw] Starting remote plugin...');

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
