import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { homedir } from 'os';

// Token usage type
export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
};

// Message type
export type ParsedMessage = {
  uuid: string;
  timestamp: string;
  type: 'user' | 'assistant' | 'system' | 'summary';
  role?: string;
  content?: string;
  model?: string;
  usage?: TokenUsage;
  thinkingContent?: string;
  sessionId?: string;
};

// Session analysis result
export type SessionAnalysis = {
  sessionId: string;
  startTime: string;
  endTime: string;
  messageCount: number;
  totalUsage: TokenUsage;
  messages: ParsedMessage[];
  averageTokensPerRequest: number;
};

// Get Claude projects path
export const getClaudeProjectsPath = (): string => {
  return path.join(homedir(), '.claude', 'projects');
};

// Get log files for a specific project
export const getProjectLogFiles = (projectPath: string): string[] => {
  const projectsDir = getClaudeProjectsPath();

  // Convert path to Claude project directory format
  const encodedPath = projectPath.replace(/\//g, '-');
  const fullPath = path.join(projectsDir, encodedPath);

  if (!fs.existsSync(fullPath)) {
    return [];
  }

  return fs.readdirSync(fullPath)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => path.join(fullPath, f))
    .sort((a, b) => {
      const statA = fs.statSync(a);
      const statB = fs.statSync(b);
      return statB.mtime.getTime() - statA.mtime.getTime();
    });
};

// Get log files for the current project (based on cwd)
export const getCurrentProjectLogFiles = (): string[] => {
  const cwd = process.cwd();
  return getProjectLogFiles(cwd);
};

// Parse JSONL file
export const parseLogFile = async (filePath: string): Promise<ParsedMessage[]> => {
  const messages: ParsedMessage[] = [];

  if (!fs.existsSync(filePath)) {
    return messages;
  }

  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    try {
      const entry = JSON.parse(line);
      const parsed = parseEntry(entry);
      if (parsed) {
        messages.push(parsed);
      }
    } catch (e) {
      // Ignore JSON parsing errors
    }
  }

  return messages;
};

// Parse a single log entry
const parseEntry = (entry: any): ParsedMessage | null => {
  // Skip summary, file-history-snapshot, etc.
  if (entry.type === 'summary' || entry.type === 'file-history-snapshot') {
    return null;
  }

  const result: ParsedMessage = {
    uuid: entry.uuid || '',
    timestamp: entry.timestamp || new Date().toISOString(),
    type: entry.type || 'unknown',
    sessionId: entry.sessionId,
  };

  // User message
  if (entry.type === 'user' && entry.message) {
    result.role = 'user';

    const content = entry.message.content;
    if (typeof content === 'string') {
      result.content = content;
    } else if (Array.isArray(content)) {
      // Messages containing tool_result blocks are tool responses, not real user input
      const hasToolResult = content.some((c: any) => c.type === 'tool_result');
      if (hasToolResult) return null;

      // Extract text-type blocks from array
      const textParts = content
        .filter((c: any) => c.type === 'text' && c.text)
        .map((c: any) => c.text);

      if (textParts.length > 0) {
        result.content = textParts.join('\n');
      } else {
        return null;
      }
    }
  }

  // Assistant message
  if (entry.type === 'assistant' && entry.message) {
    result.role = 'assistant';
    result.model = entry.message.model;

    // Extract content
    if (entry.message.content && Array.isArray(entry.message.content)) {
      const textContent = entry.message.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('\n');
      result.content = textContent;

      // Extract thinking
      const thinkingContent = entry.message.content
        .filter((c: any) => c.type === 'thinking')
        .map((c: any) => c.thinking)
        .join('\n');
      if (thinkingContent) {
        result.thinkingContent = thinkingContent;
      }
    }

    // Token usage
    if (entry.message.usage) {
      result.usage = {
        inputTokens: entry.message.usage.input_tokens || 0,
        outputTokens: entry.message.usage.output_tokens || 0,
        cacheCreationTokens: entry.message.usage.cache_creation_input_tokens || 0,
        cacheReadTokens: entry.message.usage.cache_read_input_tokens || 0,
        totalTokens: 0,
      };
      result.usage.totalTokens =
        result.usage.inputTokens +
        result.usage.outputTokens +
        result.usage.cacheCreationTokens;
    }
  }

  return result;
};

// Analyze session
export const analyzeSession = (messages: ParsedMessage[]): SessionAnalysis | null => {
  if (messages.length === 0) return null;

  const assistantMessages = messages.filter(m => m.role === 'assistant' && m.usage);

  const totalUsage: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
  };

  for (const msg of assistantMessages) {
    if (msg.usage) {
      totalUsage.inputTokens += msg.usage.inputTokens;
      totalUsage.outputTokens += msg.usage.outputTokens;
      totalUsage.cacheCreationTokens += msg.usage.cacheCreationTokens;
      totalUsage.cacheReadTokens += msg.usage.cacheReadTokens;
      totalUsage.totalTokens += msg.usage.totalTokens;
    }
  }

  const timestamps = messages
    .filter(m => m.timestamp)
    .map(m => new Date(m.timestamp).getTime())
    .sort((a, b) => a - b);

  return {
    sessionId: messages[0]?.sessionId || '',
    startTime: timestamps.length > 0 ? new Date(timestamps[0]).toISOString() : '',
    endTime: timestamps.length > 0 ? new Date(timestamps[timestamps.length - 1]).toISOString() : '',
    messageCount: messages.length,
    totalUsage,
    messages,
    averageTokensPerRequest: assistantMessages.length > 0
      ? Math.round(totalUsage.totalTokens / assistantMessages.length)
      : 0,
  };
};

// Format token usage
export const formatTokenUsage = (usage: TokenUsage): string => {
  const lines = [
    `Token Usage Analysis`,
    `────────────────────`,
    `Input tokens:     ${usage.inputTokens.toLocaleString()}`,
    `Output tokens:    ${usage.outputTokens.toLocaleString()}`,
    `Cache creation:   ${usage.cacheCreationTokens.toLocaleString()}`,
    `Cache read:       ${usage.cacheReadTokens.toLocaleString()} (cheap)`,
    `────────────────────`,
    `Total tokens:     ${usage.totalTokens.toLocaleString()}`,
  ];
  return lines.join('\n');
};

// Analyze tokens for the most recent N requests
export const analyzeRecentRequests = async (
  logFiles: string[],
  count: number = 10
): Promise<ParsedMessage[]> => {
  const allMessages: ParsedMessage[] = [];

  for (const file of logFiles) {
    const messages = await parseLogFile(file);
    allMessages.push(...messages);

    // Stop once enough messages are collected
    const assistantMessages = allMessages.filter(m => m.role === 'assistant' && m.usage);
    if (assistantMessages.length >= count) {
      break;
    }
  }

  // Filter to assistant messages only and return the most recent N
  return allMessages
    .filter(m => m.role === 'assistant' && m.usage)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, count);
};
