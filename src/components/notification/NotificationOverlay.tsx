import { AnimatePresence } from 'framer-motion';
import { NotificationCard } from './NotificationCard';
import { useNotificationManager } from './useNotificationManager';
import type { PromptScan, UsageLogEntry } from '../../types/electron';
import './notification.css';

type Props = {
  enabled: boolean;
  onNavigateToPrompt: (scan: PromptScan, usage: UsageLogEntry | null) => void;
};

export const NotificationOverlay = ({ enabled, onNavigateToPrompt }: Props) => {
  const { notifications, dismiss, handleClick } = useNotificationManager(
    enabled,
    onNavigateToPrompt,
  );

  if (!enabled || notifications.length === 0) return null;

  return (
    <div className="notif-overlay">
      <AnimatePresence mode="popLayout">
        {notifications.map((notif) => (
          <NotificationCard
            key={notif.id}
            notification={notif}
            onDismiss={dismiss}
            onClick={handleClick}
          />
        ))}
      </AnimatePresence>
    </div>
  );
};
