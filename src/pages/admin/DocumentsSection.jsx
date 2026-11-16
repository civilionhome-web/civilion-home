import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, must } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { removeFile } from '../../lib/files';
import { longDate } from '../../lib/format';
import { DOC_CATEGORIES, formatSize, fileKind, uploadDocument, openDocument } from '../../lib/documents';
import { Spinner, ErrorBox, Icon } from '../../components/ui';

const MAX_MB = 45; // Supabase free plan allows 50 MB per file

// "Final_Floor-Plan_v3.pdf" → "Final Floor Plan v3"
const titleFromName = (n) => n.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() || n;

export default function DocumentsSection({ project, say }) {
  const { user } = useAuth();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [files, setFiles] = useState([]); // [{ file, title, category }]
  const [category, setCategory] = useState(DOC_CATEGORIES[0]);
  const input = useRef(null);

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.from('documents').select('*').eq('project_id', project.id).order('created_at', { ascending: false });
    if (e) setError(e);
    setRows(data || []);
  }, [project.id]);
  useEffect(() => { load(); }, [load]);

  function pick(e) {
    const list = [...(e.target.files || [])];
    const tooBig = list.filter((f) => f.size > MAX_MB * 1024 * 1024);
    setError(tooBig.length ? new Error(`Too large (over ${MAX_MB} MB): ${tooBig.map((f) => f.name).join(', ')}. Please compress or split the file.`) : null);
    setFiles(list.filter((f) => f.size <= MAX_MB * 1024 * 1024).map((f) => ({ file: f, title: titleFromName(f.name), category })));
  }

  async function upload(e) {
    e.preventDefault();
    if (!files.length) return;
    setBusy(true); setError(null);
    let done = 0;
    try {
      for (const f of files) {
        setProgress(`Uploading ${done + 1} of ${files.length}: ${f.file.name}…`);
        const path = await uploadDocument(project.id, f.file);
        try {
          await must(supabase.from('documents').insert({
            project_id: project.id, title: f.title.trim() || f.file.name, category: f.category,
            path, file_name: f.file.name, size_bytes: f.file.size, mime: f.file.type || '', uploaded_by: user.id,
          }));
        } catch (err) { await removeFile(path); throw err; }
        done++;
      }
      say(done === 1 ? 'Document uploaded' : `${done} documents uploaded`);
      setFiles([]);
      if (input.current) input.current.value = '';
    } catch (err) { setError(err); }
    setProgress(''); setBusy(false); load();
  }

  async function update(d, patch) {
    setError(null);
    const { error: e } = await supabase.from('documents').update(patch).eq('id', d.id);
    if (e) setError(e); else load();
  }

  async function remove(d) {
    if (!window.confirm(`Delete "${d.title}"? The client will no longer see it.`)) return;
    setError(null);
    const { error: e } = await supabase.from('documents').delete().eq('id', d.id);
    if (e) { setError(e); return; }
    await removeFile(d.path);
    say('Document deleted');
    load();
  }

  async function open(d) {
    try { await openDocument(d.path, d.file_name); } catch (e) { setError(e); }
  }

  if (!rows) return <Spinner />;
  const setOne = (i, k, v) => setFiles(files.map((f, j) => (j === i ? { ...f, [k]: v } : f)));

  return (
    <>
      <form className="card" onSubmit={upload}>
        <div className="card-title">Upload documents</div>
        <div className="small muted">PDF, drawings, Word, Excel or photos, up to {MAX_MB} MB each. The client sees them in the Documents tab of their app.</div>
        <div className="form-grid">
          <label className="field"><span>Type</span>
            <select className="select" value={category} onChange={(e) => { setCategory(e.target.value); setFiles(files.map((f) => ({ ...f, category: e.target.value }))); }}>
              {DOC_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label className="field"><span>Files (you can pick several)</span>
            <input ref={input} type="file" multiple onChange={pick}
              accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.dwg,.dxf,.jpg,.jpeg,.png,.webp,.heic,.txt,.csv,.zip,application/pdf,image/*" />
          </label>
        </div>
        {files.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>File</th><th>Name shown to client</th><th>Type</th></tr></thead>
              <tbody>
                {files.map((f, i) => (
                  <tr key={f.file.name + i}>
                    <td className="small">{f.file.name}<div className="muted">{formatSize(f.file.size)}</div></td>
                    <td><input className="input" style={{ height: 38, fontSize: 14, minWidth: 200 }} aria-label="Document name" value={f.title} onChange={(e) => setOne(i, 'title', e.target.value)} /></td>
                    <td>
                      <select className="select" style={{ height: 38, fontSize: 14, minWidth: 160 }} aria-label="Document type" value={f.category} onChange={(e) => setOne(i, 'category', e.target.value)}>
                        {DOC_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {progress && <div className="small">{progress}</div>}
        <ErrorBox error={error} />
        <div><button className="btn" disabled={busy || !files.length}>{busy ? 'Uploading…' : files.length > 1 ? `Upload ${files.length} documents` : 'Upload'}</button></div>
      </form>

      <div className="table-wrap">
        <table className="table">
          <thead><tr><th /><th>Name shown to client</th><th>Type</th><th>Added</th><th /></tr></thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id}>
                <td><span className="doc-badge">{fileKind(d.file_name, d.mime)}</span></td>
                <td>
                  <input className="input" style={{ height: 38, fontSize: 14, minWidth: 200 }} defaultValue={d.title} aria-label="Document name"
                    onBlur={(e) => e.target.value.trim() && e.target.value !== d.title && update(d, { title: e.target.value.trim() })} />
                  <div className="small muted" style={{ marginTop: 4 }}>{d.file_name} · {formatSize(d.size_bytes)}</div>
                </td>
                <td>
                  <select className="select" style={{ height: 38, fontSize: 14, minWidth: 160 }} value={d.category} aria-label="Document type" onChange={(e) => update(d, { category: e.target.value })}>
                    {DOC_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </td>
                <td className="small" style={{ whiteSpace: 'nowrap' }}>{longDate(d.created_at)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn ghost small" onClick={() => open(d)}>Open</button>{' '}
                  <button className="btn danger small" onClick={() => remove(d)} aria-label={`Delete ${d.title}`}><Icon name="trash" size={16} /></button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="muted">No documents yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
