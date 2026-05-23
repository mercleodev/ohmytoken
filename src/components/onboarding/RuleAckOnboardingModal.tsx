import { useEffect, useMemo, useState, useCallback } from 'react';
import type {
  RuleAckPlanEntry,
  RuleAckScanResult,
  RuleAckApplyResult,
} from '../../types/electron';

const ROOT_INFO =
  'Scans <projectRoot>/.claude/rules/*.md and ~/.claude/rules/*.md. Files already containing a canary marker are skipped.';

type Phase = 'idle' | 'scanning' | 'preview' | 'applying' | 'done' | 'error';

type SelectionState = Record<string, { selected: boolean; idOverride: string }>;

const buildInitialSelection = (entries: RuleAckPlanEntry[]): SelectionState => {
  const out: SelectionState = {};
  for (const e of entries) {
    out[e.filePath] = { selected: e.willInsert, idOverride: e.proposedId };
  }
  return out;
};

const collidingIds = (
  selection: SelectionState,
  entries: RuleAckPlanEntry[],
): Set<string> => {
  const counts = new Map<string, number>();
  for (const e of entries) {
    const sel = selection[e.filePath];
    if (!sel || !sel.selected) continue;
    const id = sel.idOverride.trim() || e.proposedId;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const out = new Set<string>();
  for (const [id, n] of counts) if (n > 1) out.add(id);
  return out;
};

export type RuleAckOnboardingModalProps = {
  open: boolean;
  onClose: () => void;
};

export const RuleAckOnboardingModal = ({
  open,
  onClose,
}: RuleAckOnboardingModalProps) => {
  const [phase, setPhase] = useState<Phase>('idle');
  const [scan, setScan] = useState<RuleAckScanResult | null>(null);
  const [selection, setSelection] = useState<SelectionState>({});
  const [applyResult, setApplyResult] = useState<RuleAckApplyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runScan = useCallback(async () => {
    setPhase('scanning');
    setError(null);
    try {
      const result = await window.api.ruleAckOnboarding.scan();
      setScan(result);
      setSelection(buildInitialSelection(result.entries));
      setPhase('preview');
    } catch (err) {
      console.error('[RuleAckOnboarding] scan failed:', err);
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setPhase('idle');
    setScan(null);
    setSelection({});
    setApplyResult(null);
    setError(null);
    void runScan();
  }, [open, runScan]);

  const duplicates = useMemo(
    () => (scan ? collidingIds(selection, scan.entries) : new Set<string>()),
    [scan, selection],
  );

  const insertable = useMemo(
    () => (scan ? scan.entries.filter((e) => e.willInsert) : []),
    [scan],
  );

  const selectedCount = useMemo(
    () =>
      insertable.filter((e) => selection[e.filePath]?.selected).length,
    [insertable, selection],
  );

  const toggleSelected = (filePath: string) => {
    setSelection((prev) => ({
      ...prev,
      [filePath]: {
        ...prev[filePath],
        selected: !(prev[filePath]?.selected ?? false),
      },
    }));
  };

  const setIdOverride = (filePath: string, idOverride: string) => {
    setSelection((prev) => ({
      ...prev,
      [filePath]: { ...prev[filePath], idOverride },
    }));
  };

  const onApply = async () => {
    if (!scan) return;
    if (duplicates.size > 0) return;
    setPhase('applying');
    try {
      const subset: RuleAckPlanEntry[] = insertable
        .filter((e) => selection[e.filePath]?.selected)
        .map((e) => {
          const override = selection[e.filePath]?.idOverride?.trim();
          const idOverride = override && override.length > 0 ? override : e.proposedId;
          if (idOverride === e.proposedId) return e;
          const nextContent = `<!-- canary:CANARY-${idOverride} -->\n${e.originalContent}`;
          return { ...e, proposedId: idOverride, nextContent, diff: '' };
        });
      const result = await window.api.ruleAckOnboarding.apply(subset);
      setApplyResult(result);
      setPhase('done');
    } catch (err) {
      console.error('[RuleAckOnboarding] apply failed:', err);
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  };

  if (!open) return null;

  return (
    <div className="rule-ack-modal" role="dialog" aria-modal="true" aria-label="Rule Ack Onboarding">
      <div className="rule-ack-modal__backdrop" onClick={onClose} aria-hidden="true" />
      <div className="rule-ack-modal__panel">
        <header className="rule-ack-modal__header">
          <h2>Add ack headers to your rule files</h2>
          <button className="rule-ack-modal__close" onClick={onClose} aria-label="Close">×</button>
        </header>

        <p className="rule-ack-modal__hint">{ROOT_INFO}</p>

        {phase === 'scanning' && <p className="rule-ack-modal__status">Scanning…</p>}

        {phase === 'preview' && scan && (
          <>
            <div className="rule-ack-modal__summary">
              <strong>{selectedCount}</strong> of <strong>{insertable.length}</strong> files
              selected.
              {duplicates.size > 0 && (
                <span className="rule-ack-modal__warning">
                  {' '}Duplicate ids: {[...duplicates].join(', ')} — resolve before applying.
                </span>
              )}
            </div>

            {scan.entries.length === 0 && (
              <p className="rule-ack-modal__status">
                No rule files found. Create files under <code>.claude/rules/</code> and re-open this dialog.
              </p>
            )}

            <ul className="rule-ack-modal__list">
              {scan.entries.map((entry) => {
                const sel = selection[entry.filePath];
                const idValue = sel?.idOverride ?? entry.proposedId;
                const skipped = !entry.willInsert;
                const isDup = duplicates.has(idValue);
                return (
                  <li key={entry.filePath} className="rule-ack-modal__row">
                    <label className="rule-ack-modal__rowMain">
                      <input
                        type="checkbox"
                        disabled={skipped}
                        checked={!skipped && Boolean(sel?.selected)}
                        onChange={() => toggleSelected(entry.filePath)}
                      />
                      <span className="rule-ack-modal__path">{entry.filePath}</span>
                    </label>
                    {skipped ? (
                      <span className="rule-ack-modal__skipped">already has marker</span>
                    ) : (
                      <input
                        className={`rule-ack-modal__id ${isDup ? 'rule-ack-modal__id--dup' : ''}`}
                        value={idValue}
                        onChange={(e) => setIdOverride(entry.filePath, e.target.value)}
                        aria-label={`canary id for ${entry.filePath}`}
                      />
                    )}
                  </li>
                );
              })}
            </ul>

            <footer className="rule-ack-modal__footer">
              <button onClick={onClose}>Cancel</button>
              <button
                className="rule-ack-modal__primary"
                disabled={selectedCount === 0 || duplicates.size > 0}
                onClick={onApply}
              >
                Apply to {selectedCount} file{selectedCount === 1 ? '' : 's'}
              </button>
            </footer>
          </>
        )}

        {phase === 'applying' && <p className="rule-ack-modal__status">Writing files…</p>}

        {phase === 'done' && applyResult && (
          <>
            <p className="rule-ack-modal__status">
              {applyResult.ok
                ? `Applied to ${applyResult.applied.length} file(s). Backups saved as *.md.bak.`
                : `Apply failed at ${applyResult.failedAt?.filePath ?? 'unknown'}. Already-applied files were rolled back.`}
            </p>
            <footer className="rule-ack-modal__footer">
              <button className="rule-ack-modal__primary" onClick={onClose}>Close</button>
            </footer>
          </>
        )}

        {phase === 'error' && (
          <>
            <p className="rule-ack-modal__error">Error: {error}</p>
            <footer className="rule-ack-modal__footer">
              <button onClick={onClose}>Close</button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
};
