import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  CONTEXT_LIMIT_PRESETS,
  PLAN_CONTEXT_LIMITS,
  setContextLimitOverride,
  getContextLimitOverride,
  formatTokens,
} from '../scan/shared';

type ContextLimitSettingsProps = {
  detectedPlan: string | null;
  onClose: () => void;
};

export const ContextLimitSettings = ({ detectedPlan, onClose }: ContextLimitSettingsProps) => {
  const [selected, setSelected] = useState(0);
  const [customValue, setCustomValue] = useState('');

  // Load current override on mount
  useEffect(() => {
    const current = getContextLimitOverride();
    const preset = CONTEXT_LIMIT_PRESETS.find((p) => p.value === current);
    if (preset) {
      setSelected(preset.value);
    } else if (current > 0) {
      setSelected(-1); // custom
      setCustomValue(String(current));
    }
  }, []);

  const planLimit = detectedPlan ? PLAN_CONTEXT_LIMITS[detectedPlan] ?? 200_000 : 200_000;

  const handleSave = async () => {
    const value = selected === -1 ? Number(customValue) || 0 : selected;
    setContextLimitOverride(value);

    // Persist to settings
    try {
      const data = await window.api.getUsageData();
      const settings = data?.settings ?? {
        colors: { low: '#4caf50', medium: '#ff9800', high: '#f44336' },
        toggleInterval: 2000,
        refreshInterval: 5,
        shortcut: 'CommandOrControl+Shift+T',
        proxyPort: 8780,
      };
      await window.api.saveSettings({ ...settings, contextLimitOverride: value });
    } catch { /* best-effort persist */ }

    onClose();
  };

  const effectiveLimit = selected === -1
    ? (Number(customValue) || planLimit)
    : selected === 0
      ? planLimit
      : selected;

  return (
    <motion.div
      className="ctx-settings-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="ctx-settings-panel"
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 20, opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ctx-settings-header">
          <span className="ctx-settings-title">Context Window Limit</span>
          <button className="ctx-settings-close" onClick={onClose}>ESC</button>
        </div>

        {/* Detected plan info */}
        <div className="ctx-settings-plan">
          <span className="ctx-settings-plan-label">Detected Plan</span>
          <span className="ctx-settings-plan-value">
            {detectedPlan ?? 'Unknown'}
            <span className="ctx-settings-plan-limit">
              {' '}({formatTokens(planLimit)} tokens)
            </span>
          </span>
        </div>

        {/* Presets */}
        <div className="ctx-settings-presets">
          {CONTEXT_LIMIT_PRESETS.map((preset) => (
            <button
              key={preset.value}
              className={`ctx-settings-preset ${selected === preset.value ? 'active' : ''}`}
              onClick={() => setSelected(preset.value)}
            >
              <span className="ctx-preset-radio">
                {selected === preset.value ? '\u25C9' : '\u25CB'}
              </span>
              <span>{preset.label}</span>
            </button>
          ))}
          <button
            className={`ctx-settings-preset ${selected === -1 ? 'active' : ''}`}
            onClick={() => setSelected(-1)}
          >
            <span className="ctx-preset-radio">
              {selected === -1 ? '\u25C9' : '\u25CB'}
            </span>
            <span>Custom</span>
          </button>
        </div>

        {/* Custom input */}
        {selected === -1 && (
          <div className="ctx-settings-custom">
            <input
              type="number"
              className="ctx-settings-input"
              value={customValue}
              onChange={(e) => setCustomValue(e.target.value)}
              placeholder="e.g. 200000"
              min={10000}
              max={10000000}
            />
            <span className="ctx-settings-input-hint">tokens</span>
          </div>
        )}

        {/* Effective limit preview */}
        <div className="ctx-settings-preview">
          Effective limit: <strong>{formatTokens(effectiveLimit)}</strong> tokens
        </div>

        {/* Actions */}
        <div className="ctx-settings-actions">
          <button className="ctx-settings-save" onClick={handleSave}>
            Save
          </button>
          <button className="ctx-settings-cancel" onClick={onClose}>
            Cancel
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};
