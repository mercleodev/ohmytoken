import { useCallback, useEffect } from 'react';
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

  // Sync notification window visibility with card count (idempotent — safe to call repeatedly)
  useEffect(() => {
    const hasCards = notifications.length > 0;

    window.api.setMouseOnCard?.(false);
    window.api.setNotificationVisible?.(hasCards);

    return () => {
      // On unmount (or StrictMode cleanup), hide the window
      window.api.setNotificationVisible?.(false);
    };
  }, [notifications.length]);

  if (!enabled || notifications.length === 0) return null;

  return (
    <div className="notif-overlay">
      <AnimatePresence mode="sync">
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
