import type { PromptScan, UsageLogEntry, TurnMetric } from '../../types/electron';
import type { SessionAlert } from '../../utils/sessionAlerts';

export type NotificationStatus = 'streaming' | 'completed';

export type ActivityLine = {
  id: string;
  kind: 'tool_use' | 'tool_result' | 'text' | 'thinking';
  name: string;
  detail: string;
  timestamp: string;
};

export type PromptNotification = {
  id: string;
  scan: PromptScan;
  usage: UsageLogEntry | null;
  status: NotificationStatus;
  createdAt: number;
  completedAt: number | null;
  turnMetrics: TurnMetric[];
  alerts: SessionAlert[];
  activityLog: ActivityLine[];
  projectFolder?: string;
};
