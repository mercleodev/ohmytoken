import type { PromptHistoryItem } from '../../types';

const PROMPTS_PER_PAGE = 20;
const VISIBLE_PROMPTS = 3;

type PromptFeedProps = {
  promptHistory: PromptHistoryItem[];
  selectedPrompt: string | null;
  showAllPrompts: boolean;
  currentPage: number;
  onToggleShowAll: () => void;
  onPageChange: (page: number) => void;
  onPromptClick: (prompt: PromptHistoryItem) => void;
};

export const PromptFeed = ({
  promptHistory,
  selectedPrompt,
  showAllPrompts,
  currentPage,
  onToggleShowAll,
  onPageChange,
  onPromptClick,
}: PromptFeedProps) => {
  const visiblePrompts = showAllPrompts
    ? promptHistory.slice(currentPage * PROMPTS_PER_PAGE, (currentPage + 1) * PROMPTS_PER_PAGE)
    : promptHistory.slice(0, VISIBLE_PROMPTS);

  const totalPages = Math.ceil(promptHistory.length / PROMPTS_PER_PAGE);
  const hasMultiplePages = promptHistory.length > PROMPTS_PER_PAGE;

  return (
    <div className="prompt-feed">
      <div className="feed-header">
        <span className="feed-title">Live Prompts</span>
        <button
          className="feed-toggle"
          onClick={onToggleShowAll}
        >
          {showAllPrompts ? 'Collapse' : `View all (${promptHistory.length})`}
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
              {new Date(prompt.timestamp).toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            <span className="feed-content">{prompt.content}</span>
            <span className="feed-tokens">{prompt.tokens.toLocaleString()} tok</span>
          </div>
        ))}
      </div>

      {showAllPrompts && hasMultiplePages && (
        <div className="feed-pagination">
          <button
            disabled={currentPage === 0}
            onClick={() => onPageChange(currentPage - 1)}
          >
            Prev
          </button>
          <span>
            {currentPage + 1} / {totalPages}
          </span>
          <button
            disabled={(currentPage + 1) * PROMPTS_PER_PAGE >= promptHistory.length}
            onClick={() => onPageChange(currentPage + 1)}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
};
