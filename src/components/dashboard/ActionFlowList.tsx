import { AnimatePresence, motion } from "framer-motion";
import { useMemo } from "react";
import {
  ACTION_COLORS,
  formatActionDetail,
  formatActionTime,
} from "../scan/shared";
import type { ToolCall } from "../../types";

const ACTION_STAGGER_SECONDS = 0.05;
const ACTION_ENTER_DURATION_SECONDS = 0.22;
const FILTER_TRANSITION_SECONDS = 0.2;
const FILTER_EASE: [number, number, number, number] = [0.25, 0.1, 0.25, 1];
const LIVE_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const LIVE_WINDOW_MS = 3 * 60 * 1000;

type ActionFlowListProps = {
  toolCalls: ToolCall[];
  expandedActions: Set<number>;
  onToggleAction: (idx: number) => void;
  onOpenFile: (filePath: string) => void;
  scanTimestamp: string;
  isCompleted: boolean;
};

const isFileAction = (toolCall: ToolCall): boolean =>
  ["Read", "Write", "Edit"].includes(toolCall.name) &&
  toolCall.input_summary.startsWith("/");

const isLikelyLive = (
  scanTimestamp: string,
  isCompleted: boolean,
  actionCount: number,
): boolean => {
  if (actionCount === 0 || isCompleted) return false;
  const timestampMs = new Date(scanTimestamp).getTime();
  if (!Number.isFinite(timestampMs)) return false;
  return Date.now() - timestampMs < LIVE_WINDOW_MS;
};

export const ActionFlowList = ({
  toolCalls,
  expandedActions,
  onToggleAction,
  onOpenFile,
  scanTimestamp,
  isCompleted,
}: ActionFlowListProps) => {
  const visibleToolCalls = useMemo(
    () => [...toolCalls].sort((a, b) => a.index - b.index),
    [toolCalls],
  );

  const showLiveFlow = isLikelyLive(
    scanTimestamp,
    isCompleted,
    visibleToolCalls.length,
  );

  return (
    <div className="action-flow">
      {showLiveFlow && (
        <div className="action-flow-live-label">Live action feed</div>
      )}

      <div className="action-flow-list" role="list">
        <AnimatePresence initial={false}>
          {visibleToolCalls.map((toolCall, idx) => {
            const hasFile = isFileAction(toolCall);
            const isExpanded = expandedActions.has(toolCall.index);
            const truncated = formatActionDetail(toolCall);
            const full = toolCall.input_summary || "";
            const isTruncated = truncated !== full && truncated.endsWith("...");
            const canExpand = !hasFile && isTruncated;
            const isLiveTail = showLiveFlow && idx === visibleToolCalls.length - 1;
            const showArrow =
              showLiveFlow &&
              (idx < visibleToolCalls.length - 1 || isLiveTail);

            return (
              <motion.div
                key={`${toolCall.index}-${toolCall.timestamp ?? "no-ts"}`}
                className="action-flow-entry"
                role="listitem"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={
                  showLiveFlow
                    ? {
                        duration: ACTION_ENTER_DURATION_SECONDS,
                        ease: LIVE_EASE,
                        delay: idx * ACTION_STAGGER_SECONDS,
                      }
                    : {
                        duration: FILTER_TRANSITION_SECONDS,
                        ease: FILTER_EASE,
                      }
                }
              >
                <button
                  className={`action-flow-item${hasFile ? " action-clickable" : ""}${canExpand ? " action-expandable" : ""}${isLiveTail ? " action-flow-item-live" : ""}`}
                  onClick={() =>
                    hasFile
                      ? onOpenFile(toolCall.input_summary)
                      : canExpand
                        ? onToggleAction(toolCall.index)
                        : undefined
                  }
                >
                  <span className="action-flow-order">
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  <span
                    className={`action-dot${isLiveTail ? " action-dot-live" : ""}`}
                    style={{
                      background: ACTION_COLORS[toolCall.name] || "#8e8e93",
                    }}
                  />
                  {toolCall.timestamp && (
                    <span className="action-time">
                      {formatActionTime(toolCall.timestamp)}
                    </span>
                  )}
                  <span className="action-badge">{toolCall.name}</span>
                  <span className={`action-detail${isExpanded ? " expanded" : ""}`}>
                    {isExpanded ? full : truncated}
                  </span>
                </button>

                {showArrow && (
                  <div
                    className={`action-flow-arrow${isLiveTail ? " action-flow-arrow-live" : ""}`}
                    aria-hidden="true"
                  >
                    ↓
                  </div>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

    </div>
  );
};
