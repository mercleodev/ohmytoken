import type { PromptNotification } from './types';
import type { EvidenceReport } from '../../types/electron';

export type EvidenceScoredPayload = {
  requestId: string;
  report: EvidenceReport;
};

/**
 * Merge a freshly-arrived evidence report into the matching notification
 * (by request_id). Pure function: does not mutate inputs.
 *
 * Returns the same list reference when no notification matches, so
 * callers may compare by reference to skip no-op state updates.
 *
 * See docs/idea/notification-evidence-all-unverified.md §5.1 G1-2.
 */
export const mergeEvidenceReport = (
  notifications: PromptNotification[],
  payload: EvidenceScoredPayload,
): PromptNotification[] => {
  const idx = notifications.findIndex((n) => n.id === payload.requestId);
  if (idx < 0) return notifications;

  const target = notifications[idx];
  const updated: PromptNotification = {
    ...target,
    scan: {
      ...target.scan,
      evidence_report: payload.report,
    },
  };
  const next = notifications.slice();
  next[idx] = updated;
  return next;
};
