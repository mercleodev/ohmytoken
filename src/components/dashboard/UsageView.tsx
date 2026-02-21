import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ProviderUsageSnapshot, ProviderTokenStatus, CreditBalance } from '../../types';
import type { ScanStats } from '../../types';
import { formatTimeAgo } from '../../utils/format';
import { UsageGaugeCard } from './UsageGaugeCard';
import { CostCard } from './CostCard';
import { StatsCard } from './StatsCard';
import { SetupGuide } from './SetupGuide';
import { RecentSessions } from './RecentSessions';

type UsageViewProps = {
  snapshot: ProviderUsageSnapshot | null;
  tokenStatus: ProviderTokenStatus | null;
  loading: boolean;
  onSelectSession?: (sessionId: string) => void;
  onSelectStats?: (stats: ScanStats) => void;
  scanRevision?: number;
};

const CreditBalanceCard = ({ creditBalance }: { creditBalance: CreditBalance }) => {
  const formatUSD = (n: number): string => `$${n.toFixed(2)}`;
  const formatExpiry = (iso: string): string => {
    const d = new Date(iso);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  };

  return (
    <div className="credit-balance-card">
      <div className="credit-balance-header">API Credit Balance</div>
      <div className="credit-balance-amount">{formatUSD(creditBalance.balanceUSD)}</div>
      {(creditBalance.grantedUSD !== undefined || creditBalance.usedUSD !== undefined) && (
        <div className="credit-balance-detail">
          {creditBalance.grantedUSD !== undefined && (
            <div className="credit-balance-row">
              <span>Granted</span>
              <span>{formatUSD(creditBalance.grantedUSD)}</span>
            </div>
          )}
          {creditBalance.usedUSD !== undefined && (
            <div className="credit-balance-row">
              <span>Used</span>
              <span>{formatUSD(creditBalance.usedUSD)}</span>
            </div>
          )}
          {creditBalance.expiresAt && (
            <div className="credit-balance-row">
              <span>Expires</span>
              <span>{formatExpiry(creditBalance.expiresAt)}</span>
            </div>
          )}
        </div>
      )}
      {creditBalance.grantedUSD !== undefined && creditBalance.grantedUSD > 0 && (
        <div className="credit-balance-bar-track">
          <div
            className="credit-balance-bar-fill"
            style={{
              width: `${Math.min(100, (creditBalance.balanceUSD / creditBalance.grantedUSD) * 100)}%`,
            }}
          />
        </div>
      )}
    </div>
  );
};

const LastUpdatedLabel = ({ updatedAt }: { updatedAt: string }) => {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="usage-last-updated">
      Last updated: {formatTimeAgo(updatedAt)}
    </div>
  );
};

export const UsageView = ({ snapshot, tokenStatus, loading, onSelectSession, onSelectStats, scanRevision }: UsageViewProps) => {
  // Show SetupGuide when token is missing or expired
  if (tokenStatus && (!tokenStatus.hasToken || tokenStatus.tokenExpired || !tokenStatus.installed)) {
    return <SetupGuide status={tokenStatus} />;
  }

  // Loading data
  if (loading && !snapshot) {
    return (
      <motion.div
        className="setup-guide"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <div className="setup-guide-icon" style={{ animation: 'spin 1s linear infinite' }}>↻</div>
        <div className="setup-guide-title">Loading usage data...</div>
      </motion.div>
    );
  }

  // No data
  if (!snapshot) {
    return (
      <motion.div
        className="setup-guide"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <div className="setup-guide-icon">—</div>
        <div className="setup-guide-title">Unable to load usage data</div>
        <div className="setup-guide-desc">Try refreshing or check your CLI status.</div>
      </motion.div>
    );
  }

  // Prepaid account: when notice exists and windows are empty
  if (snapshot.notice && snapshot.windows.length === 0) {
    return (
      <div>
        {/* Provider Header */}
        <div className="provider-header">
          <div className="provider-header-left">
            <div className="provider-header-name">{snapshot.displayName}</div>
            <div className="provider-header-updated">{formatTimeAgo(snapshot.updatedAt)}</div>
          </div>
          {snapshot.identity?.plan && (
            <div className="provider-header-plan">{snapshot.identity.plan}</div>
          )}
        </div>

        {/* Credit Balance */}
        {snapshot.creditBalance && (
          <CreditBalanceCard creditBalance={snapshot.creditBalance} />
        )}

        {/* Notice */}
        <div className="prepaid-notice">
          <div className="prepaid-notice-icon">i</div>
          <div className="prepaid-notice-text">
            {snapshot.notice.split('\n').map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        </div>

        {/* Stats */}
        {onSelectStats && (
          <StatsCard onSelectStats={onSelectStats} scanRevision={scanRevision} />
        )}

        {/* Recent Sessions (CT Scan) */}
        {onSelectSession && (
          <RecentSessions onSelectSession={onSelectSession} scanRevision={scanRevision} />
        )}
      </div>
    );
  }

  return (
    <div>
      {/* Provider Header */}
      <div className="provider-header">
        <div className="provider-header-left">
          <div className="provider-header-name">{snapshot.displayName}</div>
          <div className="provider-header-updated">{formatTimeAgo(snapshot.updatedAt)}</div>
        </div>
        {snapshot.identity?.plan && (
          <div className="provider-header-plan">{snapshot.identity.plan}</div>
        )}
      </div>

      {/* Usage Gauges */}
      <UsageGaugeCard windows={snapshot.windows} />

      {/* Last Updated Time */}
      <LastUpdatedLabel updatedAt={snapshot.updatedAt} />

      {/* Cost */}
      <CostCard cost={snapshot.cost} />

      {/* Stats */}
      {onSelectStats && (
        <StatsCard onSelectStats={onSelectStats} scanRevision={scanRevision} />
      )}

      {/* Recent Sessions */}
      {onSelectSession && (
        <RecentSessions onSelectSession={onSelectSession} scanRevision={scanRevision} />
      )}
    </div>
  );
};
