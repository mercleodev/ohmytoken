import { useEffect } from 'react';

/**
 * Calls the given callback on mount and whenever the window regains focus.
 */
export const useWindowFocusRefresh = (callback: () => void) => {
  useEffect(() => {
    callback();
    const handleFocus = () => callback();
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [callback]);
};
