// Day planner helpers. Dates are 'YYYY-MM-DD' strings (India time).
import { addDays, todayStr } from './schedule';

export const tomorrowStr = () => addDays(todayStr(), 1);

export const TEAM_HINTS = ['Masons', 'Helpers', 'Carpenters (shuttering)', 'Bar benders', 'Electricians', 'Plumbers', 'Painters', 'Tile layers', 'Welders'];

const norm = (s) => (s || '').trim().replace(/\s+/g, ' ').toLowerCase();
export const splitItems = (text) => (text || '').split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
export const planWorkers = (p) => (p.tasks || []).reduce((s, t) => s + (Number(t.workers) || 0), 0);

export function dayName(dateStr) {
  const today = todayStr();
  if (dateStr === today) return 'Today';
  if (dateStr === addDays(today, 1)) return 'Tomorrow';
  if (dateStr === addDays(today, -1)) return 'Yesterday';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long' });
}

// Totals for one day across all sites, and teams / machinery planned at more than one site.
export function boardSummary(plans, siteName) {
  const teams = new Map();
  const equip = new Map();
  for (const p of plans) {
    const site = siteName(p.project_id);
    for (const t of p.tasks || []) {
      const k = norm(t.team);
      if (!k) continue;
      const e = teams.get(k) || { name: t.team.trim(), sites: new Map(), workers: 0 };
      e.sites.set(p.project_id, site);
      e.workers += Number(t.workers) || 0;
      teams.set(k, e);
    }
    for (const item of splitItems(p.equipment)) {
      const k = norm(item);
      const e = equip.get(k) || { name: item, sites: new Map() };
      e.sites.set(p.project_id, site);
      equip.set(k, e);
    }
  }
  const list = (m) => [...m.values()].map((e) => ({ ...e, sites: [...e.sites.values()] })).sort((a, b) => a.name.localeCompare(b.name));
  const teamList = list(teams);
  const equipList = list(equip);
  return {
    workers: plans.reduce((s, p) => s + planWorkers(p), 0),
    teams: teamList,
    equipment: equipList,
    clashes: [
      ...teamList.filter((t) => t.sites.length > 1).map((t) => ({ kind: 'Team', ...t })),
      ...equipList.filter((e) => e.sites.length > 1).map((e) => ({ kind: 'Machinery', ...e })),
    ],
  };
}
