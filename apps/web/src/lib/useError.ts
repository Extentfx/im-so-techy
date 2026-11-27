import { useEffect, useState } from 'react';

/** An error message that clears itself after a few seconds, so a reload never hides it instantly and it never lingers. */
export function useError(ms = 9000) {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), ms);
    return () => clearTimeout(t);
  }, [error, ms]);
  return [error, setError] as const;
}
