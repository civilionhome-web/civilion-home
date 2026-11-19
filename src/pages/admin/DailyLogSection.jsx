import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, must } from '../../lib/supabase';
import { uploadFile, removeFile } from '../../lib/files';
import { longDate } from '../../lib/format';
import { todayStr } from '../../lib/schedule';
import { Photo, VideoClip, Spinner, ErrorBox, Icon } from '../../components/ui';

const MAX_VIDEO_MB = 50;   // Supabase free plan upload limit per file
const isVideo = (f) => (f.type || '').startsWith('video/') || /\.(mp4|mov|m4v|webm|3gp)$/i.test(f.name || '');

export const WEATHER = ['Sunny', 'Cloudy', 'Light rain', 'Heavy rain'];
const EMPTY = { id: null, log_date: '', weather: 'Sunny', workers: '', work_done: '', materials: '', remarks: '' };

export default function DailyLogSection({ project, say }) {
  const [rows, setRows] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [f, setF] = useState(() => ({ ...EMPTY, log_date: todayStr() }));
  const [files, setFiles] = useState([]);
  const fileInput = useRef(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const reload = useCallback(async () => {
    const [l, p] = await Promise.all([
      supabase.from('site_logs').select('*').eq('project_id', project.id).order('log_date', { ascending: false }).order('created_at', { ascending: false }).limit(90),
      supabase.from('site_log_photos').select('*').eq('project_id', project.id).order('created_at').limit(1500),
    ]);
    if (l.error) setError(l.error);
    setRows(l.data || []); setPhotos(p.data || []);
  }, [project.id]);
  useEffect(() => { reload(); }, [reload]);

  async function act(fn) {
    setBusy(true); setError(null);
    try { await fn(); return true; } catch (e) { setError(e); return false; } finally { setBusy(false); setProgress(''); }
  }

  function checkFiles(list) {
    const big = [...list].filter((f) => isVideo(f) && f.size > MAX_VIDEO_MB * 1024 * 1024);
    if (big.length) throw new Error(`${big.map((f) => `${f.name} (${Math.round(f.size / 1048576)} MB)`).join(', ')}: videos must be under ${MAX_VIDEO_MB} MB. Record a shorter clip (about 30–40 seconds) or set the phone camera to 720p / 1080p.`);
  }

  async function addPhotos(logId, list) {
    checkFiles(list);
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      const video = isVideo(f);
      setProgress(`Uploading ${video ? `video (${Math.round(f.size / 1048576)} MB)` : 'photo'} ${i + 1} of ${list.length}…${video ? ' This can take a minute on mobile data.' : ''}`);
      const path = await uploadFile(project.id, 'daily-log', f);
      await must(supabase.from('site_log_photos').insert({ log_id: logId, project_id: project.id, path, kind: video ? 'video' : 'image' }));
    }
  }

  async function save(e) {
    e.preventDefault();
    const row = {
      project_id: project.id, log_date: f.log_date || todayStr(), weather: f.weather,
      workers: f.workers === '' ? null : Math.max(0, parseInt(f.workers, 10) || 0),
      work_done: f.work_done.trim(), materials: f.materials.trim(), remarks: f.remarks.trim(),
    };
    const editing = !!f.id;
    const ok = await act(async () => {
      checkFiles(files);
      const saved = editing
        ? await must(supabase.from('site_logs').update(row).eq('id', f.id).select().single())
        : await must(supabase.from('site_logs').insert(row).select().single());
      await addPhotos(saved.id, files);
    });
    if (ok) {
      say(editing ? 'Daily log updated' : 'Daily log saved');
      setF({ ...EMPTY, log_date: todayStr() }); setFiles([]);
      if (fileInput.current) fileInput.current.value = '';
      reload();
    }
  }

  async function morePhotos(log, list) {
    if (!list.length) return;
    if (await act(() => addPhotos(log.id, [...list]))) { say('Photos added'); reload(); }
  }

  async function removePhoto(p) {
    if (!window.confirm(p.kind === 'video' ? 'Delete this video?' : 'Delete this photo?')) return;
    if (await act(() => must(supabase.from('site_log_photos').delete().eq('id', p.id)))) { await removeFile(p.path); reload(); }
  }

  async function remove(log) {
    if (!window.confirm(`Delete the site log of ${longDate(log.log_date)} and its photos?`)) return;
    const ph = photos.filter((p) => p.log_id === log.id);
    if (await act(() => must(supabase.from('site_logs').delete().eq('id', log.id)))) {
      await Promise.all(ph.map((p) => removeFile(p.path)));
      reload();
    }
  }

  function edit(log) {
    setF({ ...EMPTY, ...log, workers: log.workers ?? '' });
    setFiles([]);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (!rows) return <Spinner />;
  return (
    <>
      <form className="card" onSubmit={save}>
        <div className="card-title">{f.id ? `Edit log of ${longDate(f.log_date)}` : 'Today’s site log'}</div>
        <div className="small muted">Clients see the daily log with photos on their home screen and under “Daily site log”.</div>
        <div className="form-grid">
          <label className="field"><span>Date</span><input className="input" type="date" required max={todayStr()} value={f.log_date} onChange={set('log_date')} /></label>
          <label className="field"><span>Weather</span>
            <select className="select" value={f.weather} onChange={set('weather')}>{WEATHER.map((w) => <option key={w}>{w}</option>)}</select>
          </label>
          <label className="field"><span>Workers on site</span><input className="input" type="number" min="0" inputMode="numeric" value={f.workers} onChange={set('workers')} placeholder="14" /></label>
        </div>
        <label className="field"><span>Work done today</span>
          <textarea className="textarea" required rows={3} value={f.work_done} onChange={set('work_done')}
            placeholder="First floor brickwork, east and north walls up to lintel level. Electrical conduits laid in kitchen." />
        </label>
        <div className="form-grid">
          <label className="field"><span>Materials received (optional)</span><input className="input" value={f.materials} onChange={set('materials')} placeholder="Cement 120 bags, M-sand 1 load" /></label>
          <label className="field"><span>Remarks / issues (optional)</span><input className="input" value={f.remarks} onChange={set('remarks')} placeholder="Power cut 2–4 pm" /></label>
        </div>
        <label className="field"><span>Photos and videos {f.id ? '(added to the ones already there)' : ''} — pick as many as you like. Photos are resized automatically; each video must be under {MAX_VIDEO_MB} MB (about 30–40 seconds).</span>
          <input ref={fileInput} type="file" accept="image/*,video/*" multiple onChange={(e) => setFiles([...e.target.files])} />
        </label>
        {files.length > 0 && (() => {
          const v = files.filter(isVideo).length, p = files.length - v;
          return <div className="small">{[p && `${p} photo${p > 1 ? 's' : ''}`, v && `${v} video${v > 1 ? 's' : ''}`].filter(Boolean).join(' and ')} selected</div>;
        })()}
        {progress && <div className="small">{progress}</div>}
        <ErrorBox error={error} />
        <div className="toolbar">
          <button className="btn" disabled={busy}>{busy ? 'Saving…' : f.id ? 'Save changes' : 'Save daily log'}</button>
          {f.id && <button type="button" className="btn ghost" onClick={() => { setF({ ...EMPTY, log_date: todayStr() }); setFiles([]); }}>Cancel</button>}
        </div>
      </form>

      {rows.length === 0 && <div className="card muted">No daily logs yet.</div>}
      {rows.map((log) => {
        const ph = photos.filter((p) => p.log_id === log.id);
        return (
          <div key={log.id} className="card">
            <div className="between" style={{ flexWrap: 'wrap', gap: 6 }}>
              <b>{longDate(log.log_date)}</b>
              <span className="small muted">{[log.weather, log.workers != null ? `${log.workers} workers` : '',
                ph.filter((x) => x.kind !== 'video').length ? `${ph.filter((x) => x.kind !== 'video').length} photo(s)` : '',
                ph.filter((x) => x.kind === 'video').length ? `${ph.filter((x) => x.kind === 'video').length} video(s)` : ''].filter(Boolean).join(' · ')}</span>
            </div>
            <div style={{ whiteSpace: 'pre-wrap', fontSize: 14 }}>{log.work_done}</div>
            {log.materials && <div className="small"><span className="muted">Materials:</span> {log.materials}</div>}
            {log.remarks && <div className="small"><span className="muted">Remarks:</span> {log.remarks}</div>}
            {ph.length > 0 && (
              <div className="thumbs">
                {ph.map((p) => (
                  <span key={p.id} style={{ position: 'relative', display: 'inline-block' }}>
                    {p.kind === 'video'
                      ? <span style={{ position: 'relative', display: 'block', width: 132 }}><VideoClip path={p.path} small /><span className="video-badge">▶ Video</span></span>
                      : <Photo path={p.path} alt="" />}
                    <button type="button" className="thumb-x" aria-label={p.kind === 'video' ? 'Delete video' : 'Delete photo'} onClick={() => removePhoto(p)}>×</button>
                  </span>
                ))}
              </div>
            )}
            <div className="toolbar">
              <label className="btn ghost small" style={{ cursor: 'pointer' }}>
                Add photos / videos<input type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { morePhotos(log, e.target.files); e.target.value = ''; }} />
              </label>
              <button className="btn ghost small" onClick={() => edit(log)}>Edit</button>
              <button className="btn danger small" disabled={busy} onClick={() => remove(log)} aria-label="Delete log"><Icon name="trash" size={16} /></button>
            </div>
          </div>
        );
      })}
    </>
  );
}
