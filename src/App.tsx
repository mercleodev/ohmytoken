import { useState, useCallback, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { TokenTreemap } from "./components/TokenTreemap";
import { PromptScanView } from "./components/scan/PromptScanView";
import { UsageDashboard } from "./components/dashboard/UsageDashboard";
import { SettingsSection } from "./components/SettingsSection";
import { AppSettings } from "./types";
import "./App.css";

type View = "dashboard" | "analyzer" | "scan" | "settings";

const App = () => {
  const [view, setView] = useState<View>("dashboard");
  const [settings, setSettings] = useState<AppSettings | null>(null);

  const handleOpenAnalyzer = useCallback(() => setView("analyzer"), []);
  const handleOpenScan = useCallback(() => setView("scan"), []);
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

  const handleSaveSettings = useCallback(async (newSettings: AppSettings) => {
    await window.api.saveSettings(newSettings);
    setView("dashboard");
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
              onOpenAnalyzer={handleOpenAnalyzer}
              onOpenScan={handleOpenScan}
            />
          </motion.div>
        )}

        {view === "analyzer" && (
          <motion.div
            key="analyzer"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.2 }}
            className="app-view"
          >
            <TokenTreemap onBack={handleBackToDashboard} />
          </motion.div>
        )}

        {view === "scan" && (
          <motion.div
            key="scan"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.2 }}
            className="app-view"
          >
            <PromptScanView onBack={handleBackToDashboard} />
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
