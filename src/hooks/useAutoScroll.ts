import { type RefObject } from 'react';

/**
 * Scrolls the given container ref to the bottom.
 * Call this after adding new items to a list.
 */
export const scrollToBottom = (ref: RefObject<HTMLDivElement | null>) => {
  requestAnimationFrame(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' });
  });
};
