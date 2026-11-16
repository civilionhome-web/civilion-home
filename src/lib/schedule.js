// Time schedule + hindrance calculations. Dates are 'YYYY-MM-DD' strings.

const DAY = 86400000;
const toUtc = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const fromUtc = (t) => new Date(t).toISOString().slice(0, 10);

export const todayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

export const CAUSES = {
  client: 'Client',
  weather: 'Weather / natural',
  authority: 'Govt. / authority',
  contractor: 'Contractor',
  other: 'Other',
};

export function addDays(dateStr, n) {
  if (!dateStr) return null;
  return fromUtc(toUtc(dateStr) + n * DAY);
}

// Days between two dates, counting both ends (1 Nov – 3 Nov = 3 days)
export function daysInclusive(from, to) {
  if (!from || !to) return 0;
  return Math.max(0, Math.round((toUtc(to) - toUtc(from)) / DAY) + 1);
}

// Days of one hindrance; an open one counts up to today
export function hindranceDays(h, today = todayStr()) {
  const end = h.to_date || (today >= h.from_date ? today : h.from_date);
  return daysInclusive(h.from_date, end);
}

// Total days lost to client hindrances. Overlapping entries are counted once.
export function clientDelayDays(list, today = todayStr()) {
  const ranges = list
    .filter((h) => h.caused_by === 'client' && h.from_date)
    .map((h) => [toUtc(h.from_date), toUtc(h.to_date || (today >= h.from_date ? today : h.from_date))])
    .sort((a, b) => a[0] - b[0]);
  let total = 0, cur = null;
  for (const [s, e] of ranges) {
    if (!cur || s > cur[1] + DAY) { if (cur) total += (cur[1] - cur[0]) / DAY + 1; cur = [s, e]; }
    else cur[1] = Math.max(cur[1], e);
  }
  if (cur) total += (cur[1] - cur[0]) / DAY + 1;
  return Math.round(total);
}

// Everything the screens need about the project's timeline
export function scheduleSummary(project, hindrances = [], today = todayStr()) {
  const start = project.start_date || null;
  const agreed = project.completion_date || null;
  const duration = start && agreed ? daysInclusive(start, agreed) : null;
  const clientDays = clientDelayDays(hindrances, today);
  const otherDays = hindrances.filter((h) => h.caused_by !== 'client').reduce((s, h) => s + hindranceDays(h, today), 0);
  const revised = agreed ? addDays(agreed, clientDays) : null;
  const elapsed = start && today >= start ? daysInclusive(start, today) : 0;
  // Days the contractor has actually used = elapsed minus client hindrance days
  const pastClient = hindrances
    .filter((h) => h.from_date <= today)
    .map((h) => ({ ...h, to_date: !h.to_date || h.to_date > today ? today : h.to_date }));
  const used = Math.max(0, elapsed - clientDelayDays(pastClient, today));
  const left = revised ? daysInclusive(today, revised) - 1 : null;
  return { start, agreed, duration, clientDays, otherDays, revised, elapsed, used, left, open: hindrances.some((h) => !h.to_date) };
}
