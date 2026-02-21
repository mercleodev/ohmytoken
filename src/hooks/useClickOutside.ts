import { useEffect, type RefObject } from 'react';

/**
 * Fires the callback when clicking outside the ref element or pressing Escape.
 */
export const useClickOutside = (
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
) => {
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [ref, onClose]);
};
