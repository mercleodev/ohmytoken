import type { GuardrailAssessment } from '../../../guardrails/types';
import {
  getSeverityColor,
  getSeverityIcon,
  formatSavings,
} from '../../notification/guardrailCardHelpers';
import {
  shouldShowGuardrailSummary,
  getHealthStyle,
  formatEvidenceBullets,
  getLowValueFileSummary,
} from './guardrailSummaryHelpers';

type GuardrailSummaryProps = {
  assessment: GuardrailAssessment | undefined;
};

const formatTokensShort = (n: number): string => {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
};

export const GuardrailSummary = ({ assessment }: GuardrailSummaryProps) => {
  if (!shouldShowGuardrailSummary(assessment)) return null;
  // Type narrowed: assessment is defined
  const a = assessment!;

  const healthStyle = getHealthStyle(a.summary.sessionHealth);
  const { primary } = a;
  const evidenceBullets = primary ? formatEvidenceBullets(primary.evidence) : [];
  const lowValueFiles = getLowValueFileSummary(a);

  return (
    <div className="guardrail-summary">
      {/* Health badge */}
      <div className="guardrail-summary-header">
        <span className="guardrail-summary-title">Guardrail</span>
        <span
          className="guardrail-health-badge"
          style={{ color: healthStyle.color, background: healthStyle.bg }}
        >
          {healthStyle.label}
        </span>
      </div>

      {/* Primary recommendation */}
      {primary && (
        <div
          className="guardrail-primary-detail"
          style={{ borderLeftColor: getSeverityColor(primary.severity) }}
        >
          <div className="guardrail-primary-title-row">
            <span className="guardrail-primary-icon">
              {getSeverityIcon(primary.severity)}
            </span>
            <span className="guardrail-primary-title">{primary.title}</span>
            <span className="guardrail-primary-confidence">
              {(primary.confidence * 100).toFixed(0)}%
            </span>
          </div>
          <div className="guardrail-primary-reason">{primary.reason}</div>
          <div className="guardrail-primary-action">{primary.action}</div>

          {/* Savings */}
          {primary.estimatedSavings && (
            <div className="guardrail-primary-savings">
              {formatSavings(primary.estimatedSavings)}
            </div>
          )}

          {/* Evidence bullets */}
          {evidenceBullets.length > 0 && (
            <ul className="guardrail-evidence-list">
              {evidenceBullets.map((e, i) => (
                <li key={i} className="guardrail-evidence-item">{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Secondary recommendations */}
      {a.secondary.length > 0 && (
        <div className="guardrail-secondary-list">
          {a.secondary.slice(0, 2).map((rec) => (
            <div
              key={rec.id}
              className="guardrail-secondary-item"
              style={{ borderLeftColor: getSeverityColor(rec.severity) }}
            >
              <span className="guardrail-secondary-icon">
                {getSeverityIcon(rec.severity)}
              </span>
              <div className="guardrail-secondary-content">
                <span className="guardrail-secondary-title">{rec.title}</span>
                <span className="guardrail-secondary-reason">{rec.reason}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Low-value file candidates */}
      {lowValueFiles.length > 0 && (
        <div className="guardrail-lowvalue-section">
          {lowValueFiles.map((f, i) => (
            <div key={i} className="guardrail-lowvalue-item">
              <span className="guardrail-lowvalue-tokens">
                ~{formatTokensShort(f.tokens)} tok
              </span>
              <span className="guardrail-lowvalue-note">{f.note}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
