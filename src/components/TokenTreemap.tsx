/**
 * Token Treemap Component
 *
 * webpack-bundle-analyzer style token usage visualization
 * Rectangle size = token ratio, color = category/severity
 *
 * + Real-time prompt feed (breaking news style)
 */

import { useState, useCallback, useRef } from 'react';
import { Treemap, ResponsiveContainer, Tooltip } from 'recharts';
import type { LegacyPromptHistory } from '../types';
import {
  TreemapNode,
  CacheUsageItem,
  CATEGORY_INFO,
  MODEL_PRICING,
  ModelId,
} from './treemap/constants';
import { useTokenScan } from './treemap/useTokenScan';
import { usePromptFeed } from './treemap/usePromptFeed';
import { PromptFeed } from './treemap/PromptFeed';
import { PromptAnalysisPanel } from './treemap/PromptAnalysisPanel';
import { PromptModal } from './treemap/PromptModal';
import { ContextLogsSection } from './treemap/ContextLogsSection';
import './TokenTreemap.css';

type TokenTreemapProps = {
  onBack: () => void;
};

// Custom Treemap cell renderer
type TreemapCellProps = {
  x: number; y: number; width: number; height: number;
  name: string; tokens: number; percentage: number; color: string; depth: number;
};

const CustomTreemapContent = (props: Partial<TreemapCellProps>) => {
  const { x = 0, y = 0, width = 0, height = 0, name = '', tokens = 0, percentage = 0, color = '#8884d8', depth = 0 } = props;
  const showText = width > 60 && height > 40;
  const showDetails = width > 100 && height > 60;

  return (
    <g>
      <rect x={x} y={y} width={width} height={height}
        style={{ fill: color || '#8884d8', stroke: '#1a1a2e', strokeWidth: depth === 1 ? 3 : 1, opacity: 0.9, cursor: 'pointer' }}
      />
      {showText && (
        <>
          <text x={x + width / 2} y={y + height / 2 - (showDetails ? 10 : 0)} textAnchor="middle" dominantBaseline="middle"
            style={{ fontSize: Math.min(14, width / 8), fill: '#fff', fontWeight: 'bold', textShadow: '1px 1px 2px rgba(0,0,0,0.8)', pointerEvents: 'none' }}>
            {name}
          </text>
          {showDetails && (
            <>
              <text x={x + width / 2} y={y + height / 2 + 8} textAnchor="middle" dominantBaseline="middle"
                style={{ fontSize: Math.min(11, width / 10), fill: '#ddd', pointerEvents: 'none' }}>
                {tokens?.toLocaleString()} tokens
              </text>
              <text x={x + width / 2} y={y + height / 2 + 22} textAnchor="middle" dominantBaseline="middle"
                style={{ fontSize: Math.min(10, width / 12), fill: '#aaa', pointerEvents: 'none' }}>
                {percentage?.toFixed(1)}%
              </text>
            </>
          )}
        </>
      )}
    </g>
  );
};

// Custom tooltip
type TreemapTooltipProps = {
  active?: boolean;
  payload?: Array<{ payload: { name: string; tokens: number; percentage: number; color: string; cacheDetails?: CacheUsageItem[]; claudeMdPreview?: string } }>;
};

const CustomTooltip = ({ active, payload }: TreemapTooltipProps) => {
  if (!active || !payload?.length) return null;
  const data = payload[0].payload;

  return (
    <div className="treemap-tooltip">
      <div className="tooltip-header">{data.name}</div>
      <div className="tooltip-row"><span className="label">Tokens:</span><span className="value">{data.tokens?.toLocaleString()}</span></div>
      <div className="tooltip-row"><span className="label">Percentage:</span><span className="value">{data.percentage?.toFixed(2)}%</span></div>
      {data.name === 'CLAUDE.md' && <div className="tooltip-warning">{'\u26A0\uFE0F'} Takes up most of the context</div>}
      {data.name === 'Cache Read' && <div className="tooltip-good">{'\u2705'} 90% cost savings from cache!</div>}
      {data.cacheDetails && data.cacheDetails.length > 0 && (
        <div className="tooltip-cache-details">
          <div className="cache-details-header">{'\u{1F4CB}'} Recent cache usage:</div>
          {data.cacheDetails.slice(0, 3).map((item: CacheUsageItem, idx: number) => (
            <div key={idx} className="cache-detail-item">
              <span className="cache-prompt">{item.prompt || '(request)'}</span>
              <span className="cache-tokens">
                {item.cacheRead > 0 && `Read: ${item.cacheRead.toLocaleString()}`}
                {item.cacheCreation > 0 && ` Created: ${item.cacheCreation.toLocaleString()}`}
              </span>
            </div>
          ))}
        </div>
      )}
      {data.claudeMdPreview && (
        <div className="tooltip-claudemd-preview">
          <div className="claudemd-preview-header">{'\u{1F4C4}'} Cached CLAUDE.md:</div>
          <div className="claudemd-preview-content">{data.claudeMdPreview}</div>
        </div>
      )}
    </div>
  );
};

