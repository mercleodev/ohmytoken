import { useState, useCallback, useEffect, useRef } from 'react';
import type { LegacyPromptHistory, LegacyPromptAnalysis, ContextLogs } from '../../types';
import { COLORS, TreemapNode } from './constants';

type UsePromptFeedReturn = {
  promptHistory: LegacyPromptHistory[];
  contextLogs: ContextLogs | null;
  selectedPrompt: string | null;
  promptAnalysis: LegacyPromptAnalysis | null;
  isAnalyzing: boolean;
  analyzePrompt: (promptId: string) => Promise<void>;
  clearAnalysis: () => void;
};

export function usePromptFeed(
  onTreemapUpdate: (data: TreemapNode[], total: number) => void,
): UsePromptFeedReturn {
  const [promptHistory, setPromptHistory] = useState<LegacyPromptHistory[]>([]);
  const [contextLogs, setContextLogs] = useState<ContextLogs | null>(null);
  const [selectedPrompt, setSelectedPrompt] = useState<string | null>(null);
  const [promptAnalysis, setPromptAnalysis] = useState<LegacyPromptAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  const fetchPromptHistory = useCallback(async () => {
    try {
      const history = await window.api.getPromptHistory?.();
      if (history && Array.isArray(history)) {
        setPromptHistory(history);
      }
    } catch {
      const demoHistory: LegacyPromptHistory[] = [
        { id: '1', timestamp: new Date().toISOString(), content: 'What about showing your requests at the top like a live chat? Like breaking news, with 3 lines...', tokens: 1234 },
        { id: '2', timestamp: new Date(Date.now() - 60000).toISOString(), content: 'How about something like webpack-bundle-analyzer?', tokens: 892 },
        { id: '3', timestamp: new Date(Date.now() - 120000).toISOString(), content: 'Oh yeah, make it Treemap style', tokens: 456 },
      ];
      setPromptHistory(demoHistory);
    }
  }, []);

  const fetchContextLogs = useCallback(async () => {
    try {
      const logs = await window.api.getContextLogs?.();
      if (logs) setContextLogs(logs);
    } catch (error) {
      console.error('Get context logs error:', error);
    }
  }, []);

  useEffect(() => {
    fetchPromptHistory();
    fetchContextLogs();

    pollingRef.current = setInterval(() => {
      fetchPromptHistory();
      fetchContextLogs();
    }, 1000);

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [fetchPromptHistory, fetchContextLogs]);

  const analyzePrompt = useCallback(async (promptId: string) => {
    setIsAnalyzing(true);
    setSelectedPrompt(promptId);
    try {
      const analysis = await window.api.analyzePrompt?.(promptId);
      setPromptAnalysis(analysis);

      if (analysis?.response) {
        const { response } = analysis;
        const total = response.inputTokens + response.outputTokens + response.cacheCreationTokens;
        const newData: TreemapNode[] = [
          { name: 'Input Tokens', size: response.inputTokens, tokens: response.inputTokens, percentage: (response.inputTokens / total) * 100, color: COLORS.userInput },
          { name: 'Output Tokens', size: response.outputTokens, tokens: response.outputTokens, percentage: (response.outputTokens / total) * 100, color: COLORS.output },
          { name: 'Cache Creation', size: response.cacheCreationTokens, tokens: response.cacheCreationTokens, percentage: (response.cacheCreationTokens / total) * 100, color: COLORS.cacheCreation },
          { name: 'Cache Read', size: response.cacheReadTokens, tokens: response.cacheReadTokens, percentage: (response.cacheReadTokens / (total + response.cacheReadTokens)) * 100, color: COLORS.cacheRead },
        ].filter(node => (node.size || 0) > 0);
        onTreemapUpdate(newData, total);
      }
    } catch (error) {
      console.error('Analyze error:', error);
      setPromptAnalysis(null);
    } finally {
      setIsAnalyzing(false);
    }
  }, [onTreemapUpdate]);

  const clearAnalysis = useCallback(() => {
    setPromptAnalysis(null);
    setSelectedPrompt(null);
  }, []);

  return { promptHistory, contextLogs, selectedPrompt, promptAnalysis, isAnalyzing, analyzePrompt, clearAnalysis };
}
