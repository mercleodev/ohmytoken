import {
  formatTokens,
  CATEGORY_COLORS,
  ACTION_COLORS,
} from "../../scan/shared";

type BreakdownPopoverProps = {
  segment: string;
  scan: {
    assistant_response?: string;
  };
  ctx: {
    system_tokens: number;
    messages_tokens: number;
    tools_definition_tokens: number;
    total_tokens: number;
    messages_tokens_breakdown?: {
      user_text_tokens: number;
      assistant_tokens: number;
      tool_result_tokens: number;
    };
  };
  injectedFiles: Array<{
    path: string;
    estimated_tokens: number;
    category: string;
  }>;
  toolCalls: Array<{
    index: number;
    name: string;
    input_summary: string;
    timestamp?: string;
  }>;
  userTextTokens: number;
  assistantTokens: number;
  conversationTokens: number;
  toolResultTokens: number;
  onFileClick: (path: string) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
};

export const BreakdownPopover = ({
  segment,
  scan,
  ctx,
  injectedFiles,
  toolCalls,
  userTextTokens,
  assistantTokens,
  conversationTokens,
  toolResultTokens,
  onFileClick,
  onMouseEnter,
  onMouseLeave,
}: BreakdownPopoverProps) => {
  const fileToolCalls = toolCalls.filter(
    (t) =>
      ["Read", "Write", "Edit"].includes(t.name) &&
      t.input_summary.startsWith("/"),
  );

  const renderContent = () => {
    switch (segment) {
      case "system":
        return (
          <>
            <div className="breakdown-popover-header">
              <span
                className="breakdown-popover-dot"
                style={{ background: "#8b5cf6" }}
              />
              System — {formatTokens(ctx.system_tokens)}
            </div>
            {injectedFiles.length > 0 ? (
              <div className="breakdown-popover-list">
                {injectedFiles.map((f, i) => (
                  <button
                    key={i}
                    className="breakdown-popover-item breakdown-popover-item--clickable"
                    onClick={(e) => {
                      e.stopPropagation();
                      onFileClick(f.path);
                    }}
                  >
                    <span
                      className="breakdown-popover-file-dot"
                      style={{
                        background: CATEGORY_COLORS[f.category] || "#8e8e93",
                      }}
                    />
                    <span className="breakdown-popover-file-path">
                      {f.path.split("/").slice(-2).join("/")}
                    </span>
                    <span className="breakdown-popover-file-tokens">
                      {formatTokens(f.estimated_tokens)}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="breakdown-popover-desc">No injected files</div>
            )}
          </>
        );
      case "userText":
        return (
          <>
            <div className="breakdown-popover-header">
              <span
                className="breakdown-popover-dot"
                style={{ background: "#3b82f6" }}
              />
              Your Prompts — {formatTokens(userTextTokens)}
            </div>
            <div className="breakdown-popover-desc">
              Your text prompts in conversation
            </div>
          </>
        );
      case "assistant":
        return (
          <>
            <div className="breakdown-popover-header">
              <span
                className="breakdown-popover-dot"
                style={{ background: "#60a5fa" }}
              />
              Responses — {formatTokens(assistantTokens)}
            </div>
            {scan.assistant_response ? (
              <div className="breakdown-popover-response">
                {scan.assistant_response.length > 200
                  ? scan.assistant_response.slice(0, 200) + "..."
                  : scan.assistant_response}
              </div>
            ) : (
              <div className="breakdown-popover-desc">
                Claude&apos;s responses in conversation
              </div>
            )}
          </>
        );
      case "messages":
        return (
          <>
            <div className="breakdown-popover-header">
              <span
                className="breakdown-popover-dot"
                style={{ background: "#3b82f6" }}
              />
              Messages — {formatTokens(conversationTokens)}
            </div>
            <div className="breakdown-popover-desc">
              Conversation messages (prompts + responses)
            </div>
          </>
        );
      case "toolResult":
        return (
          <>
            <div className="breakdown-popover-header">
              <span
                className="breakdown-popover-dot"
                style={{ background: "#06b6d4" }}
              />
              Action Results — {formatTokens(toolResultTokens)}
            </div>
            {fileToolCalls.length > 0 ? (
              <div className="breakdown-popover-list">
                {fileToolCalls.slice(0, 10).map((t) => (
                  <button
                    key={t.index}
                    className="breakdown-popover-item breakdown-popover-item--clickable"
                    onClick={(e) => {
                      e.stopPropagation();
                      onFileClick(t.input_summary);
                    }}
                  >
                    <span
                      className="breakdown-popover-file-dot"
                      style={{
                        background: ACTION_COLORS[t.name] || "#8e8e93",
                      }}
                    />
                    <span className="breakdown-popover-badge">{t.name}</span>
                    <span className="breakdown-popover-file-path">
                      {t.input_summary.split("/").slice(-2).join("/")}
                    </span>
                  </button>
                ))}
                {fileToolCalls.length > 10 && (
                  <div className="breakdown-popover-desc">
                    +{fileToolCalls.length - 10} more
                  </div>
                )}
              </div>
            ) : (
              <div className="breakdown-popover-desc">
                Tool execution results
              </div>
            )}
          </>
        );
      case "toolsDef":
        return (
          <>
            <div className="breakdown-popover-header">
              <span
                className="breakdown-popover-dot"
                style={{ background: "#f59e0b" }}
              />
              Tools Def — {formatTokens(ctx.tools_definition_tokens)}
            </div>
            <div className="breakdown-popover-desc">
              MCP tool definitions & schemas
            </div>
          </>
        );
      default:
        return null;
    }
  };

  return (
    <div
      className="breakdown-popover"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {renderContent()}
    </div>
  );
};
