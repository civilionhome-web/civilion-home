import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useProject } from './ClientLayout';
import { shortDate } from '../../lib/format';
import { DOC_CATEGORIES, formatSize, fileKind, openDocument } from '../../lib/documents';
import { Icon, Spinner, ErrorBox } from '../../components/ui';

export default function Documents() {
  const { project } = useProject();
  const [docs, setDocs] = useState(null);
  const [filter, setFilter] = useState('All');
  const [error, setError] = useState(null);

  useEffect(() => {
    supabase.from('documents').select('*').eq('project_id', project.id).order('created_at', { ascending: false })
      .then(({ data, error: e }) => { if (e) setError(e); setDocs(data || []); });
  }, [project.id]);

  async function open(d, download) {
    setError(null);
    try { await openDocument(d.path, d.file_name, download); } catch (e) { setError(e); }
  }

  if (!docs) return <Spinner />;
  const used = DOC_CATEGORIES.filter((c) => docs.some((d) => d.category === c));
  const shown = filter === 'All' ? docs : docs.filter((d) => d.category === filter);
  const groups = (filter === 'All' ? used : [filter]).map((c) => [c, shown.filter((d) => d.category === c)]).filter(([, l]) => l.length);

  return (
    <div className="screen">
      <div className="page-head">
        <h1>Documents</h1>
        <div className="sub">Agreement, drawings, permits and other papers for your home</div>
      </div>
      <div className="content">
        {used.length > 1 && (
          <div className="chips-row" style={{ padding: 0 }} role="tablist" aria-label="Document type">
            {['All', ...used].map((c) => (
              <button key={c} role="tab" aria-selected={filter === c} className="chip"
                style={filter === c ? { background: 'var(--maroon)', color: '#fff', borderColor: 'var(--maroon)' } : undefined}
                onClick={() => setFilter(c)}>{c}</button>
            ))}
          </div>
        )}
        <ErrorBox error={error} />
        {docs.length === 0 && (
          <div className="card empty">Your project documents will appear here once your project manager uploads them.</div>
        )}
        {groups.map(([cat, list]) => (
          <div key={cat} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="section-label">{cat}</div>
            <div className="card flush">
              {list.map((d) => (
                <div key={d.id} className="list-row">
                  <span className="doc-badge" aria-hidden="true">{fileKind(d.file_name, d.mime)}</span>
                  <button className="doc-open" onClick={() => open(d, false)}>
                    <span style={{ fontWeight: 600, fontSize: 14.5 }}>{d.title}</span>
                    <span className="small muted">{[shortDate(d.created_at), formatSize(d.size_bytes)].filter(Boolean).join(' · ')}</span>
                  </button>
                  <button className="icon-btn" aria-label={`Download ${d.title}`} onClick={() => open(d, true)}>
                    <Icon name="download" size={20} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
