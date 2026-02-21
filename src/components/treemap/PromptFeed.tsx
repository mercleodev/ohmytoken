import { useState } from 'react';
import type { LegacyPromptHistory } from '../../types';

const PROMPTS_PER_PAGE = 20;
const VISIBLE_PROMPTS = 3;

type PromptFeedProps = {
  promptHistory: LegacyPromptHistory[];
  selectedPrompt: string | null;
  onPromptClick: (prompt: LegacyPromptHistory) => void;
};

export const PromptFeed = ({ promptHistory, selectedPrompt, onPromptClick }: PromptFeedProps) => {
  const [showAll, setShowAll] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);

  const visiblePrompts = showAll
    ? promptHistory.slice(currentPage * PROMPTS_PER_PAGE, (currentPage + 1) * PROMPTS_PER_PAGE)
    : promptHistory.slice(0, VISIBLE_PROMPTS);

  return (
    <div className="prompt-feed">
      <div className="feed-header">
        <span className="feed-title">{'\u{1F4E1}'} Live Prompts</span>
        <button className="feed-toggle" onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Collapse' : `View all (${promptHistory.length})`}
        </button>
      </div>

      <div className="feed-list">
        {visiblePrompts.map((prompt) => (
          <div
            key={prompt.id}
            className={`feed-item ${selectedPrompt === prompt.id ? 'selected' : ''}`}
            onClick={() => onPromptClick(prompt)}
          >
            <span className="feed-time">
              {new Date(prompt.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
            </span>
            <span className="feed-content">{prompt.content}</span>
            <span className="feed-tokens">{prompt.tokens.toLocaleString()} tok</span>
          </div>
        ))}
      </div>

      {showAll && promptHistory.length > PROMPTS_PER_PAGE && (
        <div className="feed-pagination">
          <button disabled={currentPage === 0} onClick={() => setCurrentPage(p => p - 1)}>
            {'\u2190'} Prev
          </button>
          <span>{currentPage + 1} / {Math.ceil(promptHistory.length / PROMPTS_PER_PAGE)}</span>
          <button
            disabled={(currentPage + 1) * PROMPTS_PER_PAGE >= promptHistory.length}
            onClick={() => setCurrentPage(p => p + 1)}
          >
            Next {'\u2192'}
          </button>
        </div>
      )}
    </div>
  );
};
