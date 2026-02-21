import { PromptScanView } from '../scan/PromptScanView';

type LiveSessionViewProps = {
  onBack?: () => void;
};

/**
 * Live session view: wraps the existing CT Scan (PromptScanView)
 * to operate within a Dashboard sub-tab.
 *
 * Reuses existing components:
 * - ProxyStatusBar (proxy status)
 * - PromptTimeline (cost chart)
 * - ScanDetailPanel (prompt detail)
 * - ContextWindowGauge (context gauge)
 */
export const LiveSessionView = ({ onBack }: LiveSessionViewProps) => {
  return (
    <div className="live-session-view">
      <PromptScanView onBack={onBack ?? (() => {})} embedded />
    </div>
  );
};
