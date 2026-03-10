// CLI PTY-based Claude usage fetcher (Strategy 3)
// Creates PTY using macOS `script` command without node-pty

import { spawn, ChildProcess } from 'child_process';
import { ProviderUsageSnapshot, UsageWindow } from '../types';

const TIMEOUT_MS = 35000;

// Strip ANSI escape codes (CSI, OSC, DEC private modes, etc.)
const stripAnsi = (text: string): string =>
  text
    .replace(/\x1B\[(\d+)C/g, (_m, n) => ' '.repeat(parseInt(n, 10)))  // Cursor forward → spaces
    .replace(/\x1B\[[\?]?[0-9;]*[a-zA-Z]/g, '')  // CSI sequences including DEC private modes
    .replace(/\x1B\[[0-9;]*[hlm]/g, '')            // Set/reset mode sequences
    .replace(/\x1B\][^\x07]*\x07/g, '')            // OSC sequences
    .replace(/\x1B\(B/g, '')                       // Character set
    .replace(/\x1B\[\?[0-9]+[hl]/g, '')            // DEC private mode set/reset
    .replace(/\r/g, '');

// Parse usage from CLI /usage output
// Parse a window block: looks for "XX% used" or "XX% remaining"
// PTY output has cursor movement codes that remove spaces between words,
// so we use very loose patterns (e.g. "Curre" + "t" + "session" → "Curretsession")
const parseWindowBlock = (text: string, labelPattern: RegExp, windowLabel: string): UsageWindow | null => {
  // Try "XX% used" format (newer CLI) — allow any chars between label and percent
  const usedMatch = text.match(new RegExp(labelPattern.source + '[\\s\\S]*?(\\d+)%\\s*used', 'i'));
  if (usedMatch) {
    const used = parseInt(usedMatch[1], 10);
    const resetMatch = text.match(new RegExp(labelPattern.source + '[\\s\\S]*?Reset?s?\\s*([^\\n]+)', 'i'));
    return {
      label: windowLabel,
      usedPercent: used,
      leftPercent: 100 - used,
      resetsAt: null,
      resetDescription: resetMatch ? `Resets ${resetMatch[1].trim()}` : '',
    };
  }

  // Try "XX% remaining" format (older CLI)
  const remainMatch = text.match(new RegExp(labelPattern.source + '[\\s\\S]*?(\\d+)%\\s*remaining', 'i'));
  if (remainMatch) {
    const remaining = parseInt(remainMatch[1], 10);
    const resetMatch = text.match(new RegExp(labelPattern.source + '[\\s\\S]*?Reset?s?\\s*([^\\n]+)', 'i'));
    return {
      label: windowLabel,
      usedPercent: 100 - remaining,
      leftPercent: remaining,
      resetsAt: null,
      resetDescription: resetMatch ? `Resets ${resetMatch[1].trim()}` : '',
    };
  }

  return null;
};

const parseUsageOutput = (raw: string): ProviderUsageSnapshot | null => {
  const text = stripAnsi(raw);
  const windows: UsageWindow[] = [];

  // Strategy 1: Try structured label-based parsing
  const session = parseWindowBlock(text, /(?:Current\s*session|5h\s*window|Curre.{0,5}t\s*session)/, 'Session');
  if (session) windows.push(session);

  const weekly = parseWindowBlock(text, /(?:Current\s*week|7.?day)/, 'Weekly');
  if (weekly) windows.push(weekly);

  const sonnet = parseWindowBlock(text, /Sonnet\s*(?:only)?/, 'Sonnet');
  if (sonnet) windows.push(sonnet);

  // Strategy 2: If no windows found, try simpler "XX% used" extraction
  // PTY output may mangle labels, so just find all "N% used" occurrences
  if (windows.length === 0) {
    const allUsed = [...text.matchAll(/(\d+)%\s*used/gi)];
    const allRemain = [...text.matchAll(/(\d+)%\s*remaining/gi)];
    // Extract reset descriptions: "Reset/Resets <time info>"
    // PTY may mangle to "Rese s" or "Reset s" so use loose pattern
    const allResets = [...text.matchAll(/Reset?s?\s+(.+?)(?:\n|$)/gi)];
    const labels = ['Session', 'Weekly', 'Sonnet'];

    for (let i = 0; i < allUsed.length && i < labels.length; i++) {
      const used = parseInt(allUsed[i][1], 10);
      const resetDesc = allResets[i] ? `Resets ${allResets[i][1].trim()}` : '';
      windows.push({
        label: labels[i],
        usedPercent: used,
        leftPercent: 100 - used,
        resetsAt: null,
        resetDescription: resetDesc,
      });
    }
    for (let i = 0; i < allRemain.length && windows.length < labels.length; i++) {
      const remaining = parseInt(allRemain[i][1], 10);
      const idx = windows.length;
      const resetDesc = allResets[idx] ? `Resets ${allResets[idx][1].trim()}` : '';
      windows.push({
        label: labels[idx],
        usedPercent: 100 - remaining,
        leftPercent: remaining,
        resetsAt: null,
        resetDescription: resetDesc,
      });
    }
  }

  if (windows.length === 0) {
    console.log('[CLI Probe] Parse failed, stripped text sample:', text.slice(-400));
    return null;
  }

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
    let usageConfirmed = false;
    let usageParsing = false;
    let resolved = false;
    let proc: ChildProcess;

    const done = (result: ProviderUsageSnapshot | null) => {
      if (resolved) return;
      resolved = true;
      try { proc?.kill(); } catch { /* ignore */ }
      resolve(result);
    };

    const timer = setTimeout(() => {
      console.warn(`[CLI Probe] Timeout after ${TIMEOUT_MS}ms, output length: ${output.length}`);
      console.warn('[CLI Probe] Timeout raw (last 500):', JSON.stringify(output.slice(-500)));
      const parsed = parseUsageOutput(output);
      console.log('[CLI Probe] Timeout parse:', parsed ? `${parsed.windows.length} windows` : 'null');
      done(parsed);
    }, TIMEOUT_MS);

    try {
      // Remove CLAUDECODE env var to prevent "nested session" error
      // when OhMyToken is launched from within a Claude Code session
      const { CLAUDECODE: _cc, CLAUDE_CODE: _cc2, ...cleanEnv } = process.env;
      const ptyEnv = { ...cleanEnv, TERM: 'dumb', NO_COLOR: '1' };

      // Try `script -q /dev/null` first (works in real terminals),
      // fall back to Python pty module (works in non-TTY / Electron)
      const useScript = process.stdin.isTTY ?? false;
      if (useScript) {
        console.log('[CLI Probe] Spawning via macOS script PTY');
        proc = spawn('script', ['-q', '/dev/null', 'claude', '--allowed-tools', ''], {
          env: ptyEnv,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } else {
        console.log('[CLI Probe] Spawning via Python pty (non-TTY environment)');
        const pyScript = [
          'import pty, os, sys',
          'pid, fd = pty.openpty()',
          'child = os.fork()',
          'if child == 0:',
          '    os.setsid()',
          '    os.dup2(os.open(os.ttyname(fd), os.O_RDWR), 0)',
          '    os.dup2(0, 1)',
          '    os.dup2(0, 2)',
          '    os.close(fd)',
          '    os.close(pid)',
          '    os.execvp("claude", ["claude", "--allowed-tools", ""])',
          'else:',
          '    os.close(fd)',
          '    import select',
          '    while True:',
          '        r, _, _ = select.select([pid, 0], [], [], 0.1)',
          '        if pid in r:',
          '            try:',
          '                data = os.read(pid, 4096)',
          '                if not data: break',
          '                sys.stdout.buffer.write(data)',
          '                sys.stdout.buffer.flush()',
          '            except OSError: break',
          '        if 0 in r:',
          '            data = os.read(0, 4096)',
          '            if data: os.write(pid, data)',
          '    os.waitpid(child, 0)',
        ].join('\n');
        proc = spawn('python3', ['-c', pyScript], {
          env: ptyEnv,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      }

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
        // Use multiline flag and also check for ❯ anywhere in the chunk
        if (!usageSent && (/[>❯]\s*$/m.test(cleaned) || cleaned.includes('❯'))) {
          usageSent = true;
          console.log('[CLI Probe] Prompt detected, sending /usage');
          // Send /usage with carriage return; add small delay for PTY readiness
          setTimeout(() => {
            proc.stdin?.write('/usage\r');
          }, 800);
        }

        // Autocomplete menu detected → press Enter to select /usage
        if (usageSent && !usageConfirmed && cleaned.includes('Show plan usage limits')) {
          usageConfirmed = true;
          console.log('[CLI Probe] Autocomplete detected, confirming selection');
          proc.stdin?.write('\r');
        }

        // Detect usage data: box end (╰/└) or "% used"/"% remaining" patterns
        const hasUsageData = cleaned.includes('╰') || cleaned.includes('└')
          || /\d+%\s*used/i.test(cleaned) || /\d+%\s*remaining/i.test(cleaned);
        if (usageSent && hasUsageData && !usageParsing) {
          usageParsing = true;
          console.log('[CLI Probe] Usage data detected, waiting for complete output');
          // Wait 2s for all usage data to arrive before parsing
          setTimeout(() => {
            clearTimeout(timer);
            proc.stdin?.write('\x1b'); // Press Escape to close usage panel
            setTimeout(() => {
              proc.stdin?.write('/exit\n');
              const parsed = parseUsageOutput(output);
              console.log('[CLI Probe] Parsed result:', parsed ? JSON.stringify(parsed.windows) : 'null');
              done(parsed);
            }, 500);
          }, 2000);
        }
      };

      proc.stdout?.on('data', handleData);
      proc.stderr?.on('data', handleData);

      proc.on('error', (err) => {
        console.error('[CLI Probe] Spawn error:', err.message);
        clearTimeout(timer);
        done(null);
      });

      proc.on('close', (code) => {
        console.log(`[CLI Probe] Process closed with code ${code}, output length: ${output.length}`);
        console.log('[CLI Probe] Raw output:', JSON.stringify(output.slice(0, 500)));
        clearTimeout(timer);
        if (!resolved) {
          const parsed = parseUsageOutput(output);
          console.log('[CLI Probe] Close parse result:', parsed ? `${parsed.windows.length} windows` : 'null');
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
