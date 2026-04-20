import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './App.css';
import type { ElectronApi, EvidenceReport, HistoryEntry, PromptScan, UsageLogEntry } from './types/electron';
import type { ProviderUsageSnapshot, UsageProviderType } from './types';

// Dark mode removed - always use light theme only
if (window.api) {
  document.body.classList.add('electron');
}

// Mock API for web browser testing (without Electron)
if (!window.api) {
  (window as unknown as { api: ElectronApi }).api = {
    getConfig: async () => ({
      providers: [{ id: 'mock-1', name: 'Claude', type: 'claude' }],
      settings: {
        colors: { low: '#4caf50', medium: '#ff9800', high: '#f44336' },
        toggleInterval: 2000,
        refreshInterval: 5,
        shortcut: 'CommandOrControl+Shift+T',
        proxyPort: 8780,
      }
    }),
    saveConfig: async () => ({ success: true }),
    addProvider: async () => ({ success: true }),
    removeProvider: async () => ({ success: true }),
    refreshUsage: async () => ({ success: true }),
    getUsageData: async () => ({
      usage: 50,
      resetTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      sevenDay: { utilization: 18, resetsAt: new Date(Date.now() + 70 * 3600000).toISOString() },
      providerName: 'Claude',
      settings: {
        colors: { low: '#4caf50', medium: '#ff9800', high: '#f44336' },
        toggleInterval: 2000,
        refreshInterval: 5,
        shortcut: 'CommandOrControl+Shift+T',
        proxyPort: 8780,
      },
    }),
    saveSettings: async () => ({ success: true }),

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    getPromptScans: async (_options?: { limit?: number; offset?: number; session_id?: string; provider?: string }) => {
      const models = ['claude-opus-4-6', 'claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001'];
      const prompts = [
        'Implement passive session monitoring',
        'Fix TypeScript build errors',
        'Add new React component',
        'Update API endpoints',
        'Refactor database layer',
        'Implement the CT Scan system',
        'Create a PromptTimeline component',
        'Fix TypeScript build errors',
        'Refactor this code',
        'Write E2E tests',
      ];
      // Match session IDs and timestamps with getRecentHistory mock
      const sessionIds = ['mock-sess-001', 'mock-sess-001', 'mock-sess-002', 'mock-sess-002', 'mock-sess-003',
        'mock-sess-001', 'mock-sess-002', 'mock-sess-003', 'mock-sess-001', 'mock-sess-002'];
      const now = Date.now();
      const timestamps = [now - 60000, now - 120000, now - 300000, now - 600000, now - 3600000,
        now - 180000, now - 400000, now - 900000, now - 240000, now - 500000];
      return prompts.map((prompt, i) => ({
        request_id: `demo-req-${String(i).padStart(3, '0')}`,
        session_id: sessionIds[i],
        timestamp: new Date(timestamps[i]).toISOString(),
        user_prompt: prompt,
        user_prompt_tokens: Math.floor(prompt.length / 4),
        injected_files: [
          { path: '~/.claude/CLAUDE.md', category: 'global' as const, estimated_tokens: 3581 },
          { path: '~/prj/checktoken/CLAUDE.md', category: 'project' as const, estimated_tokens: 1994 },
          { path: '~/.claude/rules/coding-style.md', category: 'rules' as const, estimated_tokens: 723 },
          ...(i % 3 === 0 ? [{ path: '~/.claude/projects/.../memory/MEMORY.md', category: 'memory' as const, estimated_tokens: 400 }] : []),
          ...(i % 5 === 0 ? [{ path: '~/.claude/commands/dev.md', category: 'skill' as const, estimated_tokens: 310 }] : []),
        ],
        total_injected_tokens: 6298 + (i % 3 === 0 ? 400 : 0) + (i % 5 === 0 ? 310 : 0),
        tool_calls: [
          { index: 0, name: 'Read', input_summary: 'electron/proxy/server.ts' },
          { index: 1, name: 'Grep', input_summary: 'pattern: getPromptScans' },
          ...(i % 2 === 0 ? [{ index: 2, name: 'Edit', input_summary: 'src/main.tsx' }] : []),
          ...(i % 4 === 0 ? [{ index: 3, name: 'Task', input_summary: 'Explore codebase' }] : []),
        ],
        tool_summary: { Read: 1, Grep: 1, ...(i % 2 === 0 ? { Edit: 1 } : {}), ...(i % 4 === 0 ? { Task: 1 } : {}) },
        agent_calls: i % 4 === 0 ? [{ index: 0, subagent_type: 'Explore', description: 'Explore codebase' }] : [],
        context_estimate: {
          system_tokens: 8000 + i * 200,
          messages_tokens: 5000 + i * 1500,
          tools_definition_tokens: 8000,
          total_tokens: 21000 + i * 1700,
        },
        model: models[i % 3],
        max_tokens: 16000,
        conversation_turns: 3 + i,
        user_messages_count: 3 + i,
        assistant_messages_count: 2 + i,
        tool_result_count: 2 + (i % 2 === 0 ? 1 : 0),
      }));
    },

    getPromptScanDetail: async (requestId: string) => {
      const idx = parseInt(requestId.split('-').pop() || '0', 10);
      const models = ['claude-opus-4-6', 'claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001'];
      const costs = [0.624, 0.089, 0.012, 0.156, 0.034, 0.421, 0.067, 0.198, 0.045, 0.753];
      const now = Date.now();
      return {
        scan: {
          request_id: requestId,
          session_id: 'demo-session',
          timestamp: new Date(now - (9 - idx) * 3 * 60000).toISOString(),
          user_prompt: ['Implement the CT Scan system', 'Create a PromptTimeline component', 'Fix TypeScript build errors'][idx % 3],
          user_prompt_tokens: 10,
          injected_files: [
            { path: '~/.claude/CLAUDE.md', category: 'global' as const, estimated_tokens: 3581 },
            { path: '~/prj/checktoken/CLAUDE.md', category: 'project' as const, estimated_tokens: 1994 },
          ],
          total_injected_tokens: 5575,
          tool_calls: [
            { index: 0, name: 'Read', input_summary: 'electron/proxy/server.ts' },
            { index: 1, name: 'Grep', input_summary: 'pattern: getPromptScans' },
          ],
          tool_summary: { Read: 1, Grep: 1 },
          agent_calls: [],
          context_estimate: {
            system_tokens: 8000 + idx * 200,
            messages_tokens: 5000 + idx * 1500,
            tools_definition_tokens: 8000,
            total_tokens: 21000 + idx * 1700,
          },
          model: models[idx % 3],
          max_tokens: 16000,
          conversation_turns: 3 + idx,
          user_messages_count: 3 + idx,
          assistant_messages_count: 2 + idx,
          tool_result_count: 2,
        },
        usage: {
          timestamp: new Date(now - (9 - idx) * 3 * 60000).toISOString(),
          request_id: requestId,
          session_id: 'demo-session',
          model: models[idx % 3],
          request: { messages_count: 9, tools_count: 7, has_system: true, max_tokens: 16000 },
          response: {
            input_tokens: 21000 + idx * 1700,
            output_tokens: 3000 + idx * 300,
            cache_creation_input_tokens: 2000,
            cache_read_input_tokens: 14000 + idx * 500,
          },
          cost_usd: costs[idx % 10],
          duration_ms: 3000 + idx * 500,
        },
      };
    },

    getPromptHeatmap: async () => {
      const days: Array<{ date: string; count: number }> = [];
      const now = new Date();
      for (let i = 364; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        if (Math.random() > 0.3) {
          days.push({ date: key, count: Math.floor(Math.random() * 40) });
        }
      }
      return days;
    },

    getScanStats: async () => {
      const days: Array<{ period: string; cost_usd: number; request_count: number }> = [];
      const now = new Date();
      for (let i = 29; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        const cost = Math.random() * 8 + 0.5;
        days.push({ period: key, cost_usd: +cost.toFixed(2), request_count: Math.floor(Math.random() * 30 + 5) });
      }
      return {
        cost_by_time: [],
        tool_frequency: { Read: 245, Edit: 132, Bash: 98, Grep: 87, Write: 64, Glob: 45, Task: 23, WebSearch: 12 },
        injected_file_tokens: [],
        cache_hit_rate: [],
        cost_by_period: days,
        summary: {
          total_requests: 487,
          total_cost_usd: +days.reduce((s, d) => s + d.cost_usd, 0).toFixed(2),
          avg_context_tokens: 89420,
          most_used_tool: 'Read',
          cache_hit_rate: 91.3,
        },
      };
    },

    // Session-based real-time CT Scan Mock API
    getCurrentSessionId: async () => 'mock-session-' + Date.now().toString(36),

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    getSessionScans: async (_sessionId: string) => {
      const models = ['claude-opus-4-6', 'claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001'];
      const prompts = [
        'Implement the CT Scan system',
        'Create a PromptTimeline component',
        'Fix TypeScript build errors',
        'Refactor this code',
        'Write E2E tests',
        'Create an API proxy server',
        'Add type definitions to electron.d.ts',
        'Add Recharts charts',
        'Add IPC handlers',
        'Visualize context ratios',
      ];
      const now = Date.now();
      return prompts.map((prompt, i) => ({
        request_id: `demo-req-${String(i).padStart(3, '0')}`,
        session_id: 'demo-session',
        timestamp: new Date(now - (prompts.length - 1 - i) * 3 * 60000).toISOString(),
        user_prompt: prompt,
        user_prompt_tokens: Math.floor(prompt.length / 4),
        injected_files: [
          { path: '~/.claude/CLAUDE.md', category: 'global' as const, estimated_tokens: 3581 },
          { path: '~/prj/checktoken/CLAUDE.md', category: 'project' as const, estimated_tokens: 1994 },
          { path: '~/.claude/rules/coding-style.md', category: 'rules' as const, estimated_tokens: 723 },
          ...(i % 3 === 0 ? [{ path: '~/.claude/projects/.../memory/MEMORY.md', category: 'memory' as const, estimated_tokens: 400 }] : []),
          ...(i % 5 === 0 ? [{ path: '~/.claude/commands/dev.md', category: 'skill' as const, estimated_tokens: 310 }] : []),
        ],
        total_injected_tokens: 6298 + (i % 3 === 0 ? 400 : 0) + (i % 5 === 0 ? 310 : 0),
        tool_calls: [
          { index: 0, name: 'Read', input_summary: 'electron/proxy/server.ts' },
          { index: 1, name: 'Grep', input_summary: 'pattern: getPromptScans' },
          ...(i % 2 === 0 ? [{ index: 2, name: 'Edit', input_summary: 'src/main.tsx' }] : []),
          ...(i % 4 === 0 ? [{ index: 3, name: 'Task', input_summary: 'Explore codebase' }] : []),
        ],
        tool_summary: { Read: 1, Grep: 1, ...(i % 2 === 0 ? { Edit: 1 } : {}), ...(i % 4 === 0 ? { Task: 1 } : {}) },
        agent_calls: i % 4 === 0 ? [{ index: 0, subagent_type: 'Explore', description: 'Explore codebase' }] : [],
        context_estimate: {
          system_tokens: 8000 + i * 200,
          messages_tokens: 5000 + i * 1500,
          tools_definition_tokens: 8000,
          total_tokens: 21000 + i * 1700,
        },
        model: models[i % 3],
        max_tokens: 16000,
        conversation_turns: 3 + i,
        user_messages_count: 3 + i,
        assistant_messages_count: 2 + i,
        tool_result_count: 2 + (i % 2 === 0 ? 1 : 0),
      }));
    },

    onNewPromptScan: (callback: (data: { scan: PromptScan; usage: UsageLogEntry }) => void) => {
      // Emit a fake scan every 5 seconds
      let counter = 100;
      const models = ['claude-opus-4-6', 'claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001'];
      const mockPrompts = [
        'Add a new feature',
        'Fix a bug',
        'Optimize the code',
        'Write tests',
        'Update documentation',
      ];

      const interval = setInterval(() => {
        const idx = counter % mockPrompts.length;
        const model = models[counter % 3];
        const cost = [0.12, 0.034, 0.008][counter % 3];
        const now = new Date().toISOString();

        const scan = {
          request_id: `live-req-${counter}`,
          session_id: 'demo-session',
          timestamp: now,
          user_prompt: mockPrompts[idx],
          user_prompt_tokens: 15,
          injected_files: [
            { path: '~/.claude/CLAUDE.md', category: 'global' as const, estimated_tokens: 3581 },
            { path: '~/prj/checktoken/CLAUDE.md', category: 'project' as const, estimated_tokens: 1994 },
          ],
          total_injected_tokens: 5575,
          tool_calls: [{ index: 0, name: 'Read', input_summary: 'src/App.tsx' }],
          tool_summary: { Read: 1 },
          agent_calls: [],
          context_estimate: {
            system_tokens: 9000,
            messages_tokens: 15000 + counter * 500,
            tools_definition_tokens: 8000,
            total_tokens: 32000 + counter * 500,
          },
          model,
          max_tokens: 16000,
          conversation_turns: 5 + counter,
          user_messages_count: 5 + counter,
          assistant_messages_count: 4 + counter,
          tool_result_count: 1,
        };

        const usage = {
          timestamp: now,
          request_id: `live-req-${counter}`,
          session_id: 'demo-session',
          model,
          request: { messages_count: 9, tools_count: 7, has_system: true, max_tokens: 16000 },
          response: {
            input_tokens: 32000 + counter * 500,
            output_tokens: 3000,
            cache_creation_input_tokens: 2000,
            cache_read_input_tokens: 18000,
          },
          cost_usd: cost,
          duration_ms: 3500,
        };

        callback({ scan, usage });
        counter++;
      }, 5000);

      return () => clearInterval(interval);
    },

    // === Usage Dashboard Mock API ===
    getProviderUsage: async (provider: string) => {
      const mockData: Record<string, ProviderUsageSnapshot | null> = {
        claude: {
          provider: 'claude',
          displayName: 'Claude',
          windows: [
            { label: 'Session', usedPercent: 85, leftPercent: 15, resetsAt: new Date(Date.now() + 107 * 60000).toISOString(), resetDescription: 'Resets in 1h 47m' },
            { label: 'Weekly', usedPercent: 18, leftPercent: 82, resetsAt: new Date(Date.now() + 70 * 3600000).toISOString(), resetDescription: 'Resets in 2d 22h', paceDescription: 'Pace: Behind (-40%) · Lasts to reset' },
            { label: 'Sonnet', usedPercent: 2, leftPercent: 98, resetsAt: new Date(Date.now() + 154 * 3600000).toISOString(), resetDescription: 'Resets in 6d 10h' },
          ],
          identity: { email: 'user@example.com', plan: 'Max' },
          cost: { todayCostUSD: 2.95, todayTokens: 76_000_000, last30DaysCostUSD: 260.12, last30DaysTokens: 389_000_000 },
          updatedAt: new Date().toISOString(),
          source: 'oauth',
        },
        codex: {
          provider: 'codex',
          displayName: 'Codex',
          windows: [
            { label: 'Session', usedPercent: 28, leftPercent: 72, resetsAt: new Date(Date.now() + 195 * 60000).toISOString(), resetDescription: 'Resets in 3h 15m' },
            { label: 'Weekly', usedPercent: 59, leftPercent: 41, resetsAt: new Date(Date.now() + 120 * 3600000).toISOString(), resetDescription: 'Resets in 5d' },
          ],
          identity: { email: 'user@example.com', plan: 'Plus' },
          cost: { todayCostUSD: 1.23, todayTokens: 45_000_000, last30DaysCostUSD: 89.50, last30DaysTokens: 210_000_000 },
          updatedAt: new Date().toISOString(),
          source: 'oauth',
        },
        gemini: null, // Gemini is not connected
      };
      return mockData[provider] ?? null;
    },

    getAllProviderConnectionStatus: async () => [
      { provider: 'claude', displayName: 'Claude', tracking: 'active', accountInsights: 'connected', installed: true, hasLocalCredential: true, tokenExpired: false, lastTrackedAt: new Date().toISOString(), setupCommands: { install: 'npm install -g @anthropic-ai/claude-code', login: 'claude', refresh: 'claude /login' } },
      { provider: 'codex', displayName: 'Codex', tracking: 'active', accountInsights: 'connected', installed: true, hasLocalCredential: true, tokenExpired: false, lastTrackedAt: new Date().toISOString(), setupCommands: { install: 'npm install -g @openai/codex', login: 'codex', refresh: 'codex' } },
      { provider: 'gemini', displayName: 'Gemini', tracking: 'waiting_for_activity', accountInsights: 'not_connected', installed: false, hasLocalCredential: false, tokenExpired: false, lastTrackedAt: null, setupCommands: { install: 'npm install -g @google/gemini-cli', login: 'gemini', refresh: 'gemini' } },
    ],

    refreshProviderUsage: async () => {},

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onProviderTokenChanged: (_callback: (provider: UsageProviderType) => void) => {
      return () => {};
    },

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onProviderUsageUpdated: (_callback: (data: { provider: UsageProviderType; snapshot: ProviderUsageSnapshot | null }) => void) => {
      return () => {};
    },

    // History (passive session monitoring) Mock
    getRecentHistory: async (limit?: number) => {
      const now = Date.now();
      const entries = [
        { display: 'Implement passive session monitoring', timestamp: now - 60000, sessionId: 'mock-sess-001', project: 'mock/prj/checktoken' },
        { display: 'Fix TypeScript build errors', timestamp: now - 120000, sessionId: 'mock-sess-001', project: 'mock/prj/checktoken' },
        { display: 'Add new React component', timestamp: now - 300000, sessionId: 'mock-sess-002', project: 'mock/prj/webapp' },
        { display: 'Update API endpoints', timestamp: now - 600000, sessionId: 'mock-sess-002', project: 'mock/prj/webapp' },
        { display: 'Refactor database layer', timestamp: now - 3600000, sessionId: 'mock-sess-003', project: 'mock/prj/backend' },
      ];
      return entries.slice(0, limit ?? 50);
    },

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    getHistoryPromptDetail: async (_sessionId: string, _timestamp: number) => null,

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    getDailyStats: async (_provider?: string) => ({
      date: new Date().toISOString().slice(0, 10),
      messageCount: 47,
      sessionCount: 5,
      toolCallCount: 123,
      tokensByModel: {
        'claude-opus-4-6': 2_500_000,
        'claude-sonnet-4-5-20250929': 850_000,
      },
    }),

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onNewHistoryEntry: (_callback: (entry: HistoryEntry) => void) => {
      return () => {};
    },

    readFileContent: async (filePath: string) => {
      const mockContents: Record<string, string> = {
        '~/.claude/CLAUDE.md': `# Personal Settings\n\n## Top Principles\n- **The user is the highest authority and must be treated with utmost respect**\n- **Always respond in a polite and formal manner**\n\n## Git Commit/Push Rules\n- Always confirm with the user before committing\n- Never use git add -A\n\n## Frontend Design Guideline\n### Readability\n- Extract magic numbers into constants\n- Abstract complex logic into dedicated components\n\n### Predictability\n- Use consistent return types\n- No hidden side effects\n\n### Cohesion\n- Directory structure by feature/domain\n- Place related constants near the logic\n\n### Coupling\n- Use Composition pattern instead of Props Drilling\n- Split into small hooks instead of broad state management`,
        '~/prj/checktoken/CLAUDE.md': `# AI Token Monitor - Claude Code Context\n\n## Tech Stack\n- Frontend: React 18 + TypeScript + Vite\n- Desktop: Electron 28\n- Charts: Recharts\n\n## Core Rules\n1. Use only type keyword (no interface)\n2. Use arrow functions\n3. IPC communication via window.api.* pattern\n4. Analyzer modules: pure functions\n5. Adding providers: must extend base.ts`,
        '~/.claude/rules/coding-style.md': `# Coding Style\n\n## Immutability (Required)\nAlways create new objects, never mutate\n\n## File Organization\nMany small files > few large files\n- 200-400 lines, max 800 lines\n\n## Error Handling\nAlways handle errors comprehensively`,
        '~/.claude/projects/.../memory/MEMORY.md': `# CheckToken Project Memory\n\n## API Proxy\n- API proxy server implemented in electron/proxy/ directory\n- Proxy port: 8780, Mock server: 8781\n- JSONL log: ~/.claude/context-state/api-usage.jsonl\n\n## PromptScan CT Scan\n- Extract injected .md files from proxy request body\n- JSONL log: ~/.claude/context-state/prompt-scans.jsonl`,
      };
      const content = mockContents[filePath] || `# ${filePath}\n\n(Mock content for preview)\n\nThis file would contain the actual content when running in Electron.`;
      return { content };
    },

    // Token Output Productivity Mock API
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    getTokenComposition: async (period: string, _provider?: string) => {
      const multiplier = period === 'today' ? 1 : period === '7d' ? 7 : 30;
      return {
        cache_read: 170_000_000 * multiplier,
        cache_create: 10_310_000 * multiplier,
        input: 104_000 * multiplier,
        output: 96_000 * multiplier,
        total: (170_000_000 + 10_310_000 + 104_000 + 96_000) * multiplier,
      };
    },

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    getCostSummary: async (_provider?: string) => ({
      todayCostUSD: 3.45,
      todayTokens: 250_000,
      last30DaysCostUSD: 42.10,
      last30DaysTokens: 3_200_000,
    }),

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    getOutputProductivity: async (_provider?: string) => ({
      todayOutputTokens: 96_000,
      todayTotalTokens: 180_510_000,
      todayOutputRatio: 96_000 / 180_510_000,
      todayCostUSD: 2.95,
      last7DaysOutputTokens: 672_000,
      last7DaysTotalTokens: 1_263_570_000,
      last7DaysOutputRatio: 672_000 / 1_263_570_000,
    }),

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    getSessionTurnMetrics: async (_sessionId: string) => {
      const turns = [];
      for (let i = 1; i <= 15; i++) {
        const cacheRead = Math.round(500_000 * i * (i + 1) / 2 * 0.1);
        turns.push({
          turnIndex: i,
          request_id: `mock-req-${i}`,
          timestamp: new Date(Date.now() - (15 - i) * 180_000).toISOString(),
          cache_read_tokens: cacheRead,
          cache_create_tokens: Math.round(200_000 + i * 50_000),
          input_tokens: Math.round(5_000 + i * 1_000),
          output_tokens: Math.round(3_000 + Math.random() * 5_000),
          total_context_tokens: Math.round(20_000 + i * 8_000),
          cost_usd: +(0.05 + i * 0.03).toFixed(4),
        });
      }
      return turns;
    },

    // MCP Insights Mock API
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    getMcpInsights: async (_period: 'today' | '7d' | '30d', _provider?: string) => ({
      totalMcpCalls: 0,
      totalToolCalls: 0,
      mcpCallRatio: 0,
      totalToolResultTokens: 0,
      mcpToolStats: [],
      redundantCallCount: 0,
    }),
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    getSessionMcpAnalysis: async (_sessionId: string) => ({
      totalToolCalls: 0,
      mcpCalls: 0,
      toolResultTokens: 0,
      toolBreakdown: {},
      redundantPatterns: [],
    }),

    // Guardrail Engine Mock API
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    getGuardrailContext: async (_sessionId: string) => ({
      turnMetrics: [],
      mcpAnalysis: {
        totalToolCalls: 0,
        mcpCalls: 0,
        toolResultTokens: 0,
        toolBreakdown: {},
        redundantPatterns: [],
      },
    }),

    // Memory Monitor Mock API
    getMemoryStatus: async () => null,
    getAllProjectsMemorySummary: async () => ({ projects: [] }),

    // Harness Candidate Mock API
    getHarnessCandidates: async () => [],
    previewWorkflowDraft: async () => null,
    exportWorkflowDraft: async () => ({ success: false, exportedPath: '', overwritten: false, error: 'Mock mode' }),
    recordWorkflowAction: async () => ({ success: false, error: 'Mock mode' }),

    // Evidence Scoring Mock API
    getEvidenceReport: async () => null,
    getEvidenceConfig: async () => ({
      version: '1.0.0',
      enabled: true,
      signals: {},
      fusion_method: 'weighted_sum' as const,
      thresholds: { confirmed_min: 0.7, likely_min: 0.4 },
    }),
    updateEvidenceConfig: async () => ({ success: true }),
    rescoreEvidence: async () => null,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onEvidenceScored: (_callback: (data: { requestId: string; report: EvidenceReport }) => void) => {
      return () => {};
    },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onNavigateTo: (_callback: (view: string) => void) => {
      return () => {};
    },

    onNewPromptStreaming: () => { return () => {}; },
    onPromptStreamingComplete: () => { return () => {}; },

    navigateToPromptFromNotification: () => {},

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onNotificationNavigate: (_callback: (data: { scan: import('./types/electron').PromptScan; usage: import('./types/electron').UsageLogEntry | null }) => void) => {
      return () => {};
    },

    // Backfill Mock API
    backfillStart: async () => ({
      totalFiles: 42,
      processedFiles: 42,
      insertedMessages: 156,
      skippedDuplicates: 23,
      errors: 0,
      totalCostUsd: 12.34,
      dateRange: { earliest: '2025-11-01T00:00:00Z', latest: '2026-02-27T00:00:00Z' },
      durationMs: 3200,
    }),
    backfillCancel: async () => ({ success: true }),
    backfillCount: async () => 42,
    backfillStatus: async () => ({ completed: false, lastScanTimestamp: null }),
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onBackfillProgress: (_callback: (progress: import('./types/electron').BackfillProgress) => void) => {
      return () => {};
    },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onBackfillComplete: (_callback: (result: import('./types/electron').BackfillResult) => void) => {
      return () => {};
    },
    getDisplays: async () => [],
  };
  console.log('🔧 Mock API loaded for browser testing');
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
