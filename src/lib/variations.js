import { supabase } from './supabase';

// Approved variations of a project: decided decisions whose chosen option has a cost.
// Returns { total, extra, saving, items: [{ id, title, reference, name, amount, decided_at }] }
export async function loadVariations(projectId) {
  const [a, o] = await Promise.all([
    supabase.from('approvals').select('id,title,reference,status,chosen_option_id,decided_at').eq('project_id', projectId).eq('status', 'decided'),
    supabase.from('approval_options').select('id,name,cost_delta').eq('project_id', projectId),
  ]);
  const opts = new Map((o.data || []).map((x) => [x.id, x]));
  const items = (a.data || [])
    .map((d) => { const c = opts.get(d.chosen_option_id); return c ? { ...d, name: c.name, amount: Number(c.cost_delta) || 0 } : null; })
    .filter((x) => x && x.amount !== 0)
    .sort((x, y) => (x.decided_at || '') < (y.decided_at || '') ? -1 : 1);
  const extra = items.filter((x) => x.amount > 0).reduce((s, x) => s + x.amount, 0);
  const saving = items.filter((x) => x.amount < 0).reduce((s, x) => s + x.amount, 0);
  return { total: extra + saving, extra, saving, items };
}

// Variation totals for every project the user can see: { [project_id]: { total, count } }
export async function loadAllVariations() {
  const [a, o] = await Promise.all([
    supabase.from('approvals').select('project_id,chosen_option_id').eq('status', 'decided'),
    supabase.from('approval_options').select('id,cost_delta'),
  ]);
  const cost = new Map((o.data || []).map((x) => [x.id, Number(x.cost_delta) || 0]));
  const out = {};
  for (const d of a.data || []) {
    const v = cost.get(d.chosen_option_id) || 0;
    if (!v) continue;
    const r = (out[d.project_id] ||= { total: 0, count: 0 });
    r.total += v; r.count += 1;
  }
  return out;
}
