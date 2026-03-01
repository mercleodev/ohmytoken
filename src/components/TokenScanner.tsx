import { useState, useEffect, useCallback } from 'react';
import './TokenScanner.css';
import type { ScanTokensResult } from '../types';

type TokenScannerProps = {
  onBack: () => void;
};

export const TokenScanner = ({ onBack }: TokenScannerProps) => {
  const [isScanning, setIsScanning] = useState(false);
  const [breakdown, setBreakdown] = useState<ScanTokensResult['breakdown'] | null>(null);
  const [recentRequests, setRecentRequests] = useState<NonNullable<ScanTokensResult['recentRequests']>>([]);
  const [scanProgress, setScanProgress] = useState(0);

  // Start scan
  const startScan = useCallback(async () => {
    setIsScanning(true);
    setScanProgress(0);

    try {
      // Progress animation
      for (let i = 0; i <= 100; i += 5) {
        setScanProgress(i);
        await new Promise(r => setTimeout(r, 50));
      }

      // Fetch analysis data from API
      const data = await window.api.scanTokens();

      if (data) {
        setBreakdown(data.breakdown);
        setRecentRequests(data.recentRequests || []);
      }
    } catch (error) {
      console.error('Scan error:', error);
    } finally {
      setIsScanning(false);
    }
  }, []);

  // Auto-scan on component mount
  useEffect(() => {
    startScan();
  }, []);

  // Token bar calculation
  const getBarWidth = (tokens: number, total: number) => {
    if (total === 0) return 0;
    return Math.min((tokens / total) * 100, 100);
  };

  // Token color (heatmap)
  const getTokenColor = (percentage: number) => {
    if (percentage >= 50) return '#ff4444'; // Red - critical
    if (percentage >= 30) return '#ffaa00'; // Orange - warning
    if (percentage >= 15) return '#ffff00'; // Yellow - caution
    return '#44ff44'; // Green - good
  };

  const totalTokens = breakdown?.total || 1;

  return (
    <div className="token-scanner">
      <div className="scanner-header">
        <button className="back-btn" onClick={onBack}>← Back</button>
        <h2>🔬 Token Scanner</h2>
        <button
          className="scan-btn"
          onClick={startScan}
          disabled={isScanning}
        >
          {isScanning ? 'Scanning...' : 'Rescan'}
        </button>
      </div>

      {/* Scan progress */}
      {isScanning && (
        <div className="scan-progress">
          <div className="progress-bar">
            <div
              className="progress-fill scanning"
              style={{ width: `${scanProgress}%` }}
            />
          </div>
          <span className="progress-text">Analyzing... {scanProgress}%</span>
        </div>
      )}

      {/* MRI scan results */}
      {breakdown && !isScanning && (
        <>
          <div className="mri-view">
            <h3>📊 Token Distribution (MRI Scan)</h3>

            {/* CLAUDE.md */}
            <div className="token-row">
              <div className="token-label">
                <span className="icon">📄</span>
                <span>CLAUDE.md</span>
              </div>
              <div className="token-bar-container">
                <div
                  className="token-bar"
                  style={{
                    width: `${getBarWidth(breakdown.claudeMd.total, totalTokens)}%`,
                    backgroundColor: getTokenColor(
                      (breakdown.claudeMd.total / totalTokens) * 100
                    ),
                  }}
                />
              </div>
              <div className="token-value">
                {breakdown.claudeMd.total.toLocaleString()}
                <span className="percentage">
                  ({((breakdown.claudeMd.total / totalTokens) * 100).toFixed(1)}%)
                </span>
              </div>
            </div>

            {/* Cache Creation */}
            <div className="token-row">
              <div className="token-label">
                <span className="icon">💾</span>
                <span>Cache Creation</span>
              </div>
              <div className="token-bar-container">
                <div
                  className="token-bar"
                  style={{
                    width: `${getBarWidth(breakdown.cacheCreation, totalTokens)}%`,
                    backgroundColor: getTokenColor(
                      (breakdown.cacheCreation / totalTokens) * 100
                    ),
                  }}
                />
              </div>
              <div className="token-value">
                {breakdown.cacheCreation.toLocaleString()}
                <span className="percentage">
                  ({((breakdown.cacheCreation / totalTokens) * 100).toFixed(1)}%)
                </span>
              </div>
            </div>

            {/* User Input */}
            <div className="token-row">
              <div className="token-label">
                <span className="icon">👤</span>
                <span>User Input</span>
              </div>
              <div className="token-bar-container">
                <div
                  className="token-bar"
                  style={{
                    width: `${getBarWidth(breakdown.userInput, totalTokens)}%`,
                    backgroundColor: '#4a9eff',
                  }}
                />
              </div>
              <div className="token-value">
                {breakdown.userInput.toLocaleString()}
                <span className="percentage">
                  ({((breakdown.userInput / totalTokens) * 100).toFixed(1)}%)
                </span>
              </div>
            </div>

            {/* Output */}
            <div className="token-row">
              <div className="token-label">
                <span className="icon">🤖</span>
                <span>AI Response</span>
              </div>
              <div className="token-bar-container">
                <div
                  className="token-bar"
                  style={{
                    width: `${getBarWidth(breakdown.output, totalTokens)}%`,
                    backgroundColor: '#9b59b6',
                  }}
                />
              </div>
              <div className="token-value">
                {breakdown.output.toLocaleString()}
                <span className="percentage">
                  ({((breakdown.output / totalTokens) * 100).toFixed(1)}%)
                </span>
              </div>
            </div>

            {/* Cache Read (cheap) */}
            <div className="token-row cache-read">
              <div className="token-label">
                <span className="icon">⚡</span>
                <span>Cache Read (90% discount)</span>
              </div>
              <div className="token-bar-container">
                <div
                  className="token-bar"
                  style={{
                    width: `${Math.min((breakdown.cacheRead / (totalTokens * 5)) * 100, 100)}%`,
                    backgroundColor: '#2ecc71',
                  }}
                />
              </div>
              <div className="token-value">
                {breakdown.cacheRead.toLocaleString()}
                <span className="saved">💰 Saved!</span>
              </div>
            </div>

            {/* Total */}
            <div className="token-total">
              <span>Total Tokens:</span>
              <span className="total-value">{totalTokens.toLocaleString()}</span>
            </div>
          </div>

          {/* Recent request history */}
          {recentRequests.length > 0 && (
            <div className="recent-requests">
              <h3>📋 Recent Requests</h3>
              <div className="requests-list">
                {recentRequests.slice(0, 5).map((req, idx) => (
                  <div key={idx} className="request-item">
                    <span className="req-time">
                      {new Date(req.timestamp).toLocaleTimeString('en-US')}
                    </span>
                    <div className="req-tokens">
                      <span className="req-in">↓{req.inputTokens}</span>
                      <span className="req-out">↑{req.outputTokens}</span>
                      <span className="req-cache">⚡{req.cacheRead}</span>
                    </div>
                    <span className="req-total">{req.total.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
