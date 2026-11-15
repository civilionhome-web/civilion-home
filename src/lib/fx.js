import { useEffect, useState } from 'react';

// Approximate INR → client currency rate, fetched once a day and cached.
// Uses the free open.er-api.com feed; if it fails, the "≈" line simply hides.
export function useInrRate(currency) {
  const [rate, setRate] = useState(null);
  useEffect(() => {
    if (!currency || currency === 'INR') return;
    const key = `fx_INR_${currency}`;
    try {
      const saved = JSON.parse(localStorage.getItem(key) || 'null');
      if (saved && Date.now() - saved.at < 24 * 3600 * 1000) { setRate(saved.rate); return; }
    } catch { /* ignore */ }
    fetch('https://open.er-api.com/v6/latest/INR')
      .then((r) => r.json())
      .then((j) => {
        const r = j?.rates?.[currency];
        if (r) {
          setRate(r);
          try { localStorage.setItem(key, JSON.stringify({ rate: r, at: Date.now() })); } catch { /* ignore */ }
        }
      })
      .catch(() => {});
  }, [currency]);
  return rate;
}
