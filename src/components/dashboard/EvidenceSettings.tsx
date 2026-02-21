import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import type { EvidenceEngineConfig, SignalConfig } from "../../types";

/**
 * Signal metadata for display — name, brief description, paper reference.
 */
const SIGNAL_META: Record<
  string,
  { name: string; description: string; paper: string }
> = {
  "category-prior": {
    name: "Category Prior",
    description: "Bayesian prior based on file category (global/project/rules/memory/skill).",
    paper: "Gelman et al., Bayesian Data Analysis (2013)",
  },
  "text-overlap": {
    name: "Text Overlap",
    description: "MinHash-based n-gram similarity between file content and assistant response.",
    paper: "Broder, On the resemblance of syntactic similarity (1997)",
  },
  "instruction-compliance": {
    name: "Instruction Compliance",
    description: "Detects directive patterns (MUST, ALWAYS) that the response follows.",
    paper: "Wallace et al., Universal Adversarial Triggers (EMNLP 2019)",
  },
  "tool-reference": {
    name: "Tool Reference",
    description: "Direct/indirect tool call references to the file path.",
    paper: "Schick et al., Toolformer (NeurIPS 2023)",
  },
  "position-effect": {
    name: "Position Effect",
    description: "Primacy/recency bias based on file position in system prompt.",
    paper: "Liu et al., Lost in the Middle (TACL 2024)",
  },
  "token-proportion": {
    name: "Token Proportion",
    description: "Proportion of file tokens relative to total injected tokens.",
    paper: "Shi et al., Large Language Models Can Be Easily Distracted (ICML 2023)",
  },
  "session-history": {
    name: "Session History",
    description: "Exponential decay bonus from previous scores in the same session.",
    paper: "Ebbinghaus, Memory: A Contribution to Experimental Psychology (1885)",
  },
};

type EvidenceSettingsProps = {
  onClose: () => void;
  onSave: () => void;
};

