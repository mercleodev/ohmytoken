/**
 * Token Treemap Component
 *
 * webpack-bundle-analyzer style token usage visualization
 * Rectangle size = token ratio, color = category/severity
 *
 * + Real-time prompt feed (breaking news style)
 */

import { Treemap, ResponsiveContainer, Tooltip } from 'recharts';
import './TokenTreemap.css';
import { TreemapCell } from './tokenTreemap/TreemapCell';
import { TreemapTooltip } from './tokenTreemap/TreemapTooltip';
import { PromptFeed } from './tokenTreemap/PromptFeed';
import { CostAnalysisPanel } from './tokenTreemap/CostAnalysisPanel';
import { PromptDetailModal } from './tokenTreemap/PromptDetailModal';
import { ScanProgress } from './tokenTreemap/ScanProgress';
import { DetailPanel } from './tokenTreemap/DetailPanel';
import { ContextLogsPanel } from './tokenTreemap/ContextLogsPanel';
import { useTokenTreemapData } from './tokenTreemap/useTokenTreemapData';
import { MODEL_PRICING } from './tokenTreemap/constants';
import type { TreemapCellProps, ModelId } from './tokenTreemap/constants';

type TokenTreemapProps = {
  onBack: () => void;
};

export const TokenTreemap = ({ onBack }: TokenTreemapProps) => {
  const {
    isScanning,
    scanProgress,
    treemapData,
    totalTokens,
    selectedNode,
    selectedModel,
    setSelectedModel,
    startScan,
    promptHistory,
    selectedPrompt,
    promptAnalysis,
    isAnalyzing,
    showAllPrompts,
    currentPage,
    setCurrentPage,
    showPromptModal,
    modalPrompt,
    contextLogs,
    showContextLogs,
    detailPanel,
    handlePromptClick,
    handleAnalyzeFromModal,
    handleCloseAnalysis,
    handleCloseModal,
    handleToggleContextLogs,
    handleCloseDetailPanel,
    handleToggleShowAllPrompts,
    handleLegendClick,
  } = useTokenTreemapData();

  return (
    <div className="token-treemap">
      {/* Header */}
      <div className="treemap-header">
        <button className="back-btn" onClick={onBack}>← Back</button>
        <h2>Token Analyzer</h2>
        <div className="header-actions">
          <select
            className="model-select"
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value as ModelId)}
          >
            {Object.entries(MODEL_PRICING).map(([id, info]) => (
              <option key={id} value={id}>
                {info.name}
              </option>
            ))}
          </select>
          <button
            className="scan-btn"
            onClick={startScan}
            disabled={isScanning}
          >
            {isScanning ? 'Analyzing...' : 'Full Analysis'}
          </button>
        </div>
      </div>

      {/* Real-time prompt feed */}
      <PromptFeed
        promptHistory={promptHistory}
        selectedPrompt={selectedPrompt}
        showAllPrompts={showAllPrompts}
        currentPage={currentPage}
        onToggleShowAll={handleToggleShowAllPrompts}
        onPageChange={setCurrentPage}
        onPromptClick={handlePromptClick}
      />

      {/* Cost analysis results */}
      {promptAnalysis && !isAnalyzing && (
        <CostAnalysisPanel
          promptAnalysis={promptAnalysis}
          selectedModel={selectedModel}
          onClose={handleCloseAnalysis}
        />
      )}

      {isAnalyzing && (
        <div className="analyzing-indicator">
          <span className="analyzing-spinner">...</span>
          Analyzing...
        </div>
      )}

      {/* Prompt detail modal */}
      {showPromptModal && modalPrompt && (
        <PromptDetailModal
          prompt={modalPrompt}
          onClose={handleCloseModal}
          onAnalyze={handleAnalyzeFromModal}
        />
      )}

      {/* Scan progress */}
      {isScanning && <ScanProgress scanProgress={scanProgress} />}

      {/* Treemap */}
      {!isScanning && treemapData.length > 0 && (
        <>
          <div className="treemap-container">
            <ResponsiveContainer width="100%" height={400}>
              <Treemap
                data={treemapData}
                dataKey="size"
                aspectRatio={4 / 3}
                stroke="#1a1a2e"
                content={((props: Record<string, unknown>) => <TreemapCell {...(props as TreemapCellProps)} />) as unknown as React.ReactElement}
              >
                <Tooltip content={<TreemapTooltip />} />
              </Treemap>
            </ResponsiveContainer>
          </div>

          {/* Legend */}
          <div className="treemap-legend">
            {treemapData.map((node) => (
              <div
                key={node.name}
                className={`legend-item ${selectedNode === node.name ? 'selected' : ''} status-${node.status || 'neutral'}`}
                onClick={() => handleLegendClick(node)}
              >
                <span
                  className="legend-color"
                  style={{ backgroundColor: node.color }}
                />
                <span className="legend-name">{node.name}</span>
                {node.statusBadge && (
                  <span className={`legend-badge status-${node.status}`}>
                    {node.statusBadge}
                  </span>
                )}
                <span className="legend-value">
                  {node.tokens?.toLocaleString()} ({node.percentage?.toFixed(1)}%)
                </span>
              </div>
            ))}
          </div>

          {/* Total */}
          <div className="treemap-total">
            <span className="total-label">Total Tokens:</span>
            <span className="total-value">{totalTokens.toLocaleString()}</span>
          </div>
        </>
      )}

      {/* Detail panel */}
      {detailPanel?.isOpen && (
        <DetailPanel
          data={detailPanel}
          onClose={handleCloseDetailPanel}
        />
      )}

      {/* Context logs */}
      {contextLogs && !isScanning && (
        <ContextLogsPanel
          contextLogs={contextLogs}
          showContextLogs={showContextLogs}
          onToggle={handleToggleContextLogs}
        />
      )}
    </div>
  );
};
