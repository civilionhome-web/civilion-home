import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useProject } from './ClientLayout';
import { inr, lakhs, money, shortDate, longDate } from '../../lib/format';
import { openFile } from '../../lib/files';
import { useInrRate } from '../../lib/fx';
import { Spinner, Sheet } from '../../components/ui';

const pad = (n) => String(n).padStart(2, '0');

export default function Payments() {
  const { project } = useProject();
  const [bills, setBills] = useState(null);
  const [howTo, setHowTo] = useState(false);
  const rate = useInrRate(project.client_currency);

  useEffect(() => {
    supabase.from('bills').select('*').eq('project_id', project.id).order('number', { ascending: false })
      .then(({ data }) => setBills(data || []));
  }, [project.id]);

  if (!bills) return <Spinner />;
  const sum = (st) => bills.filter((b) => b.status === st).reduce((s, b) => s + Number(b.amount), 0);
  const paid = sum('paid');
  const due = sum('due');
  const contract = Number(project.contract_amount) || 0;
  const remaining = Math.max(0, contract - paid - due);
  const pct = (v) => (contract > 0 ? Math.min(100, (v / contract) * 100) : 0);
  const dueBills = bills.filter((b) => b.status === 'due');
  const paidBills = bills.filter((b) => b.status === 'paid');
  const upcoming = bills.filter((b) => b.status === 'upcoming');

  return (
    <div className="screen">
      <div className="page-head">
        <h1>Bills &amp; payments</h1>
        {contract > 0 && (
          <div className="sub" style={{ fontSize: 13.5 }}>
            Contract {inr(contract)} incl. GST{Number(project.boq_amount) > 0 ? ` · BOQ ${inr(project.boq_amount)}` : ''}
          </div>
        )}
      </div>
      <div className="content">
        {contract > 0 && (
          <div className="card">
            <div className="stack-bar" aria-hidden="true"><div className="paid" style={{ width: `${pct(paid)}%` }} /><div className="due" style={{ width: `${pct(due)}%` }} /></div>
            <div className="grid3" style={{ fontSize: 12 }}>
              <div><div className="green" style={{ fontWeight: 600 }}>Paid</div><div className="big" style={{ fontSize: 15 }}>{lakhs(paid)}</div></div>
              <div><div className="amber" style={{ fontWeight: 600 }}>Due now</div><div className="big" style={{ fontSize: 15 }}>{lakhs(due)}</div></div>
              <div><div className="muted" style={{ fontWeight: 600 }}>Remaining</div><div className="big" style={{ fontSize: 15 }}>{lakhs(remaining)}</div></div>
            </div>
          </div>
        )}

        {dueBills.map((b) => (
          <div key={b.id} className="card warn">
            <div className="between"><span style={{ fontWeight: 600 }}>Bill {pad(b.number)} · {b.title}</span>{b.due_date && <span className="small amber" style={{ fontWeight: 600 }}>Due {shortDate(b.due_date)}</span>}</div>
            <div className="row" style={{ alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'var(--display)', fontSize: 26, fontWeight: 800 }}>{inr(b.amount)}</span>
              {rate && <span style={{ fontSize: 13, color: 'var(--amber-ink)' }}>≈ {money(Number(b.amount) * rate, project.client_currency)}</span>}
            </div>
            {(b.percent_of_contract || b.details) && (
              <div style={{ fontSize: 12.5, color: 'var(--amber-ink)' }}>
                {[b.percent_of_contract ? `${Number(b.percent_of_contract)}% of contract` : '', b.details].filter(Boolean).join(' · ')}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn outline" style={{ flex: 1, height: 46 }} disabled={!b.bill_path} onClick={() => openFile(b.bill_path)}>
                {b.bill_path ? 'View BOQ bill' : 'Bill PDF coming'}
              </button>
              <button className="btn" style={{ flex: 1, height: 46 }} onClick={() => setHowTo(true)}>How to pay</button>
            </div>
          </div>
        ))}

        {upcoming.length > 0 && (
          <>
            <div className="section-label">Upcoming</div>
            <div className="card flush">
              {upcoming.slice().reverse().map((b) => (
                <div key={b.id} className="list-row">
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 600, fontSize: 14 }}>Bill {pad(b.number)} · {b.title}</div>{b.due_date && <div className="small muted">Expected {shortDate(b.due_date)}</div>}</div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{inr(b.amount)}</div>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="section-label">Paid bills</div>
        <div className="card flush">
          {paidBills.length === 0 && <div className="empty" style={{ padding: 16 }}>No paid bills yet.</div>}
          {paidBills.map((b) => (
            <div key={b.id} className="list-row">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>Bill {pad(b.number)} · {b.title}</div>
                <div className="small muted">{b.paid_on ? `Paid ${longDate(b.paid_on)}` : 'Paid'}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{inr(b.amount)}</div>
                {b.receipt_path
                  ? <button className="linkish green" style={{ padding: '6px 0', fontSize: 12 }} onClick={() => openFile(b.receipt_path)}>Receipt ↓</button>
                  : b.bill_path ? <button className="linkish" style={{ padding: '6px 0', fontSize: 12 }} onClick={() => openFile(b.bill_path)}>Bill ↓</button> : null}
              </div>
            </div>
          ))}
        </div>
        <div className="small muted">Bills are in INR. Pay by bank transfer, exchange house or NRE account. Never cash.</div>
      </div>

      {howTo && (
        <Sheet title="How to pay" onClose={() => setHowTo(false)}>
          <div className="pre">{project.payment_instructions || 'Your project manager will share Civilion\'s bank details with you. Please always confirm account details on a call before your first transfer.'}</div>
          <div className="small muted">After paying, send the transfer receipt in Chat so we can issue your receipt.</div>
          <button className="btn" onClick={() => setHowTo(false)}>Done</button>
        </Sheet>
      )}
    </div>
  );
}
