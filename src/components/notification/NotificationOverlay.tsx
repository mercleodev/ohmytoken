import { useCallback } from 'react';
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

  // Toggle click-through: when mouse is on a card, enable clicks
  const handleMouseEnter = useCallback(() => {
    if (window.api.setMouseOnCard) {
      window.api.setMouseOnCard(true);
    }
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (window.api.setMouseOnCard) {
      window.api.setMouseOnCard(false);
    }
  }, []);

  if (!enabled || notifications.length === 0) return null;

  return (
    <div className="notif-overlay">
      <AnimatePresence mode="popLayout">
        {notifications.map((notif) => (
          <div
            key={notif.id}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            <NotificationCard
              notification={notif}
              onDismiss={dismiss}
              onClick={handleClick}
            />
          </div>
        ))}
      </AnimatePresence>
    </div>
  );
};
