import { useMemo } from 'react';
import type { LegacyPromptAnalysis } from '../../types';
import { MODEL_PRICING, ModelId } from './constants';

type PromptAnalysisPanelProps = {
  analysis: LegacyPromptAnalysis;
  selectedModel: ModelId;
  onClose: () => void;
};

export const PromptAnalysisPanel = ({ analysis, selectedModel, onClose }: PromptAnalysisPanelProps) => {
  const costBreakdown = useMemo(() => {
    const pricing = MODEL_PRICING[selectedModel];
    const resp = analysis.response;
    if (!resp) return null;

    const inputCost = (resp.inputTokens / 1000000) * pricing.input;
    const outputCost = (resp.outputTokens / 1000000) * pricing.output;
    const cacheCost = (resp.cacheReadTokens / 1000000) * pricing.cacheRead;
    const totalCost = inputCost + outputCost + cacheCost;
    const savedCost = ((resp.cacheReadTokens / 1000000) * pricing.input) - cacheCost;

    return { pricing, inputCost, outputCost, cacheCost, totalCost, savedCost };
  }, [analysis.response, selectedModel]);

  return (
    <div className="prompt-analysis">
      <div className="analysis-header">
        <span className="analysis-title">{'\u{1F4B0}'} Cost Analysis</span>
        <button className="analysis-close" onClick={onClose}>{'\u2715'}</button>
      </div>

      <div className="analysis-prompt">
        <div className="analysis-label">Prompt</div>
        <div className="analysis-content">{analysis.prompt.content}</div>
        <div className="analysis-meta">{analysis.prompt.tokens.toLocaleString()} tokens</div>
      </div>

      {analysis.response && (
        <div className="analysis-response">
          <div className="analysis-label">Response ({analysis.response.model})</div>
          <div className="analysis-tokens">
            <div className="token-item">
              <span className="token-label">Input</span>
              <span className="token-value">{analysis.response.inputTokens.toLocaleString()}</span>
            </div>
            <div className="token-item">
              <span className="token-label">Output</span>
              <span className="token-value">{analysis.response.outputTokens.toLocaleString()}</span>
            </div>
            <div className="token-item cache">
              <span className="token-label">Cache Read</span>
              <span className="token-value">{analysis.response.cacheReadTokens.toLocaleString()}</span>
            </div>
            <div className="token-item">
              <span className="token-label">Cache Creation</span>
              <span className="token-value">{analysis.response.cacheCreationTokens.toLocaleString()}</span>
            </div>
          </div>
        </div>
      )}

      {costBreakdown && (
        <div className="analysis-cost">
          <div className="cost-model">Based on {costBreakdown.pricing.name}</div>
          <div className="cost-row">
            <span>Input Cost</span>
            <span>${costBreakdown.inputCost.toFixed(6)}</span>
          </div>
          <div className="cost-row">
            <span>Output Cost</span>
            <span>${costBreakdown.outputCost.toFixed(6)}</span>
          </div>
          <div className="cost-row cache">
            <span>Cache Cost</span>
            <span>${costBreakdown.cacheCost.toFixed(6)}</span>
          </div>
          <div className="cost-row total">
            <span>Total Cost</span>
            <span>${costBreakdown.totalCost.toFixed(6)}</span>
          </div>
          {costBreakdown.savedCost > 0 && (
            <div className="cost-row saved">
              <span>{'\u{1F4B0}'} Cache Savings</span>
              <span>-${costBreakdown.savedCost.toFixed(6)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
