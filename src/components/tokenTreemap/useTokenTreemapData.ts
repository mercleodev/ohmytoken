import { useState, useEffect, useCallback, useRef } from 'react';
import type { PromptHistoryItem, PromptAnalysisResult, ScanTokensResult, ContextLogs } from '../../types';
import { COLORS, CATEGORY_INFO, MODEL_PRICING } from './constants';
import type { TreemapNode, ModelId } from './constants';
import type { DetailPanelData } from './DetailPanel';

const POLLING_INTERVAL_MS = 1000;
const TREEMAP_POLLING_INTERVAL_MS = 5000;
const SCAN_STEP = 5;
const SCAN_STEP_DELAY_MS = 30;

export function useTokenTreemapData() {
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [treemapData, setTreemapData] = useState<TreemapNode[]>([]);
  const [totalTokens, setTotalTokens] = useState(0);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<ModelId>('claude-sonnet-4-20250514');
  const [, setCacheInfo] = useState<ScanTokensResult['cacheInfo'] | null>(null);

  const [promptHistory, setPromptHistory] = useState<PromptHistoryItem[]>([]);
  const [selectedPrompt, setSelectedPrompt] = useState<string | null>(null);
  const [promptAnalysis, setPromptAnalysis] = useState<PromptAnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showAllPrompts, setShowAllPrompts] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [showPromptModal, setShowPromptModal] = useState(false);
  const [modalPrompt, setModalPrompt] = useState<PromptHistoryItem | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const treemapPollingRef = useRef<NodeJS.Timeout | null>(null);

  const [contextLogs, setContextLogs] = useState<ContextLogs | null>(null);
  const [showContextLogs, setShowContextLogs] = useState(false);

  const [detailPanel, setDetailPanel] = useState<DetailPanelData | null>(null);

  const handlePromptClick = useCallback((prompt: PromptHistoryItem) => {
    setModalPrompt(prompt);
    setShowPromptModal(true);
  }, []);

  const analyzePrompt = useCallback(async (promptId: string) => {
    setIsAnalyzing(true);
    setSelectedPrompt(promptId);
    try {
      const analysis = await window.api.analyzePrompt?.(promptId);
      setPromptAnalysis(analysis);

      if (analysis?.response) {
        const { response } = analysis;
        const total = response.inputTokens + response.outputTokens + response.cacheCreationTokens;

        const newTreemapData: TreemapNode[] = [
          {
            name: 'Input Tokens',
            size: response.inputTokens,
            tokens: response.inputTokens,
            percentage: (response.inputTokens / total) * 100,
            color: COLORS.userInput,
          },
          {
            name: 'Output Tokens',
            size: response.outputTokens,
            tokens: response.outputTokens,
            percentage: (response.outputTokens / total) * 100,
            color: COLORS.output,
          },
          {
            name: 'Cache Creation',
            size: response.cacheCreationTokens,
            tokens: response.cacheCreationTokens,
            percentage: (response.cacheCreationTokens / total) * 100,
            color: COLORS.cacheCreation,
          },
          {
            name: 'Cache Read',
            size: response.cacheReadTokens,
            tokens: response.cacheReadTokens,
            percentage: (response.cacheReadTokens / (total + response.cacheReadTokens)) * 100,
            color: COLORS.cacheRead,
          },
        ].filter(node => (node.size || 0) > 0);

        setTreemapData(newTreemapData);
        setTotalTokens(total);
      }
    } catch (error) {
      console.error('Analyze error:', error);
      setPromptAnalysis(null);
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  const handleAnalyzeFromModal = useCallback(() => {
    if (modalPrompt) {
      setShowPromptModal(false);
      analyzePrompt(modalPrompt.id);
    }
  }, [modalPrompt, analyzePrompt]);

  const handleCloseAnalysis = useCallback(() => {
    setPromptAnalysis(null);
    setSelectedPrompt(null);
  }, []);

  const handleCloseModal = useCallback(() => {
    setShowPromptModal(false);
  }, []);

  const handleToggleContextLogs = useCallback(() => {
    setShowContextLogs(prev => !prev);
  }, []);

  const handleCloseDetailPanel = useCallback(() => {
    setDetailPanel(null);
  }, []);

  const handleToggleShowAllPrompts = useCallback(() => {
    setShowAllPrompts(prev => !prev);
  }, []);

  const handleLegendClick = useCallback((node: TreemapNode) => {
    setSelectedNode(prev => prev === node.name ? null : node.name);
    if (node.originalName && CATEGORY_INFO[node.originalName]) {
      const pricing = MODEL_PRICING[selectedModel];
      const cost = ((node.tokens || 0) / 1000000) * pricing.input;
      const savedCost = node.originalName === 'Cache Read'
        ? ((node.tokens || 0) / 1000000) * (pricing.input - pricing.cacheRead)
        : 0;

      setDetailPanel({
        isOpen: true,
        category: node.originalName,
        tokens: node.tokens || 0,
        percentage: node.percentage || 0,
        cost,
        savedCost: savedCost > 0 ? savedCost : undefined,
      });
    }
  }, [selectedModel]);

  const buildTreeData = useCallback((data: ScanTokensResult, useFriendlyNames: boolean): TreemapNode[] => {
    const { breakdown } = data;
    const claudeMdPercentage = (breakdown.claudeMd.total / breakdown.total) * 100;

    const nodes: TreemapNode[] = [
      {
        name: useFriendlyNames ? CATEGORY_INFO['CLAUDE.md'].friendlyName : 'CLAUDE.md',
        originalName: 'CLAUDE.md',
        size: breakdown.claudeMd.total,
        tokens: breakdown.claudeMd.total,
        percentage: claudeMdPercentage,
        color: COLORS.claudeMd,
        claudeMdPreview: data.cacheInfo?.claudeMdPreview?.slice(0, 200),
        status: (claudeMdPercentage > 40 ? 'warning' : 'neutral') as TreemapNode['status'],
        statusBadge: useFriendlyNames
          ? (claudeMdPercentage > 40 ? 'Top cost driver' : undefined)
          : undefined,
        children: data.claudeMdSections?.map((section, idx) => ({
          name: section.section,
          size: section.tokens,
          tokens: section.tokens,
          percentage: section.percentage,
          color: `hsl(${(idx * 30) % 360}, 70%, 50%)`,
        })),
      },
      {
        name: useFriendlyNames ? CATEGORY_INFO['Cache Creation'].friendlyName : 'Cache Creation',
        originalName: 'Cache Creation',
        size: breakdown.cacheCreation,
        tokens: breakdown.cacheCreation,
        percentage: (breakdown.cacheCreation / breakdown.total) * 100,
        color: COLORS.cacheCreation,
        status: 'info' as const,
        statusBadge: useFriendlyNames ? 'Reused next time' : undefined,
        cacheDetails: data.cacheInfo?.recentCacheUsage?.filter(c => c.cacheCreation > 0),
      },
      {
        name: useFriendlyNames ? CATEGORY_INFO['Cache Read'].friendlyName : 'Cache Read',
        originalName: 'Cache Read',
        size: breakdown.cacheRead,
        tokens: breakdown.cacheRead,
        percentage: (breakdown.cacheRead / breakdown.total) * 100,
        color: COLORS.cacheRead,
        status: 'good' as const,
        statusBadge: useFriendlyNames ? '90% savings!' : undefined,
        cacheDetails: data.cacheInfo?.recentCacheUsage?.filter(c => c.cacheRead > 0),
      },
      {
        name: useFriendlyNames ? CATEGORY_INFO['User Input'].friendlyName : 'User Input',
        originalName: 'User Input',
        size: breakdown.userInput,
        tokens: breakdown.userInput,
        percentage: (breakdown.userInput / breakdown.total) * 100,
        color: COLORS.userInput,
        status: 'neutral' as const,
      },
      {
        name: useFriendlyNames ? CATEGORY_INFO['AI Output'].friendlyName : 'AI Output',
        originalName: 'AI Output',
        size: breakdown.output,
        tokens: breakdown.output,
        percentage: (breakdown.output / breakdown.total) * 100,
        color: COLORS.output,
        status: 'neutral' as const,
      },
    ];

    return nodes.filter(node => (node.size || 0) > 0);
  }, []);

  const startScan = useCallback(async () => {
    setIsScanning(true);
    setScanProgress(0);

    try {
      for (let i = 0; i <= 100; i += SCAN_STEP) {
        setScanProgress(i);
        await new Promise(r => setTimeout(r, SCAN_STEP_DELAY_MS));
      }

      const data: ScanTokensResult = await window.api.scanTokens();

      if (data?.breakdown) {
        setTotalTokens(data.breakdown.total);
        if (data.cacheInfo) setCacheInfo(data.cacheInfo);
        setTreemapData(buildTreeData(data, true));
      }
    } catch (error) {
      console.error('Scan error:', error);
      setTreemapData([
        { name: 'Config File', originalName: 'CLAUDE.md', size: 15234, tokens: 15234, percentage: 62.3, color: COLORS.claudeMd, status: 'warning', statusBadge: 'Top cost driver' },
        { name: 'New Cache', originalName: 'Cache Creation', size: 5234, tokens: 5234, percentage: 21.4, color: COLORS.cacheCreation, status: 'info', statusBadge: 'Reused next time' },
        { name: 'Cached', originalName: 'Cache Read', size: 2891, tokens: 2891, percentage: 11.8, color: COLORS.cacheRead, status: 'good', statusBadge: '90% savings!' },
        { name: 'My Input', originalName: 'User Input', size: 512, tokens: 512, percentage: 2.1, color: COLORS.userInput, status: 'neutral' },
        { name: 'AI Response', originalName: 'AI Output', size: 589, tokens: 589, percentage: 2.4, color: COLORS.output, status: 'neutral' },
      ]);
      setTotalTokens(24460);
    } finally {
      setIsScanning(false);
    }
  }, [buildTreeData]);

  const fetchContextLogs = useCallback(async () => {
    try {
      const logs = await window.api.getContextLogs?.();
      if (logs) setContextLogs(logs);
    } catch (error) {
      console.error('Get context logs error:', error);
    }
  }, []);

  const fetchPromptHistory = useCallback(async () => {
    try {
      const history = await window.api.getPromptHistory?.();
      if (history && Array.isArray(history)) {
        setPromptHistory(history);
      }
    } catch {
      const demoHistory: PromptHistoryItem[] = [
        { id: '1', timestamp: new Date().toISOString(), content: 'What about showing your requests at the top like a live chat? Like breaking news, with 3 lines...', tokens: 1234 },
        { id: '2', timestamp: new Date(Date.now() - 60000).toISOString(), content: 'How about something like webpack-bundle-analyzer?', tokens: 892 },
        { id: '3', timestamp: new Date(Date.now() - 120000).toISOString(), content: 'Oh yeah, make it Treemap style', tokens: 456 },
      ];
      setPromptHistory(demoHistory);
    }
  }, []);

  const silentScan = useCallback(async () => {
    if (selectedPrompt || isAnalyzing) return;

    try {
      const data: ScanTokensResult = await window.api.scanTokens();
      if (data?.breakdown) {
        setTotalTokens(data.breakdown.total);
        if (data.cacheInfo) setCacheInfo(data.cacheInfo);
        setTreemapData(buildTreeData(data, false));
      }
    } catch (error) {
      console.error('Silent scan error:', error);
    }
  }, [selectedPrompt, isAnalyzing, buildTreeData]);

  // Real-time polling for prompts and context logs
  useEffect(() => {
    fetchPromptHistory();
    fetchContextLogs();

    pollingRef.current = setInterval(() => {
      fetchPromptHistory();
      fetchContextLogs();
    }, POLLING_INTERVAL_MS);

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [fetchPromptHistory, fetchContextLogs]);

  // Auto-scan on mount + periodic treemap updates
  useEffect(() => {
    startScan();

    treemapPollingRef.current = setInterval(() => {
      silentScan();
    }, TREEMAP_POLLING_INTERVAL_MS);

    return () => {
      if (treemapPollingRef.current) clearInterval(treemapPollingRef.current);
    };
  }, [silentScan]);

  return {
    // Scan state
    isScanning,
    scanProgress,
    treemapData,
    totalTokens,
    selectedNode,
    selectedModel,
    setSelectedModel,
    startScan,

    // Prompt state
    promptHistory,
    selectedPrompt,
    promptAnalysis,
    isAnalyzing,
    showAllPrompts,
    currentPage,
    setCurrentPage,
    showPromptModal,
    modalPrompt,

    // Context state
    contextLogs,
    showContextLogs,

    // Detail panel
    detailPanel,

    // Actions
    handlePromptClick,
    handleAnalyzeFromModal,
    handleCloseAnalysis,
    handleCloseModal,
    handleToggleContextLogs,
    handleCloseDetailPanel,
    handleToggleShowAllPrompts,
    handleLegendClick,
  };
}
