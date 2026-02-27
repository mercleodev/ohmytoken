import { useState } from 'react';
import type { SessionAlert as SessionAlertType } from '../../utils/sessionAlerts';

type SessionAlertProps = {
  alerts: SessionAlertType[];
};

export const SessionAlertBanner = ({ alerts }: SessionAlertProps) => {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const visible = alerts.filter((a) => !dismissed.has(a.id));
  if (visible.length === 0) return null;

  const dismiss = (id: string) => {
    setDismissed((prev) => new Set(prev).add(id));
  };

  return (
    <div className="session-alerts">
      {visible.map((alert) => (
        <div
          key={alert.id}
          className={`session-alert session-alert--${alert.severity}`}
        >
          <div className="session-alert-content">
            <span className="session-alert-icon">
              {alert.severity === 'warning' ? '⚠' : 'ℹ'}
            </span>
            <div className="session-alert-text">
              <div className="session-alert-message">{alert.message}</div>
              <div className="session-alert-tip">{alert.tip}</div>
            </div>
            <button
              className="session-alert-close"
              onClick={() => dismiss(alert.id)}
              aria-label="Dismiss alert"
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};
