import { useState, useCallback, useEffect, useRef } from 'react';
import type { LegacyScanResult } from '../../types';
import { TreemapNode, DEMO_TREEMAP_DATA, buildTreemapData, buildSilentTreemapData } from './constants';

type UseTokenScanReturn = {
  isScanning: boolean;
  scanProgress: number;
  treemapData: TreemapNode[];
  totalTokens: number;
  startScan: () => Promise<void>;
  updateTreemap: (data: TreemapNode[], total: number) => void;
};

export function useTokenScan(selectedPrompt: string | null, isAnalyzing: boolean): UseTokenScanReturn {
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [treemapData, setTreemapData] = useState<TreemapNode[]>([]);
  const [totalTokens, setTotalTokens] = useState(0);
  const treemapPollingRef = useRef<NodeJS.Timeout | null>(null);

  const startScan = useCallback(async () => {
    setIsScanning(true);
    setScanProgress(0);

    try {
      for (let i = 0; i <= 100; i += 5) {
        setScanProgress(i);
        await new Promise(r => setTimeout(r, 30));
      }

      const data: LegacyScanResult = await window.api.scanTokens();

      if (data?.breakdown) {
        setTotalTokens(data.breakdown.total);
        setTreemapData(buildTreemapData(data));
      }
    } catch (error) {
      console.error('Scan error:', error);
      setTreemapData(DEMO_TREEMAP_DATA);
      setTotalTokens(24460);
    } finally {
      setIsScanning(false);
    }
  }, []);

  const silentScan = useCallback(async () => {
    if (selectedPrompt || isAnalyzing) return;

    try {
      const data: LegacyScanResult = await window.api.scanTokens();

      if (data?.breakdown) {
        setTotalTokens(data.breakdown.total);
        setTreemapData(buildSilentTreemapData(data));
      }
    } catch (error) {
      console.error('Silent scan error:', error);
    }
  }, [selectedPrompt, isAnalyzing]);

  useEffect(() => {
    startScan();

    treemapPollingRef.current = setInterval(() => {
      silentScan();
    }, 5000);

    return () => {
      if (treemapPollingRef.current) {
        clearInterval(treemapPollingRef.current);
      }
    };
  }, [silentScan]);

  const updateTreemap = useCallback((data: TreemapNode[], total: number) => {
    setTreemapData(data);
    setTotalTokens(total);
  }, []);

  return { isScanning, scanProgress, treemapData, totalTokens, startScan, updateTreemap };
}
