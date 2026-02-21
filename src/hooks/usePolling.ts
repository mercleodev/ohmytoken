import { useEffect } from 'react';

/**
 * Calls the given callback immediately and then every `intervalMs` milliseconds.
 */
export const usePolling = (callback: () => void, intervalMs: number) => {
  useEffect(() => {
    callback();
    const id = setInterval(callback, intervalMs);
    return () => clearInterval(id);
  }, [callback, intervalMs]);
};
