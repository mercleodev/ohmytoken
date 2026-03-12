import { useState, useCallback, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { UsageDashboard } from "./components/dashboard/UsageDashboard";
import { SettingsSection } from "./components/SettingsSection";
import { NotificationOverlay } from "./components/notification/NotificationOverlay";
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
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [pendingPromptNav, setPendingPromptNav] = useState<PendingPromptNav | null>(null);

  const handleBackToDashboard = useCallback(() => setView("dashboard"), []);

  // Load notification setting on mount
  useEffect(() => {
    window.api.getUsageData().then((data) => {
      if (data?.settings) {
        setNotificationsEnabled(data.settings.notificationsEnabled ?? true);
      }
    }).catch(() => {});
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

  const handleSaveSettings = useCallback(async (newSettings: AppSettings) => {
    await window.api.saveSettings(newSettings);
    setNotificationsEnabled(newSettings.notificationsEnabled ?? true);
    setView("dashboard");
  }, []);

  // Notification click → navigate to prompt detail
  const handleNotificationNavigate = useCallback((scan: PromptScan, usage: UsageLogEntry | null) => {
    // Switch to dashboard if not already there
    setView("dashboard");
    setPendingPromptNav({ scan, usage });
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

      {/* Notification overlay — always mounted, sits above everything */}
      <NotificationOverlay
        enabled={notificationsEnabled}
        onNavigateToPrompt={handleNotificationNavigate}
      />
    </div>
  );
};

export default App;
