'use client';

import { useEffect, useState } from 'react';

/**
 * A minute-aligned clock for deadline-driven UI. It also refreshes immediately
 * when the tab regains focus so sleeping/background tabs never show stale state.
 */
export function useCurrentTime(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const update = () => setNow(new Date());
    const delayToNextMinute = 60_000 - (Date.now() % 60_000) + 25;
    const timeoutId = setTimeout(() => {
      update();
      intervalId = setInterval(update, 60_000);
    }, delayToNextMinute);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') update();
    };
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  return now;
}
