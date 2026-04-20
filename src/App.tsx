import { useState, useCallback, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { UsageDashboard } from "./components/dashboard/UsageDashboard";
import { SettingsSection } from "./components/SettingsSection";
import { FirstRunOnboarding } from "./components/dashboard/FirstRunOnboarding";
import { AppSettings } from "./types";
import type { PromptScan, UsageLogEntry } from "./types/electron";
import type { ProviderConnectionStatus } from "./types";
import "./App.css";

type View = "first-run" | "dashboard" | "settings";

type PendingPromptNav = {
  scan: PromptScan;
  usage: UsageLogEntry | null;
};

const App = () => {
  const [view, setView] = useState<View>("dashboard");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [pendingPromptNav, setPendingPromptNav] = useState<PendingPromptNav | null>(null);
  const [firstRunStatuses, setFirstRunStatuses] = useState<ProviderConnectionStatus[]>([]);
  const [bootChecked, setBootChecked] = useState(false);

  const handleBackToDashboard = useCallback(() => setView("dashboard"), []);

  // First-run gate — runs once on boot.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const first = await window.api.getFirstRunStatus?.();
        if (cancelled) return;
        if (first?.isFirstRun) {
          const statuses = await window.api.getAllProviderConnectionStatus();
          if (cancelled) return;
          setFirstRunStatuses(statuses);
          setView("first-run");
        }
      } catch (err) {
        console.error("[App] First-run check failed:", err);
      } finally {
        if (!cancelled) setBootChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Listen for tray context menu navigation
  useEffect(() => {
    const cleanup = window.api.onNavigateTo((target) => {
      if (target === "settings") {
        window.api.getUsageData().then((data) => {
          setSettings(data.settings);
          setView("settings");
        });
      }
    });
    return cleanup;
  }, []);

  // Listen for notification window click → navigate to prompt detail
  useEffect(() => {
    if (!window.api.onNotificationNavigate) return;
    const cleanup = window.api.onNotificationNavigate((data: { scan: PromptScan; usage: UsageLogEntry | null }) => {
      setView("dashboard");
      setPendingPromptNav(data);
    });
    return cleanup;
  }, []);

  const handleSaveSettings = useCallback(async (newSettings: AppSettings) => {
    await window.api.saveSettings(newSettings);
    setView("dashboard");
  }, []);

  // After dashboard consumes the nav, clear it
  const handlePromptNavConsumed = useCallback(() => {
    setPendingPromptNav(null);
  }, []);

  const handleFirstRunComplete = useCallback(() => setView("dashboard"), []);
  const handleFirstRunSkip = useCallback(() => setView("dashboard"), []);

  if (!bootChecked) {
    return <div className="app-root" />;
  }

  return (
    <div className="app-root">
      <AnimatePresence mode="wait">
        {view === "first-run" && (
          <motion.div
            key="first-run"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="app-view"
          >
            <FirstRunOnboarding
              statuses={firstRunStatuses}
              onComplete={handleFirstRunComplete}
              onSkip={handleFirstRunSkip}
            />
          </motion.div>
        )}

        {view === "dashboard" && (
          <motion.div
            key="dashboard"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="app-view"
          >
            <UsageDashboard
              pendingPromptNav={pendingPromptNav}
              onPromptNavConsumed={handlePromptNavConsumed}
            />
          </motion.div>
        )}

        {view === "settings" && (
          <motion.div
            key="settings"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.2 }}
            className="app-view"
          >
            <SettingsSection
              settings={settings}
              onSave={handleSaveSettings}
              onCancel={handleBackToDashboard}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default App;
