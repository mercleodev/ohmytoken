import { useState, useCallback, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { UsageDashboard } from "./components/dashboard/UsageDashboard";
import { SettingsSection } from "./components/SettingsSection";
import { AppSettings } from "./types";
import type { PromptScan, UsageLogEntry } from "./types/electron";
import "./App.css";

type View = "dashboard" | "settings";

type PendingPromptNav = {
  scan: PromptScan;
  usage: UsageLogEntry | null;
};

const App = () => {
  const [view, setView] = useState<View>("dashboard");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [pendingPromptNav, setPendingPromptNav] = useState<PendingPromptNav | null>(null);

  const handleBackToDashboard = useCallback(() => setView("dashboard"), []);

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

  return (
    <div className="app-root">
      <AnimatePresence mode="wait">
        {view === "dashboard" && (
          <motion.div
            key="dashboard"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ type: 'spring', stiffness: 350, damping: 30 }}
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
            transition={{ type: 'spring', stiffness: 350, damping: 30 }}
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
