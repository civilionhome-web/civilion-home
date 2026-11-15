const inrFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

// ₹10,33,680
export function inr(n) {
  const v = Number(n || 0);
  const sign = v < 0 ? '−' : '';
  return `${sign}₹${inrFmt.format(Math.abs(v))}`;
}

// +₹38,400 / −₹9,350 / No extra cost
export function delta(n) {
  const v = Number(n || 0);
  if (v === 0) return 'No extra cost';
  return v > 0 ? `+${inr(v)}` : inr(v);
}

// ₹27.56 L  /  ₹1.25 Cr  /  ₹45,000
export function lakhs(n) {
  const v = Number(n || 0);
  if (Math.abs(v) >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (Math.abs(v) >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
  return inr(v);
}

export function money(n, currency) {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${currency} ${Math.round(n).toLocaleString('en')}`;
  }
}

// "16 Nov" or "16 Nov 2027" when not this year
export function shortDate(d) {
  if (!d) return '';
  const dt = typeof d === 'string' && d.length === 10 ? new Date(d + 'T00:00:00') : new Date(d);
  const opts = { day: 'numeric', month: 'short' };
  if (dt.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return dt.toLocaleDateString('en-GB', opts);
}

export function longDate(d) {
  if (!d) return '';
  const dt = typeof d === 'string' && d.length === 10 ? new Date(d + 'T00:00:00') : new Date(d);
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function timeIn(d, tz) {
  return new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz });
}

export const IST = 'Asia/Kolkata';
export const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

// Short city name for the viewer's timezone, e.g. "Dubai"
export function tzCity(tz = localTz) {
  const part = (tz || '').split('/').pop() || '';
  return part.replace(/_/g, ' ');
}

// "10:42 IST · 9:12 Dubai" — the second part only if viewer is outside India
export function dualTime(d) {
  const ist = `${timeIn(d, IST)} IST`;
  if (localTz === IST || localTz === 'Asia/Calcutta') return ist;
  return `${ist} · ${timeIn(d, localTz)} ${tzCity()}`;
}

export function initials(name) {
  return (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
}

export function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export function digitsOnly(s) {
  return String(s || '').replace(/\D/g, '');
}
