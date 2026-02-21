/**
 * Real-Time Watcher Module
 *
 * Watches Claude Code log files in real time
 * and detects new token usage events.
 */

import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { homedir } from 'os';
import { parseLogFile, ParsedMessage, TokenUsage } from './logParser';
import { countTokens } from './tokenCounter';
import { TokenBreakdown, ScanEvent } from './index';

// Watcher event type
export type WatcherEvent = {
  type: 'new_request' | 'new_response' | 'token_update' | 'session_start' | 'session_end';
  timestamp: string;
  data: ParsedMessage | TokenBreakdown | null;
};

// Watcher options
export type WatcherOptions = {
  projectPath?: string;
  pollInterval?: number; // ms
  onEvent?: (event: WatcherEvent) => void;
};

export class RealTimeWatcher extends EventEmitter {
  private projectPath: string;
  private pollInterval: number;
  private watchedFiles: Map<string, { size: number; lastLine: number }> = new Map();
  private intervalId: NodeJS.Timeout | null = null;
  private isWatching = false;

  constructor(options: WatcherOptions = {}) {
    super();
    this.projectPath = options.projectPath || this.detectCurrentProject();
    this.pollInterval = options.pollInterval || 1000; // Check every 1 second

    if (options.onEvent) {
      this.on('event', options.onEvent);
    }
  }

  // Detect current project path
  private detectCurrentProject(): string {
    const projectsDir = path.join(homedir(), '.claude', 'projects');

    // Find the most recently modified project
    if (fs.existsSync(projectsDir)) {
      const projects = fs.readdirSync(projectsDir)
        .filter(f => fs.statSync(path.join(projectsDir, f)).isDirectory())
        .map(f => ({
          name: f,
          mtime: fs.statSync(path.join(projectsDir, f)).mtime.getTime(),
        }))
        .sort((a, b) => b.mtime - a.mtime);

      if (projects.length > 0) {
        return path.join(projectsDir, projects[0].name);
      }
    }

    return projectsDir;
  }

  // Start watching
  start(): void {
    if (this.isWatching) return;

    this.isWatching = true;
    console.log(`[Watcher] Starting to watch: ${this.projectPath}`);

    // Record initial file states
    this.initializeFileStates();

    // Start periodic polling
    this.intervalId = setInterval(() => {
      this.checkForUpdates();
    }, this.pollInterval);

    this.emit('event', {
      type: 'session_start',
      timestamp: new Date().toISOString(),
      data: null,
    });
  }

  // Stop watching
  stop(): void {
    if (!this.isWatching) return;

    this.isWatching = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.emit('event', {
      type: 'session_end',
      timestamp: new Date().toISOString(),
      data: null,
    });

    console.log('[Watcher] Stopped watching');
  }

  // Initialize file states
  private initializeFileStates(): void {
    if (!fs.existsSync(this.projectPath)) return;

    const files = fs.readdirSync(this.projectPath)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => path.join(this.projectPath, f));

    for (const file of files) {
      const stats = fs.statSync(file);
      const lineCount = this.countLines(file);
      this.watchedFiles.set(file, {
        size: stats.size,
        lastLine: lineCount,
      });
    }
  }

  // Count lines in a file
  private countLines(filePath: string): number {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return content.split('\n').filter(l => l.trim()).length;
    } catch {
      return 0;
    }
  }

  // Check for updates
  private async checkForUpdates(): Promise<void> {
    if (!fs.existsSync(this.projectPath)) return;

    const currentFiles = fs.readdirSync(this.projectPath)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => path.join(this.projectPath, f));

    for (const file of currentFiles) {
      const stats = fs.statSync(file);
      const prevState = this.watchedFiles.get(file);

      if (!prevState) {
        // New file
        const lineCount = this.countLines(file);
        this.watchedFiles.set(file, {
          size: stats.size,
          lastLine: lineCount,
        });
        continue;
      }

      // Check for new content if file size has changed
      if (stats.size > prevState.size) {
        const newLines = await this.getNewLines(file, prevState.lastLine);
        this.processNewLines(newLines);

        // Update state
        this.watchedFiles.set(file, {
          size: stats.size,
          lastLine: prevState.lastLine + newLines.length,
        });
      }
    }
  }

  // Get new lines
  private async getNewLines(filePath: string, startLine: number): Promise<string[]> {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());
      return lines.slice(startLine);
    } catch {
      return [];
    }
  }

  // Process new lines
  private processNewLines(lines: string[]): void {
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        this.processEntry(entry);
      } catch {
        // Ignore JSON parsing errors
      }
    }
  }

  // Process log entry
  private processEntry(entry: any): void {
    // User message
    if (entry.type === 'user' && entry.message) {
      const content = typeof entry.message.content === 'string'
        ? entry.message.content
        : JSON.stringify(entry.message.content);

      const event: WatcherEvent = {
        type: 'new_request',
        timestamp: entry.timestamp || new Date().toISOString(),
        data: {
          uuid: entry.uuid,
          timestamp: entry.timestamp || new Date().toISOString(),
          type: 'user',
          role: 'user',
          content,
          sessionId: entry.sessionId,
        },
      };

      this.emit('event', event);
      this.emit('request', event.data);
    }

    // Assistant response
    if (entry.type === 'assistant' && entry.message?.usage) {
      const usage: TokenUsage = {
        inputTokens: entry.message.usage.input_tokens || 0,
        outputTokens: entry.message.usage.output_tokens || 0,
        cacheCreationTokens: entry.message.usage.cache_creation_input_tokens || 0,
        cacheReadTokens: entry.message.usage.cache_read_input_tokens || 0,
        totalTokens: 0,
      };
      usage.totalTokens = usage.inputTokens + usage.outputTokens + usage.cacheCreationTokens;

      const event: WatcherEvent = {
        type: 'new_response',
        timestamp: entry.timestamp || new Date().toISOString(),
        data: {
          uuid: entry.uuid,
          timestamp: entry.timestamp || new Date().toISOString(),
          type: 'assistant',
          role: 'assistant',
          model: entry.message.model,
          usage,
          sessionId: entry.sessionId,
        },
      };

      this.emit('event', event);
      this.emit('response', event.data);
      this.emit('token_update', usage);
    }
  }

  // Current watcher status
  getStatus(): { isWatching: boolean; projectPath: string; watchedFiles: number } {
    return {
      isWatching: this.isWatching,
      projectPath: this.projectPath,
      watchedFiles: this.watchedFiles.size,
    };
  }
}

// Singleton instance
let watcherInstance: RealTimeWatcher | null = null;

export const getWatcher = (options?: WatcherOptions): RealTimeWatcher => {
  if (!watcherInstance) {
    watcherInstance = new RealTimeWatcher(options);
  }
  return watcherInstance;
};

export const startWatching = (options?: WatcherOptions): RealTimeWatcher => {
  const watcher = getWatcher(options);
  watcher.start();
  return watcher;
};

export const stopWatching = (): void => {
  if (watcherInstance) {
    watcherInstance.stop();
  }
};
