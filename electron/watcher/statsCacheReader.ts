import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';

export type DailyStats = {
  date: string;
  messageCount: number;
  sessionCount: number;
  toolCallCount: number;
  tokensByModel: Record<string, number>;
};

export type ModelUsageStats = {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
};

const STATS_CACHE_FILE = path.join(homedir(), '.claude', 'stats-cache.json');

/**
 * Reads today's daily activity stats from stats-cache.json.
 */
export const readTodayStats = (): DailyStats | null => {
  try {
    if (!fs.existsSync(STATS_CACHE_FILE)) return null;

    const content = fs.readFileSync(STATS_CACHE_FILE, 'utf-8');
    const data = JSON.parse(content);

    const today = new Date().toISOString().slice(0, 10);
    const dailyActivity = data?.dailyActivity;
    if (!dailyActivity) return null;

    // dailyActivity can be a map keyed by date or an array
    const todayData = Array.isArray(dailyActivity)
      ? dailyActivity.find((d: any) => d.date === today)
      : dailyActivity[today];

    if (!todayData) return null;

    // Extract tokens by model from modelUsage
    const tokensByModel: Record<string, number> = {};
    const modelUsage = data?.modelUsage;
    if (modelUsage && typeof modelUsage === 'object') {
      for (const [model, stats] of Object.entries(modelUsage)) {
        const s = stats as any;
        tokensByModel[model] = (s.totalTokens ?? 0) || ((s.inputTokens ?? 0) + (s.outputTokens ?? 0));
      }
    }

    return {
      date: today,
      messageCount: todayData.messageCount ?? todayData.messages ?? 0,
      sessionCount: todayData.sessionCount ?? todayData.sessions ?? 0,
      toolCallCount: todayData.toolCallCount ?? todayData.toolCalls ?? 0,
      tokensByModel,
    };
  } catch (err) {
    console.error('[StatsCacheReader] Error reading today stats:', err);
    return null;
  }
};

/**
 * Reads model usage stats from stats-cache.json.
 */
export const readModelUsage = (): Record<string, ModelUsageStats> => {
  try {
    if (!fs.existsSync(STATS_CACHE_FILE)) return {};

    const content = fs.readFileSync(STATS_CACHE_FILE, 'utf-8');
    const data = JSON.parse(content);
    const modelUsage = data?.modelUsage;

    if (!modelUsage || typeof modelUsage !== 'object') return {};

    const result: Record<string, ModelUsageStats> = {};
    for (const [model, stats] of Object.entries(modelUsage)) {
      const s = stats as any;
      result[model] = {
        totalTokens: s.totalTokens ?? ((s.inputTokens ?? 0) + (s.outputTokens ?? 0)),
        inputTokens: s.inputTokens ?? 0,
        outputTokens: s.outputTokens ?? 0,
        cacheReadTokens: s.cacheReadTokens ?? 0,
        cacheCreationTokens: s.cacheCreationTokens ?? 0,
      };
    }

    return result;
  } catch (err) {
    console.error('[StatsCacheReader] Error reading model usage:', err);
    return {};
  }
};
