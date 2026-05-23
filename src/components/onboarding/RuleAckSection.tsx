import { useEffect, useState, useCallback } from 'react';
import { RuleAckOnboardingModal } from './RuleAckOnboardingModal';

export const RuleAckSection = () => {
  const [open, setOpen] = useState(false);
  const [hasLastApply, setHasLastApply] = useState(false);
  const [rollbackMessage, setRollbackMessage] = useState<string | null>(null);
  const [rollbackBusy, setRollbackBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const has = await window.api.ruleAckOnboarding.hasLastApply();
      setHasLastApply(has);
    } catch (err) {
      console.error('[RuleAckSection] hasLastApply failed:', err);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onCloseModal = useCallback(() => {
    setOpen(false);
    void refresh();
  }, [refresh]);

  const onRollback = async () => {
    setRollbackBusy(true);
    setRollbackMessage(null);
    try {
      const result = await window.api.ruleAckOnboarding.rollback();
      setRollbackMessage(
        result.ok
          ? `Restored ${result.restored} file(s) from .md.bak backups.`
          : `Rollback partial: ${result.restored} restored, ${result.failed} failed.`,
      );
      await refresh();
    } catch (err) {
      setRollbackMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setRollbackBusy(false);
    }
  };

  return (
    <div className="settings-group rule-ack-section">
      <h3>Rule Ack Onboarding</h3>
      <p className="rule-ack-section__hint">
        Add <code>&lt;!-- canary:CANARY-&lt;id&gt; --&gt;</code> markers to your project and global
        rule files so the evidence engine can detect them deterministically via
        <code> [RULE-ACK:CANARY-…=USED|NOT_APPLICABLE]</code> tokens emitted by the assistant.
      </p>

      <div className="rule-ack-section__actions">
        <button onClick={() => setOpen(true)}>Scan and add ack headers</button>
        <button onClick={onRollback} disabled={!hasLastApply || rollbackBusy}>
          {rollbackBusy ? 'Reverting…' : 'Revert last rule-ack apply'}
        </button>
      </div>

      {rollbackMessage && (
        <p className="rule-ack-section__hint">{rollbackMessage}</p>
      )}

      <RuleAckOnboardingModal open={open} onClose={onCloseModal} />
    </div>
  );
};