export const TokenTreemap = ({ onBack }: TokenTreemapProps) => {
  const [selectedModel, setSelectedModel] = useState<ModelId>('claude-sonnet-4-20250514');
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [showPromptModal, setShowPromptModal] = useState(false);
  const [modalPrompt, setModalPrompt] = useState<LegacyPromptHistory | null>(null);
  const [detailPanel, setDetailPanel] = useState<{
    isOpen: boolean; category: string; tokens: number; percentage: number; cost: number; savedCost?: number;
  } | null>(null);

  // Ref-based callback to break circular dependency:
  // feed needs scan.updateTreemap, scan needs feed.selectedPrompt/isAnalyzing
  const updateTreemapRef = useRef<(data: TreemapNode[], total: number) => void>(() => {});
  const handleTreemapUpdate = useCallback((data: TreemapNode[], total: number) => {
    updateTreemapRef.current(data, total);
  }, []);

  const feed = usePromptFeed(handleTreemapUpdate);
  const scan = useTokenScan(feed.selectedPrompt, feed.isAnalyzing);
  updateTreemapRef.current = scan.updateTreemap;

  const handlePromptClick = useCallback((prompt: LegacyPromptHistory) => {
    setModalPrompt(prompt);
    setShowPromptModal(true);
  }, []);

  const handleAnalyzeFromModal = useCallback(() => {
    if (modalPrompt) {
      setShowPromptModal(false);
      feed.analyzePrompt(modalPrompt.id);
    }
  }, [modalPrompt, feed]);

  return (
    <div className="token-treemap">
      {/* Header */}
      <div className="treemap-header">
        <button className="back-btn" onClick={onBack}>{'\u2190'} Back</button>
        <h2>{'\u{1F4E6}'} Token Analyzer</h2>
        <div className="header-actions">
          <select className="model-select" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value as ModelId)}>
            {Object.entries(MODEL_PRICING).map(([id, info]) => (
              <option key={id} value={id}>{info.name}</option>
            ))}
          </select>
          <button className="scan-btn" onClick={scan.startScan} disabled={scan.isScanning}>
            {scan.isScanning ? 'Analyzing...' : 'Full Analysis'}
          </button>
        </div>
      </div>

      {/* Prompt Feed */}
      <PromptFeed
        promptHistory={feed.promptHistory}
        selectedPrompt={feed.selectedPrompt}
        onPromptClick={handlePromptClick}
      />

      {/* Prompt Analysis */}
      {feed.promptAnalysis && !feed.isAnalyzing && (
        <PromptAnalysisPanel
          analysis={feed.promptAnalysis}
          selectedModel={selectedModel}
          onClose={feed.clearAnalysis}
        />
      )}

      {feed.isAnalyzing && (
        <div className="analyzing-indicator">
          <span className="analyzing-spinner">{'\u23F3'}</span> Analyzing...
        </div>
      )}

      {/* Prompt Modal */}
      {showPromptModal && modalPrompt && (
        <PromptModal prompt={modalPrompt} onClose={() => setShowPromptModal(false)} onAnalyze={handleAnalyzeFromModal} />
      )}

      {/* Scan Progress */}
      {scan.isScanning && (
        <div className="scan-overlay">
          <div className="scan-modal">
            <div className="scan-animation">
              <div className="scan-line" style={{ top: `${scan.scanProgress}%` }} />
              <div className="scan-grid">
                {[...Array(20)].map((_, i) => (
                  <div key={i} className="scan-cell" style={{ opacity: scan.scanProgress > (i * 5) ? 1 : 0.2, backgroundColor: `hsl(${i * 18}, 70%, 50%)` }} />
                ))}
              </div>
            </div>
            <div className="scan-text">Analyzing tokens... {scan.scanProgress}%</div>
          </div>
        </div>
      )}

      {/* Treemap Chart */}
      {!scan.isScanning && scan.treemapData.length > 0 && (
        <>
          <div className="treemap-container">
            <ResponsiveContainer width="100%" height={400}>
              <Treemap data={scan.treemapData} dataKey="size" aspectRatio={4 / 3} stroke="#1a1a2e" content={<CustomTreemapContent />}>
                <Tooltip content={<CustomTooltip />} />
              </Treemap>
            </ResponsiveContainer>
          </div>

          {/* Legend */}
          <div className="treemap-legend">
            {scan.treemapData.map((node) => {
              const pricing = MODEL_PRICING[selectedModel];
              const cost = ((node.tokens || 0) / 1000000) * pricing.input;
              const savedCost = node.originalName === 'Cache Read' ? ((node.tokens || 0) / 1000000) * (pricing.input - pricing.cacheRead) : 0;

              const handleLegendClick = () => {
                    setSelectedNode(selectedNode === node.name ? null : node.name);
                    if (node.originalName && CATEGORY_INFO[node.originalName]) {
                      setDetailPanel({ isOpen: true, category: node.originalName, tokens: node.tokens || 0, percentage: node.percentage || 0, cost, savedCost: savedCost > 0 ? savedCost : undefined });
                    }
                  };

              return (
                <div key={node.name}
                  role="button"
                  tabIndex={0}
                  aria-label={`${node.name} - ${node.tokens?.toLocaleString()} tokens (${node.percentage?.toFixed(1)}%)`}
                  className={`legend-item ${selectedNode === node.name ? 'selected' : ''} status-${node.status || 'neutral'}`}
                  onClick={handleLegendClick}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleLegendClick(); } }}
                >
                  <span className="legend-color" style={{ backgroundColor: node.color }} />
                  <span className="legend-name">{node.name}</span>
                  {node.statusBadge && <span className={`legend-badge status-${node.status}`}>{node.statusBadge}</span>}
                  <span className="legend-value">{node.tokens?.toLocaleString()} ({node.percentage?.toFixed(1)}%)</span>
                </div>
              );
            })}
          </div>

          <div className="treemap-total">
            <span className="total-label">Total Tokens:</span>
            <span className="total-value">{scan.totalTokens.toLocaleString()}</span>
          </div>
        </>
      )}

      {/* Detail Panel */}
      {detailPanel?.isOpen && detailPanel.category && CATEGORY_INFO[detailPanel.category] && (
        <div className="detail-panel-overlay" onClick={() => setDetailPanel(null)}>
          <div className="detail-panel" onClick={(e) => e.stopPropagation()}>
            <div className="detail-panel-header">
              <h3>{CATEGORY_INFO[detailPanel.category].friendlyName}</h3>
              <button className="detail-panel-close" onClick={() => setDetailPanel(null)}>{'\u2715'}</button>
            </div>
            <div className="detail-panel-stats">
              <div className="stat-item"><span className="stat-label">Tokens</span><span className="stat-value">{detailPanel.tokens.toLocaleString()}</span></div>
              <div className="stat-item"><span className="stat-label">Share</span><span className="stat-value">{detailPanel.percentage.toFixed(1)}%</span></div>
              <div className="stat-item"><span className="stat-label">Cost</span><span className="stat-value">${detailPanel.cost.toFixed(4)}</span></div>
              {detailPanel.savedCost && <div className="stat-item good"><span className="stat-label">Saved</span><span className="stat-value">-${detailPanel.savedCost.toFixed(4)}</span></div>}
            </div>
            <div className="detail-panel-section">
              <h4>{'\u2753'} What is this?</h4>
              <p>{CATEGORY_INFO[detailPanel.category].whatIsIt}</p>
            </div>
            {detailPanel.category === 'CLAUDE.md' && (
              <div className="detail-panel-actions">
                <button className="detail-action-btn" onClick={() => alert('CLAUDE.md editing will be available in a future update.')}>
                  {'\u{1F4DD}'} Open CLAUDE.md
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Context Logs */}
      {feed.contextLogs && !scan.isScanning && (
        <ContextLogsSection contextLogs={feed.contextLogs} />
      )}
    </div>
  );
};
