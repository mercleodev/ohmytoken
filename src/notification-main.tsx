import React from 'react';
import ReactDOM from 'react-dom/client';
import { NotificationOverlay } from './components/notification/NotificationOverlay';
import './components/notification/notification.css';

/**
 * Standalone entry point for the notification overlay window.
 * This runs in a separate frameless, transparent BrowserWindow
 * positioned at the top-right of the screen.
 */

// Navigation handler: send IPC to main process → main window
const handleNavigateToPrompt = (scan: import('./types/electron').PromptScan, usage: import('./types/electron').UsageLogEntry | null) => {
  window.api.navigateToPromptFromNotification(scan, usage);
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <NotificationOverlay
      enabled={true}
      onNavigateToPrompt={handleNavigateToPrompt}
    />
  </React.StrictMode>,
);
