import type { PromptAnalysisResult } from '../../types';
import { MODEL_PRICING } from './constants';
import type { ModelId } from './constants';

type CostAnalysisPanelProps = {
  promptAnalysis: PromptAnalysisResult;
  selectedModel: ModelId;
  onClose: () => void;
};

export const CostAnalysisPanel = ({
  promptAnalysis,
  selectedModel,
  onClose,
}: CostAnalysisPanelProps) => {
  const pricing = MODEL_PRICING[selectedModel];

  return (
    <div className="prompt-analysis">
      <div className="analysis-header">
        <span className="analysis-title">Cost Analysis</span>
        <button className="analysis-close" onClick={onClose}>
          X
        </button>
      </div>

      <div className="analysis-prompt">
        <div className="analysis-label">Prompt</div>
        <div className="analysis-content">
          {promptAnalysis.prompt.content}
        </div>
        <div className="analysis-meta">
          {promptAnalysis.prompt.tokens.toLocaleString()} tokens
        </div>
      </div>

      {promptAnalysis.response && (
        <div className="analysis-response">
          <div className="analysis-label">Response ({promptAnalysis.response.model})</div>
          <div className="analysis-tokens">
            <div className="token-item">
              <span className="token-label">Input</span>
              <span className="token-value">{promptAnalysis.response.inputTokens.toLocaleString()}</span>
            </div>
            <div className="token-item">
              <span className="token-label">Output</span>
              <span className="token-value">{promptAnalysis.response.outputTokens.toLocaleString()}</span>
            </div>
            <div className="token-item cache">
              <span className="token-label">Cache Read</span>
              <span className="token-value">{promptAnalysis.response.cacheReadTokens.toLocaleString()}</span>
            </div>
            <div className="token-item">
              <span className="token-label">Cache Creation</span>
              <span className="token-value">{promptAnalysis.response.cacheCreationTokens.toLocaleString()}</span>
            </div>
          </div>
        </div>
      )}

      <div className="analysis-cost">
        {(() => {
          const resp = promptAnalysis.response;
          if (!resp) return null;

          const inputCost = (resp.inputTokens / 1000000) * pricing.input;
          const outputCost = (resp.outputTokens / 1000000) * pricing.output;
          const cacheCost = (resp.cacheReadTokens / 1000000) * pricing.cacheRead;
          const totalCost = inputCost + outputCost + cacheCost;
          const savedCost = ((resp.cacheReadTokens / 1000000) * pricing.input) - cacheCost;

          return (
            <>
              <div className="cost-model">
                Based on {pricing.name}
              </div>
              <div className="cost-row">
                <span>Input Cost</span>
                <span>${inputCost.toFixed(6)}</span>
              </div>
              <div className="cost-row">
                <span>Output Cost</span>
                <span>${outputCost.toFixed(6)}</span>
              </div>
              <div className="cost-row cache">
                <span>Cache Cost</span>
                <span>${cacheCost.toFixed(6)}</span>
              </div>
              <div className="cost-row total">
                <span>Total Cost</span>
                <span>${totalCost.toFixed(6)}</span>
              </div>
              {savedCost > 0 && (
                <div className="cost-row saved">
                  <span>Cache Savings</span>
                  <span>-${savedCost.toFixed(6)}</span>
                </div>
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
};
