import { useState, useEffect, useCallback } from 'react';
import { AppSettings } from '../types';

type SettingsSectionProps = {
  settings: AppSettings | null;
  onSave: (settings: AppSettings) => void;
  onCancel: () => void;
};

const DEFAULT_PROXY_PORT = 8780;

const DEFAULT_SETTINGS: AppSettings = {
  colors: {
    low: '#4caf50',
    medium: '#ff9800',
    high: '#f44336'
  },
  toggleInterval: 2000,
  refreshInterval: 5,
  shortcut: 'CommandOrControl+Shift+T',
  proxyPort: DEFAULT_PROXY_PORT,
};

export const SettingsSection = ({ settings, onSave, onCancel }: SettingsSectionProps) => {
  const [colorLow, setColorLow] = useState(DEFAULT_SETTINGS.colors.low);
  const [colorMedium, setColorMedium] = useState(DEFAULT_SETTINGS.colors.medium);
  const [colorHigh, setColorHigh] = useState(DEFAULT_SETTINGS.colors.high);
  const [toggleInterval, setToggleInterval] = useState(DEFAULT_SETTINGS.toggleInterval);
  const [refreshInterval, setRefreshInterval] = useState(DEFAULT_SETTINGS.refreshInterval);
  const [shortcut, setShortcut] = useState(DEFAULT_SETTINGS.shortcut);
  const [proxyPort, setProxyPort] = useState(DEFAULT_SETTINGS.proxyPort);
  const [isRecording, setIsRecording] = useState(false);

  useEffect(() => {
    if (settings) {
      setColorLow(settings.colors.low);
      setColorMedium(settings.colors.medium);
      setColorHigh(settings.colors.high);
      setToggleInterval(settings.toggleInterval);
      setRefreshInterval(settings.refreshInterval);
      setShortcut(settings.shortcut || DEFAULT_SETTINGS.shortcut);
      setProxyPort(settings.proxyPort || DEFAULT_SETTINGS.proxyPort);
    }
  }, [settings]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!isRecording) return;

    e.preventDefault();
    e.stopPropagation();

    const keys: string[] = [];

    // Modifier keys
    if (e.metaKey || e.ctrlKey) keys.push('CommandOrControl');
    if (e.altKey) keys.push('Alt');
    if (e.shiftKey) keys.push('Shift');

    // Regular key (not a modifier)
    const key = e.key;
    if (!['Control', 'Meta', 'Alt', 'Shift'].includes(key)) {
      // Special key mapping
      const keyMap: Record<string, string> = {
        'ArrowUp': 'Up',
        'ArrowDown': 'Down',
        'ArrowLeft': 'Left',
        'ArrowRight': 'Right',
        ' ': 'Space',
        'Escape': 'Escape',
        'Enter': 'Return',
        'Backspace': 'Backspace',
        'Delete': 'Delete',
        'Tab': 'Tab'
      };

      const mappedKey = keyMap[key] || key.toUpperCase();
      keys.push(mappedKey);

      // Must be at least modifier + key combination
      if (keys.length >= 2) {
        setShortcut(keys.join('+'));
        setIsRecording(false);
      }
    }
  }, [isRecording]);

  useEffect(() => {
    if (isRecording) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isRecording, handleKeyDown]);

  const handleSave = () => {
    onSave({
      colors: {
        low: colorLow,
        medium: colorMedium,
        high: colorHigh
      },
      toggleInterval,
      refreshInterval,
      shortcut,
      proxyPort,
    });
  };

  const formatShortcutDisplay = (shortcutStr: string): string => {
    return shortcutStr
      .replace('CommandOrControl', '⌘/Ctrl')
      .replace('Command', '⌘')
      .replace('Control', 'Ctrl')
      .replace('Alt', '⌥')
      .replace('Shift', '⇧')
      .replace(/\+/g, ' + ');
  };

  return (
    <section className="settings-section">
      <h2>Settings</h2>

      <div className="settings-group">
        <h3>Progress Bar Colors</h3>

        <div className="color-row">
          <label>
            <span>Below 50% (Normal)</span>
            <div className="color-input-wrap">
              <input
                type="color"
                value={colorLow}
                onChange={(e) => setColorLow(e.target.value)}
              />
              <span className="color-preview" style={{ backgroundColor: colorLow }} />
            </div>
          </label>
        </div>

        <div className="color-row">
          <label>
            <span>50-80% (Caution)</span>
            <div className="color-input-wrap">
              <input
                type="color"
                value={colorMedium}
                onChange={(e) => setColorMedium(e.target.value)}
              />
              <span className="color-preview" style={{ backgroundColor: colorMedium }} />
            </div>
          </label>
        </div>

        <div className="color-row">
          <label>
            <span>Above 80% (Critical)</span>
            <div className="color-input-wrap">
              <input
                type="color"
                value={colorHigh}
                onChange={(e) => setColorHigh(e.target.value)}
              />
              <span className="color-preview" style={{ backgroundColor: colorHigh }} />
            </div>
          </label>
        </div>
      </div>

      <div className="settings-group">
        <h3>Timing</h3>

        <div className="form-group">
          <label htmlFor="toggleInterval">Toggle Interval (sec)</label>
          <input
            type="number"
            id="toggleInterval"
            min={0.5}
            max={10}
            step={0.5}
            value={toggleInterval / 1000}
            onChange={(e) => setToggleInterval(Number(e.target.value) * 1000)}
          />
          <p className="hint">Interval for switching between usage and remaining time</p>
        </div>

        <div className="form-group">
          <label htmlFor="refreshInterval">API Refresh Interval (min)</label>
          <input
            type="number"
            id="refreshInterval"
            min={1}
            max={60}
            step={1}
            value={refreshInterval}
            onChange={(e) => setRefreshInterval(Number(e.target.value))}
          />
          <p className="hint">How often to fetch usage data from the server</p>
        </div>
      </div>

      <div className="settings-group">
        <h3>Keyboard Shortcut</h3>

        <div className="form-group">
          <label>Toggle App</label>
          <div className="shortcut-input-wrap">
            <button
              className={`shortcut-btn ${isRecording ? 'recording' : ''}`}
              onClick={() => setIsRecording(!isRecording)}
            >
              {isRecording ? 'Press a key...' : formatShortcutDisplay(shortcut)}
            </button>
          </div>
          <p className="hint">Click and press your desired key combo (e.g. ⌘+Shift+T)</p>
        </div>
      </div>

      <div className="settings-group">
        <h3>Proxy Settings</h3>

        <div className="form-group">
          <label htmlFor="proxyPort">Proxy Port</label>
          <input
            type="number"
            id="proxyPort"
            min={1024}
            max={65535}
            step={1}
            value={proxyPort}
            onChange={(e) => {
              const val = Number(e.target.value);
              if (val >= 1024 && val <= 65535) {
                setProxyPort(val);
              }
            }}
          />
          <p className="hint">
            Claude Code routes API requests through this port (1024-65535)
          </p>
        </div>

        <div className="form-group">
          <label>Claude Code Launch Command</label>
          <code className="command-preview">
            ANTHROPIC_BASE_URL=http://localhost:{proxyPort} claude
          </code>
          <p className="hint">
            Automatically saved to ~/.claude/settings.json
          </p>
        </div>
      </div>

      <div className="btn-group">
        <button className="primary-btn" onClick={handleSave}>
          Save
        </button>
        <button className="secondary-btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  );
};