export const EvidenceSettings = ({ onClose, onSave }: EvidenceSettingsProps) => {
  const [config, setConfig] = useState<EvidenceEngineConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    window.api?.getEvidenceConfig?.().then((cfg) => {
      setConfig(cfg);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const updateEnabled = useCallback((enabled: boolean) => {
    setConfig((prev) => prev ? { ...prev, enabled } : prev);
  }, []);

  const updateFusionMethod = useCallback(
    (fusion_method: "weighted_sum" | "dempster_shafer") => {
      setConfig((prev) => prev ? { ...prev, fusion_method } : prev);
    },
    [],
  );

  const updateThreshold = useCallback(
    (key: "confirmed_min" | "likely_min", value: number) => {
      setConfig((prev) =>
        prev
          ? { ...prev, thresholds: { ...prev.thresholds, [key]: value } }
          : prev,
      );
    },
    [],
  );

  const updateSignal = useCallback(
    (signalId: string, patch: Partial<SignalConfig>) => {
      setConfig((prev) => {
        if (!prev) return prev;
        const existing = prev.signals[signalId];
        if (!existing) return prev;
        return {
          ...prev,
          signals: {
            ...prev.signals,
            [signalId]: { ...existing, ...patch },
          },
        };
      });
    },
    [],
  );

  const updateSignalParam = useCallback(
    (signalId: string, paramKey: string, value: number | string | boolean) => {
      setConfig((prev) => {
        if (!prev) return prev;
        const existing = prev.signals[signalId];
        if (!existing) return prev;
        return {
          ...prev,
          signals: {
            ...prev.signals,
            [signalId]: {
              ...existing,
              params: { ...existing.params, [paramKey]: value },
            },
          },
        };
      });
    },
    [],
  );

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    try {
      await window.api?.updateEvidenceConfig?.(config);
      onSave();
      onClose();
    } catch {
      /* best-effort */
    } finally {
      setSaving(false);
    }
  };

  const handleResetDefaults = async () => {
    setLoading(true);
    try {
      await window.api?.updateEvidenceConfig?.({ version: "reset" });
      const cfg = await window.api?.getEvidenceConfig?.();
      setConfig(cfg);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      className="ctx-settings-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="evidence-settings-panel"
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 20, opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="ctx-settings-header">
          <span className="ctx-settings-title">Evidence Scoring</span>
          <button className="ctx-settings-close" onClick={onClose}>
            ESC
          </button>
        </div>

        <div className="evidence-settings-body">
          {loading || !config ? (
            <div className="evidence-settings-loading">Loading...</div>
          ) : (
            <>
              {/* Global Toggle */}
              <div className="evidence-settings-row">
                <span className="evidence-settings-label">Scoring Engine</span>
                <button
                  className={`evidence-toggle ${config.enabled ? "on" : ""}`}
                  onClick={() => updateEnabled(!config.enabled)}
                  aria-label="Toggle evidence scoring"
                >
                  <span className="evidence-toggle-thumb" />
                </button>
              </div>

              {/* Fusion Method */}
              <div className="evidence-settings-section">
                <div className="evidence-settings-section-title">
                  Fusion Method
                </div>
                <div className="evidence-settings-radios">
                  <label className="evidence-radio">
                    <input
                      type="radio"
                      name="fusion"
                      checked={config.fusion_method === "weighted_sum"}
                      onChange={() => updateFusionMethod("weighted_sum")}
                    />
                    <span>Weighted Sum</span>
                  </label>
                  <label className="evidence-radio">
                    <input
                      type="radio"
                      name="fusion"
                      checked={config.fusion_method === "dempster_shafer"}
                      onChange={() => updateFusionMethod("dempster_shafer")}
                    />
                    <span>Dempster-Shafer</span>
                  </label>
                </div>
              </div>

              {/* Thresholds */}
              <div className="evidence-settings-section">
                <div className="evidence-settings-section-title">
                  Classification Thresholds
                </div>
                <div className="evidence-settings-threshold-row">
                  <label className="evidence-threshold-label">
                    Confirmed min
                  </label>
                  <input
                    type="number"
                    className="evidence-settings-input"
                    value={config.thresholds.confirmed_min}
                    onChange={(e) =>
                      updateThreshold(
                        "confirmed_min",
                        parseFloat(e.target.value) || 0,
                      )
                    }
                    min={0}
                    max={1}
                    step={0.05}
                  />
                </div>
                <div className="evidence-settings-threshold-row">
                  <label className="evidence-threshold-label">
                    Likely min
                  </label>
                  <input
                    type="number"
                    className="evidence-settings-input"
                    value={config.thresholds.likely_min}
                    onChange={(e) =>
                      updateThreshold(
                        "likely_min",
                        parseFloat(e.target.value) || 0,
                      )
                    }
                    min={0}
                    max={1}
                    step={0.05}
                  />
                </div>
              </div>

              {/* Signal Cards */}
              <div className="evidence-settings-section">
                <div className="evidence-settings-section-title">
                  Signals ({Object.keys(config.signals).length})
                </div>
                {Object.entries(config.signals).map(([id, signal]) => {
                  const meta = SIGNAL_META[id];
                  return (
                    <SignalCard
                      key={id}
                      signalId={id}
                      signal={signal}
                      name={meta?.name ?? id}
                      description={meta?.description ?? ""}
                      paper={meta?.paper ?? ""}
                      onToggle={(enabled) =>
                        updateSignal(id, { enabled })
                      }
                      onWeightChange={(weight) =>
                        updateSignal(id, { weight })
                      }
                      onParamChange={(key, val) =>
                        updateSignalParam(id, key, val)
                      }
                    />
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="evidence-settings-footer">
          <button
            className="evidence-settings-reset"
            onClick={handleResetDefaults}
            disabled={loading}
          >
            Reset Defaults
          </button>
          <div className="evidence-settings-footer-right">
            <button className="ctx-settings-cancel" onClick={onClose}>
              Cancel
            </button>
            <button
              className="ctx-settings-save"
              onClick={handleSave}
              disabled={saving || loading}
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};

// --- Signal Card Sub-component ---

type SignalCardProps = {
  signalId: string;
  signal: SignalConfig;
  name: string;
  description: string;
  paper: string;
  onToggle: (enabled: boolean) => void;
  onWeightChange: (weight: number) => void;
  onParamChange: (key: string, value: number | string | boolean) => void;
};

const SignalCard = ({
  signal,
  name,
  description,
  paper,
  onToggle,
  onWeightChange,
  onParamChange,
}: SignalCardProps) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`evidence-signal-card${signal.enabled ? "" : " disabled"}`}>
      <div className="evidence-signal-card-header">
        <button
          className="evidence-signal-card-expand"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? "\u25B4" : "\u25BE"}
        </button>
        <span
          className="evidence-signal-card-name"
          onClick={() => setExpanded((v) => !v)}
        >
          {name}
        </span>
        <span className="evidence-signal-card-weight">
          w:
          <input
            type="number"
            className="evidence-weight-input"
            value={signal.weight}
            onChange={(e) =>
              onWeightChange(parseFloat(e.target.value) || 0)
            }
            min={0}
            max={1}
            step={0.1}
          />
        </span>
        <button
          className={`evidence-toggle small ${signal.enabled ? "on" : ""}`}
          onClick={() => onToggle(!signal.enabled)}
          aria-label={`Toggle ${name}`}
        >
          <span className="evidence-toggle-thumb" />
        </button>
      </div>
      {expanded && (
        <div className="evidence-signal-card-body">
          {description && (
            <div className="evidence-signal-desc">{description}</div>
          )}
          {paper && <div className="evidence-signal-paper">{paper}</div>}
          {Object.entries(signal.params).length > 0 && (
            <div className="evidence-signal-params">
              {Object.entries(signal.params).map(([key, val]) => (
                <div key={key} className="evidence-signal-param-row">
                  <label className="evidence-signal-param-label">{key}</label>
                  {typeof val === "number" ? (
                    <input
                      type="number"
                      className="evidence-settings-input small"
                      value={val}
                      onChange={(e) =>
                        onParamChange(
                          key,
                          parseFloat(e.target.value) || 0,
                        )
                      }
                      step={val >= 1 ? 1 : 0.1}
                    />
                  ) : typeof val === "boolean" ? (
                    <button
                      className={`evidence-toggle small ${val ? "on" : ""}`}
                      onClick={() => onParamChange(key, !val)}
                    >
                      <span className="evidence-toggle-thumb" />
                    </button>
                  ) : (
                    <input
                      type="text"
                      className="evidence-settings-input small"
                      value={String(val)}
                      onChange={(e) => onParamChange(key, e.target.value)}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
