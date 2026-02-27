import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { BackfillProgress, BackfillResult } from '../../types/electron';

type BackfillDialogProps = {
  onComplete: () => void;
  onDismiss: () => void;
};

type DialogState =
  | { phase: 'prompt'; fileCount: number }
  | { phase: 'progress'; progress: BackfillProgress }
  | { phase: 'complete'; result: BackfillResult };

export const BackfillDialog = ({ onComplete, onDismiss }: BackfillDialogProps) => {
  const [state, setState] = useState<DialogState | null>(null);

  useEffect(() => {
    const loadCount = async () => {
      try {
        const count = await window.api.backfillCount();
        setState({ phase: 'prompt', fileCount: count });
      } catch {
        setState({ phase: 'prompt', fileCount: 0 });
      }
    };
    loadCount();
  }, []);

  useEffect(() => {
    const cleanupProgress = window.api.onBackfillProgress((progress) => {
      setState({ phase: 'progress', progress });
    });
    const cleanupComplete = window.api.onBackfillComplete((result) => {
      setState({ phase: 'complete', result });
    });
    return () => {
      cleanupProgress();
      cleanupComplete();
    };
  }, []);

  const handleStart = useCallback(async () => {
    setState({
      phase: 'progress',
      progress: {
        phase: 'scanning',
        totalFiles: 0,
        processedFiles: 0,
        discoveredMessages: 0,
        insertedMessages: 0,
        skippedDuplicates: 0,
        errors: 0,
      },
    });
    try {
      const result = await window.api.backfillStart();
      setState({ phase: 'complete', result });
    } catch {
      // Progress/complete events will handle state
    }
  }, []);

  const handleCancel = useCallback(async () => {
    await window.api.backfillCancel();
    onDismiss();
  }, [onDismiss]);

  const handleDone = useCallback(() => {
    onComplete();
  }, [onComplete]);

  if (!state) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="backfill-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div
          className="backfill-dialog"
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.2 }}
        >
          {state.phase === 'prompt' && (
            <PromptView
              fileCount={state.fileCount}
              onStart={handleStart}
              onDismiss={onDismiss}
            />
          )}
          {state.phase === 'progress' && (
            <ProgressView
              progress={state.progress}
              onCancel={handleCancel}
            />
          )}
          {state.phase === 'complete' && (
            <CompleteView
              result={state.result}
              onDone={handleDone}
            />
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

const PromptView = ({
  fileCount,
  onStart,
  onDismiss,
}: {
  fileCount: number;
  onStart: () => void;
  onDismiss: () => void;
}) => (
  <>
    <div className="backfill-icon">&#128203;</div>
    <div className="backfill-title">Import Past Usage</div>
    <div className="backfill-desc">
      Found <strong>{fileCount}</strong> Claude session {fileCount === 1 ? 'file' : 'files'}.
      Import past token usage data to see your full history.
    </div>
    <div className="backfill-actions">
      <button className="backfill-btn backfill-btn-primary" onClick={onStart}>
        Import
      </button>
      <button className="backfill-btn backfill-btn-secondary" onClick={onDismiss}>
        Later
      </button>
    </div>
  </>
);

const ProgressView = ({
  progress,
  onCancel,
}: {
  progress: BackfillProgress;
  onCancel: () => void;
}) => {
  const pct =
    progress.totalFiles > 0
      ? Math.round((progress.processedFiles / progress.totalFiles) * 100)
      : 0;

  return (
    <>
      <div className="backfill-title">Importing...</div>
      <div className="backfill-progress-bar-track">
        <motion.div
          className="backfill-progress-bar-fill"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.3 }}
        />
      </div>
      <div className="backfill-progress-stats">
        <span>{progress.processedFiles} / {progress.totalFiles} files</span>
        <span>{progress.insertedMessages} records found</span>
      </div>
      <div className="backfill-actions">
        <button className="backfill-btn backfill-btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </>
  );
};

const CompleteView = ({
  result,
  onDone,
}: {
  result: BackfillResult;
  onDone: () => void;
}) => {
  const formatCost = (usd: number): string =>
    usd >= 1 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(4)}`;

  const formatDateRange = (range: BackfillResult['dateRange']): string => {
    if (!range) return '';
    const fmt = (iso: string) => iso.slice(0, 10);
    return `${fmt(range.earliest)} ~ ${fmt(range.latest)}`;
  };

  return (
    <>
      <div className="backfill-icon">&#9989;</div>
      <div className="backfill-title">Import Complete</div>
      <div className="backfill-result-grid">
        <div className="backfill-result-item">
          <div className="backfill-result-value">{result.insertedMessages}</div>
          <div className="backfill-result-label">Records</div>
        </div>
        <div className="backfill-result-item">
          <div className="backfill-result-value">{formatCost(result.totalCostUsd)}</div>
          <div className="backfill-result-label">Total Cost</div>
        </div>
        {result.dateRange && (
          <div className="backfill-result-item backfill-result-wide">
            <div className="backfill-result-value">{formatDateRange(result.dateRange)}</div>
            <div className="backfill-result-label">Period</div>
          </div>
        )}
      </div>
      <div className="backfill-actions">
        <button className="backfill-btn backfill-btn-primary" onClick={onDone}>
          Go to Dashboard
        </button>
      </div>
    </>
  );
};
