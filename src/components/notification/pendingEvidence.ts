/**
 * G2-C.1 caller-level pending contract.
 *
 * Until PR-3 (watcher-path scoring) lands end-to-end and G2-A (content recovery)
 * improves signal quality, many notification cards will arrive without any
 * `evidence_report`. Rather than defaulting those files to the legacy `U`
 * bucket (which is hard to distinguish from a scored `U`), we surface a
 * short-lived "scoring…" skeleton and only fall through to `buildInjectedEvidence`
 * after a bounded window elapses.
 *
 * This helper is a pure decision function: it tells the caller which of the
 * three views to render. The actual timing & skeleton UI live in
 * `NotificationCard.tsx`. Keeping the decision logic out of JSX makes it
 * unit-testable without react-testing-library.
 *
 * See docs/idea/notification-evidence-all-unverified.md §5.2 G2-C, §6 PR-5,
 * §10 Q2 (timeout policy).
 */

import type { PromptScan } from '../../types/electron';

export type EvidenceView =
  | { kind: 'scored' }
  | { kind: 'pending' }
  | { kind: 'legacy' };

export type ResolveInput = {
  scan: PromptScan;
  pendingTimedOut: boolean;
  ageMs: number;
};

export const PENDING_WINDOW_MS = 5_000;

export const resolveEvidenceView = (input: ResolveInput): EvidenceView => {
  if (input.scan.evidence_report) return { kind: 'scored' };
  if (input.pendingTimedOut) return { kind: 'legacy' };
  return { kind: 'pending' };
};
