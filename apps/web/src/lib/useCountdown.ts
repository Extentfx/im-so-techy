import { useCallback, useEffect, useRef, useState } from 'react';

/** Rest timer: counts down in whole seconds, buzzes when done if the device supports it. */
export function useCountdown() {
  const [left, setLeft] = useState(0);
  const end = useRef(0);

  useEffect(() => {
    if (left <= 0) return;
    const t = setInterval(() => {
      const s = Math.max(0, Math.ceil((end.current - Date.now()) / 1000));
      setLeft(s);
      if (s === 0) navigator.vibrate?.(200);
    }, 250);
    return () => clearInterval(t);
  }, [left > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = useCallback((seconds: number) => {
    end.current = Date.now() + seconds * 1000;
    setLeft(seconds);
  }, []);
  const add = useCallback((seconds: number) => {
    end.current += seconds * 1000;
    setLeft((l) => l + seconds);
  }, []);
  const stop = useCallback(() => setLeft(0), []);
  return { left, start, add, stop };
}
