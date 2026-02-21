import type { LegacyPromptHistory } from '../../types';

type PromptModalProps = {
  prompt: LegacyPromptHistory;
  onClose: () => void;
  onAnalyze: () => void;
};

export const PromptModal = ({ prompt, onClose, onAnalyze }: PromptModalProps) => (
  <div className="prompt-modal-overlay" onClick={onClose}>
    <div className="prompt-modal" onClick={(e) => e.stopPropagation()}>
      <div className="modal-header">
        <span className="modal-title">{'\u{1F4DD}'} Prompt Details</span>
        <button className="modal-close" onClick={onClose}>{'\u2715'}</button>
      </div>
      <div className="modal-meta">
        <span className="modal-time">{new Date(prompt.timestamp).toLocaleString('en-US')}</span>
        <span className="modal-tokens">{prompt.tokens.toLocaleString()} tokens</span>
      </div>
      <div className="modal-content">
        {prompt.fullContent || prompt.content}
      </div>
      <div className="modal-actions">
        <button className="modal-btn secondary" onClick={onClose}>Close</button>
        <button className="modal-btn primary" onClick={onAnalyze}>{'\u{1F4B0}'} Cost Analysis</button>
      </div>
    </div>
  </div>
);
