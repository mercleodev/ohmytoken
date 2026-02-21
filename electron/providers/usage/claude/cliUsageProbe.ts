// CLI PTY-based Claude usage fetcher (Strategy 3)
// Creates PTY using macOS `script` command without node-pty

import { spawn, ChildProcess } from 'child_process';
import { ProviderUsageSnapshot, UsageWindow } from '../types';

const TIMEOUT_MS = 20000;

// Strip ANSI escape codes
const stripAnsi = (text: string): string =>
  text
    .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1B\][^\x07]*\x07/g, '')
    .replace(/\x1B\(B/g, '')
    .replace(/\r/g, '');

// Parse usage from CLI /usage output
const parseUsageOutput = (raw: string): ProviderUsageSnapshot | null => {
  const text = stripAnsi(raw);
  const windows: UsageWindow[] = [];

  // "Current session" or "5h window" → XX% remaining
  const sessionMatch = text.match(/(?:Current session|5h window)[^\n]*\n\s*(\d+)%\s*remaining/i);
  if (sessionMatch) {
    const remaining = parseInt(sessionMatch[1], 10);
    const used = 100 - remaining;
    const resetMatch = text.match(/Current session[^\n]*\n[^\n]*\n\s*Resets?\s+(?:at\s+)?([^\n]+)/i);
    windows.push({
      label: 'Session',
      usedPercent: used,
      leftPercent: remaining,
      resetsAt: null,
      resetDescription: resetMatch ? `Resets ${resetMatch[1].trim()}` : '',
    });
  }

  // "Current week" → XX% remaining
  const weeklyMatch = text.match(/(?:Current week|7.?day)[^\n]*\n\s*(\d+)%\s*remaining/i);
  if (weeklyMatch) {
    const remaining = parseInt(weeklyMatch[1], 10);
    const used = 100 - remaining;
    const resetMatch = text.match(/(?:Current week|7.?day)[^\n]*\n[^\n]*\n\s*Resets?\s+(?:at\s+)?([^\n]+)/i);
    windows.push({
      label: 'Weekly',
      usedPercent: used,
      leftPercent: remaining,
      resetsAt: null,
      resetDescription: resetMatch ? `Resets ${resetMatch[1].trim()}` : '',
    });
  }

  if (windows.length === 0) return null;

  // Extract Account / Plan
  const accountMatch = text.match(/Account:\s*(.+)/i);
  const planMatch = text.match(/Plan:\s*(.+)/i) ?? text.match(/Tier:\s*(.+)/i);

  return {
    provider: 'claude',
    displayName: 'Claude',
    windows,
    identity: {
      email: accountMatch ? accountMatch[1].trim() : null,
      plan: planMatch ? planMatch[1].trim() : null,
    },
    cost: null,
    updatedAt: new Date().toISOString(),
    source: 'cli-pty',
  };
};

// Run claude in PTY via macOS script command → parse /usage
export const fetchClaudeUsageViaCLI = (): Promise<ProviderUsageSnapshot | null> => {
  return new Promise((resolve) => {
    let output = '';
    let usageSent = false;
    let resolved = false;
    let proc: ChildProcess;

    const done = (result: ProviderUsageSnapshot | null) => {
      if (resolved) return;
      resolved = true;
      try { proc?.kill(); } catch { /* ignore */ }
      resolve(result);
    };

    const timer = setTimeout(() => {
      console.warn('[CLI Probe] Timeout');
      const parsed = parseUsageOutput(output);
      done(parsed);
    }, TIMEOUT_MS);

    try {
      // macOS: create PTY with script -q /dev/null
      proc = spawn('script', ['-q', '/dev/null', 'claude', '--allowed-tools', ''], {
        env: { ...process.env, TERM: 'dumb', NO_COLOR: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const handleData = (chunk: Buffer) => {
        const text = chunk.toString();
        output += text;
        const cleaned = stripAnsi(text);

        // Auto-respond to initial prompts
        if (/trust|Trust/i.test(cleaned)) {
          proc.stdin?.write('y\n');
        }
        if (/workspace|Workspace/i.test(cleaned) && !/usage/i.test(cleaned)) {
          proc.stdin?.write('y\n');
        }
        if (/telemetry|Telemetry/i.test(cleaned)) {
          proc.stdin?.write('y\n');
        }

        // Detect prompt → send /usage
        if (!usageSent && /[>❯$]\s*$/.test(cleaned)) {
          usageSent = true;
          proc.stdin?.write('/usage\n');
        }

        // Detect usage box end (╰) → parse and exit
        if (usageSent && (cleaned.includes('╰') || cleaned.includes('└'))) {
          clearTimeout(timer);
          // Wait briefly before parsing (wait for output to complete)
          setTimeout(() => {
            proc.stdin?.write('/exit\n');
            const parsed = parseUsageOutput(output);
            console.log('[CLI Probe] Parsed result:', parsed ? `${parsed.windows.length} windows` : 'null');
            done(parsed);
          }, 500);
        }
      };

      proc.stdout?.on('data', handleData);
      proc.stderr?.on('data', handleData);

      proc.on('error', (err) => {
        console.error('[CLI Probe] Spawn error:', err.message);
        clearTimeout(timer);
        done(null);
      });

      proc.on('close', () => {
        clearTimeout(timer);
        if (!resolved) {
          const parsed = parseUsageOutput(output);
          done(parsed);
        }
      });
    } catch (err) {
      clearTimeout(timer);
      console.error('[CLI Probe] Error:', err);
      done(null);
    }
  });
};
