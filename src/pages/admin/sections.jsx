import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, must, CLIENT_LOGIN } from '../../lib/supabase';
import { uploadFile, removeFile, openFile } from '../../lib/files';
import { inr, delta, shortDate, longDate, digitsOnly, timeIn, IST } from '../../lib/format';
import { Photo, Spinner, ErrorBox, Icon } from '../../components/ui';

// Loads rows of one table for the project
function useRows(table, projectId, order = 'created_at', ascending = false) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const reload = useCallback(async () => {
    const { data, error: e } = await supabase.from(table).select('*').eq('project_id', projectId).order(order, { ascending });
    if (e) setError(e);
    setRows(data || []);
  }, [table, projectId, order, ascending]);
  useEffect(() => { reload(); }, [reload]);
  return [rows, reload, error, setError];
}

function useAction(setError) {
  const [busy, setBusy] = useState(false);
  const run = async (fn) => {
    setBusy(true); setError(null);
    try { await fn(); return true; } catch (e) { setError(e); return false; } finally { setBusy(false); }
  };
  return [busy, run];
}

const today = () => new Date().toISOString().slice(0, 10);
const MISSING = { background: '#fff6e5', borderColor: '#f0d49a' };

// ---------------------------------------------------------------- Clients
function clientInvite(r, appUrl) {
  const first = r.display_name ? ' ' + r.display_name.split(' ')[0] : '';
  const how = (CLIENT_LOGIN === 'email' || !r.phone_digits) && r.email
    ? `Sign in with your email (${r.email}): tap "Email me a code" and type the 6-digit code we send you.`
    : 'Sign in with this mobile number and the code we send you.';
  return `Hello${first}, you can now follow your home's construction on Civilion Home.\n\n${appUrl}\n\n${how}\n\nTip: use "Add to Home screen" to keep it like an app.`;
}

export function ClientsSection({ project, say }) {
  const [rows, reload, error, setError] = useRows('project_clients', project.id);
  const [people, setPeople] = useState([]);
  const [busy, run] = useAction(setError);
  const [f, setF] = useState({ display_name: '', cc: '971', phone: '', email: '' });
  const emailOnly = CLIENT_LOGIN === 'email';

  // Who has already signed in (to show "Signed in" / "Not yet")
  useEffect(() => {
    supabase.from('profiles').select('email, phone, created_at').then(({ data }) => setPeople(data || []));
  }, [rows]);
  const signedIn = (r) => people.some((p) =>
    (r.email && (p.email || '').toLowerCase() === r.email.toLowerCase()) ||
    (r.phone_digits && digitsOnly(p.phone) === r.phone_digits));

  async function add(e) {
    e.preventDefault();
    const phone = digitsOnly(f.phone).replace(/^0+/, '');
    const ok = await run(async () => {
      if (emailOnly && !f.email.trim()) throw new Error('Please add an email. Clients sign in with an email code for now (mobile sign-in is not switched on yet).');
      if (!phone && !f.email.trim()) throw new Error('Enter a mobile number or an email.');
      await must(supabase.from('project_clients').insert({
        project_id: project.id, display_name: f.display_name.trim(),
        phone_digits: phone ? digitsOnly(f.cc) + phone : '', email: f.email.trim().toLowerCase(),
      }));
    });
    if (ok) { setF({ ...f, display_name: '', phone: '', email: '' }); reload(); say('Client added. Send them the invite.'); }
  }

  async function save(r, patch) {
    const next = { ...r, ...patch };
    if (!next.email && !next.phone_digits) { setError(new Error('Keep at least an email or a mobile number.')); reload(); return; }
    if (await run(() => must(supabase.from('project_clients').update(patch).eq('id', r.id)))) { say('Saved'); reload(); }
  }

  async function remove(r) {
    if (!window.confirm(`Remove access for ${r.display_name || r.email || r.phone_digits}? They will no longer see this project.`)) return;
    if (await run(() => must(supabase.from('project_clients').delete().eq('id', r.id)))) reload();
  }

  async function copy(r, appUrl) {
    const t = clientInvite(r, appUrl);
    try { await navigator.clipboard.writeText(t); say('Invite message copied'); } catch { window.prompt('Copy this message:', t); }
  }

  if (!rows) return <Spinner />;
  const appUrl = window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, '');
  const cell = { height: 38, fontSize: 14 };
  return (
    <>
      <div className="card small" style={{ lineHeight: 1.55 }}>
        <div>
          Add each person who should see this project (husband, wife, parents in Kerala…). They open <b>{appUrl}</b>, sign in with the
          same {emailOnly ? 'email' : 'email or mobile number'}, and see this project straight away. You can correct a name, email or mobile in the list.
        </div>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Name</th><th>Email</th><th>Mobile (digits with country code)</th><th>Status</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><input className="input" style={{ ...cell, minWidth: 130 }} defaultValue={r.display_name} aria-label="Name"
                  onBlur={(e) => e.target.value.trim() !== r.display_name && save(r, { display_name: e.target.value.trim() })} /></td>
                <td><input className="input" type="email" style={{ ...cell, minWidth: 200 }} defaultValue={r.email} aria-label="Email"
                  onBlur={(e) => e.target.value.trim().toLowerCase() !== r.email && save(r, { email: e.target.value.trim().toLowerCase() })} /></td>
                <td><input className="input" type="tel" style={{ ...cell, minWidth: 140 }} defaultValue={r.phone_digits} aria-label="Mobile" placeholder="971501234567"
                  onBlur={(e) => digitsOnly(e.target.value) !== r.phone_digits && save(r, { phone_digits: digitsOnly(e.target.value) })} /></td>
                <td>{signedIn(r) ? <span className="pill done">Signed in</span> : <span className="pill upcoming">Not yet</span>}</td>
                <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                  {r.phone_digits && <><a className="btn ghost small" target="_blank" rel="noreferrer"
                    href={`https://wa.me/${r.phone_digits}?text=${encodeURIComponent(clientInvite(r, appUrl))}`}>WhatsApp invite</a>{' '}</>}
                  {r.email && <><a className="btn ghost small"
                    href={`mailto:${r.email}?subject=${encodeURIComponent('Follow your home on Civilion Home')}&body=${encodeURIComponent(clientInvite(r, appUrl))}`}>Email invite</a>{' '}</>}
                  <button className="btn ghost small" onClick={() => copy(r, appUrl)}>Copy</button>{' '}
                  <button className="btn danger small" disabled={busy} onClick={() => remove(r)}>Remove</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="muted">No clients yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <form className="card" onSubmit={add}>
        <div className="card-title">Add a client</div>
        <div className="form-grid">
          <label className="field"><span>Name</span><input className="input" value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} placeholder="Anil Kumar" /></label>
          <label className="field"><span>Email{emailOnly ? '' : ' (optional)'}</span><input className="input" type="email" required={emailOnly} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="anil@example.com" /></label>
          <label className="field"><span>Mobile (WhatsApp){emailOnly ? ', optional' : ''}</span>
            <div className="row" style={{ gap: 6 }}>
              <span className="muted">+</span>
              <input className="input" style={{ width: 80 }} aria-label="Country code" value={f.cc} onChange={(e) => setF({ ...f, cc: e.target.value })} />
              <input className="input" type="tel" aria-label="Mobile number" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="50 123 4567" />
            </div>
          </label>
        </div>
        {emailOnly && <div className="small muted">Clients sign in with an email code for now. The mobile number is kept for WhatsApp invites and for when mobile sign-in is switched on.</div>}
        <ErrorBox error={error} />
        <div><button className="btn" disabled={busy}>Add client</button></div>
      </form>
    </>
  );
}

// ---------------------------------------------------------------- Stages
export function StagesSection({ project, reloadProject, say }) {
  const [rows, reload, error, setError] = useRows('stages', project.id, 'position', true);
  const [busy, run] = useAction(setError);
  const [newName, setNewName] = useState('');
  const [newDates, setNewDates] = useState({ start: '', end: '' });

  const save = (id, patch) => run(() => must(supabase.from('stages').update(patch).eq('id', id))).then(reload);
  // Dates save when you leave the box (not on every key), and only a full, sensible date is accepted
  async function saveDate(s, field, value) {
    const v = value || null;
    if (v === s[field]) return;
    if (v && !/^(19|20)\d\d-\d\d-\d\d$/.test(v)) { setError(new Error('Please enter a full date with a 4-digit year.')); return; }
    const start = field === 'start_date' ? v : s.start_date;
    const end = field === 'end_date' ? v : s.end_date;
    if (start && end && end < start) { setError(new Error(`"${s.name}": end date is before the start date.`)); return; }
    const ok = await run(() => must(supabase.from('stages').update({ [field]: v }).eq('id', s.id)));
    if (ok) { say('Date saved'); reload(); }
  }

  async function makeCurrent(idx) {
    const ok = await run(async () => {
      await Promise.all(rows.map((s, i) => must(supabase.from('stages').update({ status: i < idx ? 'done' : i === idx ? 'current' : 'upcoming' }).eq('id', s.id))));
      await must(supabase.from('projects').update({ stage_label: rows[idx].name }).eq('id', project.id));
    });
    if (ok) { reload(); reloadProject(); say(`"${rows[idx].name}" is now the current stage`); }
  }

  async function move(idx, dir) {
    const j = idx + dir;
    if (j < 0 || j >= rows.length) return;
    await run(async () => {
      await must(supabase.from('stages').update({ position: j }).eq('id', rows[idx].id));
      await must(supabase.from('stages').update({ position: idx }).eq('id', rows[j].id));
    });
    reload();
  }

  async function add(e) {
    e.preventDefault();
    if (newDates.start && newDates.end && newDates.end < newDates.start) { setError(new Error('End date must be on or after the start date.')); return; }
    const row = { project_id: project.id, name: newName.trim(), position: rows.length, start_date: newDates.start || null, end_date: newDates.end || null };
    if (await run(() => must(supabase.from('stages').insert(row)))) { setNewName(''); setNewDates({ start: '', end: '' }); reload(); }
  }

  async function remove(s) {
    if (!window.confirm(`Delete stage "${s.name}"?`)) return;
    await run(() => must(supabase.from('stages').delete().eq('id', s.id)));
    reload();
  }

  if (!rows) return <Spinner />;
  const noDates = rows.filter((s) => !s.start_date || !s.end_date).length;
  return (
    <>
      {noDates > 0 && <div className="card small" style={{ background: '#fff6e5', borderColor: '#f0d49a' }}>{noDates} of {rows.length} stages still need a start or end date (shown in yellow). Clients see “Dates to be confirmed” for these.</div>}
      <div className="small muted">Set the planned start and end date of each stage; clients see them on their Progress screen. The note is for extra detail ("curing till 20 Nov"). "Make current" ticks off every stage before it.</div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>#</th><th>Stage</th><th>Start</th><th>End</th><th>Note for client</th><th>Status</th><th /></tr></thead>
          <tbody>
            {rows.map((s, i) => (
              <tr key={s.id}>
                <td>{i + 1}</td>
                <td><input className="input" style={{ height: 38, fontSize: 14, minWidth: 180 }} defaultValue={s.name} aria-label="Stage name" onBlur={(e) => e.target.value !== s.name && save(s.id, { name: e.target.value })} /></td>
                <td><input className="input" type="date" style={{ height: 38, fontSize: 13, width: 138, ...(s.start_date ? {} : MISSING) }} defaultValue={s.start_date || ''} aria-label="Start date"
                  onBlur={(e) => saveDate(s, 'start_date', e.target.value)} /></td>
                <td><input className="input" type="date" style={{ height: 38, fontSize: 13, width: 138, ...(s.end_date ? {} : MISSING) }} defaultValue={s.end_date || ''} aria-label="End date" min={s.start_date || undefined}
                  onBlur={(e) => saveDate(s, 'end_date', e.target.value)} /></td>
                <td><input className="input" style={{ height: 38, fontSize: 14, minWidth: 160 }} defaultValue={s.note} aria-label="Note" onBlur={(e) => e.target.value !== s.note && save(s.id, { note: e.target.value })} /></td>
                <td>
                  <select className="select" style={{ height: 38, fontSize: 14, width: 130 }} value={s.status} aria-label="Status" onChange={(e) => save(s.id, { status: e.target.value })}>
                    <option value="done">Done</option><option value="current">In progress</option><option value="upcoming">Upcoming</option>
                  </select>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn ghost small" disabled={busy} onClick={() => makeCurrent(i)}>Make current</button>{' '}
                  <button className="btn ghost small" disabled={busy || i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>{' '}
                  <button className="btn ghost small" disabled={busy || i === rows.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>{' '}
                  <button className="btn danger small" disabled={busy} onClick={() => remove(s)} aria-label="Delete stage"><Icon name="trash" size={16} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form className="toolbar" onSubmit={add}>
        <input className="input" style={{ maxWidth: 320 }} required placeholder="New stage name" value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="New stage name" />
        <input className="input" type="date" style={{ width: 160 }} value={newDates.start} onChange={(e) => setNewDates({ ...newDates, start: e.target.value })} aria-label="Start date" title="Start date" />
        <input className="input" type="date" style={{ width: 160 }} value={newDates.end} min={newDates.start || undefined} onChange={(e) => setNewDates({ ...newDates, end: e.target.value })} aria-label="End date" title="End date" />
        <button className="btn" disabled={busy}>Add stage</button>
      </form>
      <ErrorBox error={error} />
    </>
  );
}

// ---------------------------------------------------------------- Updates
export function UpdatesSection({ project, say }) {
  const [rows, reload, error, setError] = useRows('updates', project.id);
  const [photos, setPhotos] = useState([]);
  const [busy, run] = useAction(setError);
  const [period, setPeriod] = useState('');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState([]);
  const [progress, setProgress] = useState('');
  const fileInput = useRef(null);

  const loadPhotos = useCallback(async () => {
    const { data } = await supabase.from('update_photos').select('*').eq('project_id', project.id).order('created_at', { ascending: false }).limit(500);
    setPhotos(data || []);
  }, [project.id]);
  useEffect(() => { loadPhotos(); }, [loadPhotos]);

  async function post(e) {
    e.preventDefault();
    const ok = await run(async () => {
      const u = await must(supabase.from('updates').insert({ project_id: project.id, period: period.trim(), body: body.trim() }).select().single());
      for (let i = 0; i < files.length; i++) {
        setProgress(`Uploading photo ${i + 1} of ${files.length}…`);
        const path = await uploadFile(project.id, 'updates', files[i]);
        await must(supabase.from('update_photos').insert({ update_id: u.id, project_id: project.id, path }));
      }
    });
    setProgress('');
    if (ok) {
      setBody(''); setPeriod(''); setFiles([]);
      if (fileInput.current) fileInput.current.value = '';
      reload(); loadPhotos(); say('Update posted');
    }
  }

  async function remove(u) {
    if (!window.confirm('Delete this update and its photos?')) return;
    const ph = photos.filter((p) => p.update_id === u.id);
    if (await run(() => must(supabase.from('updates').delete().eq('id', u.id)))) {
      await Promise.all(ph.map((p) => removeFile(p.path)));
      reload(); loadPhotos();
    }
  }

  if (!rows) return <Spinner />;
  return (
    <>
      <form className="card" onSubmit={post}>
        <div className="card-title">Post a site update</div>
        <div className="small muted">The newest update shows on the client's home screen as "This week on site".</div>
        <label className="field" style={{ maxWidth: 260 }}><span>Week / period</span><input className="input" placeholder="2–7 Nov" value={period} onChange={(e) => setPeriod(e.target.value)} /></label>
        <label className="field"><span>What happened on site</span>
          <textarea className="textarea" required value={body} onChange={(e) => setBody(e.target.value)}
            placeholder="First floor slab cast on 6 Nov: 38 m³ of M20 concrete. 6 test cubes taken. Brickwork restarts 10 Nov." />
        </label>
        <label className="field"><span>Photos (you can pick many; they're resized automatically)</span>
          <input ref={fileInput} type="file" accept="image/*" multiple onChange={(e) => setFiles([...e.target.files])} />
        </label>
        {files.length > 0 && <div className="small">{files.length} photo{files.length > 1 ? 's' : ''} selected</div>}
        {progress && <div className="small">{progress}</div>}
        <ErrorBox error={error} />
        <div><button className="btn" disabled={busy}>{busy ? 'Posting…' : 'Post update'}</button></div>
      </form>
      {rows.map((u) => (
        <div key={u.id} className="card">
          <div className="between"><b>{u.period || 'Update'}</b><span className="small muted">{longDate(u.created_at)}</span></div>
          <div style={{ whiteSpace: 'pre-wrap', fontSize: 14 }}>{u.body}</div>
          <div className="thumbs">{photos.filter((p) => p.update_id === u.id).map((p) => <Photo key={p.id} path={p.path} alt="" />)}</div>
          <div><button className="btn danger small" disabled={busy} onClick={() => remove(u)}>Delete</button></div>
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------- Cameras + site log
export function CameraSection({ project, say }) {
  const [cams, reloadCams, error, setError] = useRows('cameras', project.id, 'position', true);
  const [events, reloadEvents] = useRows('site_events', project.id, 'happened_at', false);
  const [busy, run] = useAction(setError);
  const [c, setC] = useState({ name: '', stream_type: 'hls', url: '' });
  const [ev, setEv] = useState({ text: '', time: '' });

  async function addCam(e) {
    e.preventDefault();
    if (await run(() => must(supabase.from('cameras').insert({ ...c, name: c.name.trim(), url: c.url.trim(), project_id: project.id, position: cams.length })))) {
      setC({ name: '', stream_type: c.stream_type, url: '' }); reloadCams(); say('Camera added');
    }
  }
  const camUpdate = (id, patch) => run(() => must(supabase.from('cameras').update(patch).eq('id', id))).then(reloadCams);
  async function camDelete(cam) {
    if (!window.confirm(`Remove camera "${cam.name}"?`)) return;
    await run(() => must(supabase.from('cameras').delete().eq('id', cam.id)));
    reloadCams();
  }

  async function addEvent(e) {
    e.preventDefault();
    let happened = new Date();
    if (ev.time) {
      // time typed is IST
      const [h, m] = ev.time.split(':').map(Number);
      const istDate = new Date().toLocaleDateString('en-CA', { timeZone: IST });
      happened = new Date(`${istDate}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+05:30`);
    }
    if (await run(() => must(supabase.from('site_events').insert({ project_id: project.id, text: ev.text.trim(), happened_at: happened.toISOString() })))) {
      setEv({ text: '', time: '' }); reloadEvents();
    }
  }
  async function eventDelete(id) {
    await run(() => must(supabase.from('site_events').delete().eq('id', id)));
    reloadEvents();
  }

  if (!cams || !events) return <Spinner />;
  const hint = {
    hls: 'A live stream link ending in .m3u8 (from MediaMTX, a camera cloud service, etc.)',
    embed: 'An embed link, e.g. https://www.youtube.com/embed/VIDEO_ID for an unlisted YouTube Live stream',
    image: 'A snapshot image link the camera updates; the app reloads it every 10 seconds',
  }[c.stream_type];

  return (
    <>
      <div className="card-title">Site cameras</div>
      <div className="small muted">Clients see the first active camera on the home screen. See README → "Connecting CCTV" for how to get a link.</div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Name</th><th>Type</th><th>Link</th><th>Showing</th><th /></tr></thead>
          <tbody>
            {cams.map((cam) => (
              <tr key={cam.id}>
                <td><input className="input" style={{ height: 38, fontSize: 14 }} defaultValue={cam.name} aria-label="Camera name" onBlur={(e) => e.target.value !== cam.name && camUpdate(cam.id, { name: e.target.value })} /></td>
                <td>{cam.stream_type}</td>
                <td><input className="input" style={{ height: 38, fontSize: 13, minWidth: 260 }} defaultValue={cam.url} aria-label="Camera link" onBlur={(e) => e.target.value !== cam.url && camUpdate(cam.id, { url: e.target.value.trim() })} /></td>
                <td><input type="checkbox" checked={cam.active} aria-label="Show to client" onChange={(e) => camUpdate(cam.id, { active: e.target.checked })} /></td>
                <td><button className="btn danger small" disabled={busy} onClick={() => camDelete(cam)}>Remove</button></td>
              </tr>
            ))}
            {cams.length === 0 && <tr><td colSpan={5} className="muted">No cameras yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <form className="card" onSubmit={addCam}>
        <div className="form-grid">
          <label className="field"><span>Camera name</span><input className="input" required placeholder="Front elevation" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></label>
          <label className="field"><span>Type</span>
            <select className="select" value={c.stream_type} onChange={(e) => setC({ ...c, stream_type: e.target.value })}>
              <option value="hls">Live stream (.m3u8)</option><option value="embed">Embed / YouTube Live</option><option value="image">Snapshot image</option>
            </select>
          </label>
        </div>
        <label className="field"><span>Link</span><input className="input" required type="url" value={c.url} onChange={(e) => setC({ ...c, url: e.target.value })} /></label>
        <div className="small muted">{hint}</div>
        <div><button className="btn" disabled={busy}>Add camera</button></div>
      </form>

      <div className="card-title" style={{ marginTop: 10 }}>Today on site (log)</div>
      <div className="small muted">Short notes the client sees under the camera, e.g. "Cement delivery, 220 bags". Shows the last 36 hours.</div>
      <form className="toolbar" onSubmit={addEvent}>
        <input className="input" style={{ maxWidth: 420 }} required placeholder="Engineer site visit" value={ev.text} onChange={(e) => setEv({ ...ev, text: e.target.value })} aria-label="What happened" />
        <input className="input" style={{ width: 130 }} type="time" value={ev.time} onChange={(e) => setEv({ ...ev, time: e.target.value })} aria-label="Time (IST), blank for now" />
        <button className="btn" disabled={busy}>Add</button>
      </form>
      <div className="card flush">
        {events.slice(0, 30).map((e) => (
          <div key={e.id} className="list-row">
            <span style={{ flex: 1 }}>{e.text}</span>
            <span className="small muted">{shortDate(e.happened_at)} {timeIn(e.happened_at, IST)}</span>
            <button className="btn danger small" onClick={() => eventDelete(e.id)} aria-label="Delete entry"><Icon name="trash" size={16} /></button>
          </div>
        ))}
        {events.length === 0 && <div className="empty" style={{ padding: 16 }}>Nothing logged yet.</div>}
      </div>
      <ErrorBox error={error} />
    </>
  );
}

// ---------------------------------------------------------------- Bills
const EMPTY_BILL = { id: null, number: '', title: '', amount: '', percent_of_contract: '', details: '', status: 'due', due_date: '', paid_on: '' };

export function BillsSection({ project, say }) {
  const [rows, reload, error, setError] = useRows('bills', project.id, 'number', true);
  const [busy, run] = useAction(setError);
  const [f, setF] = useState(EMPTY_BILL);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  useEffect(() => {
    if (rows && !f.id && !f.number) setF((x) => ({ ...x, number: String((rows.at(-1)?.number || 0) + 1) }));
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fill % from amount when contract amount is known
  const autoPct = () => {
    const c = Number(project.contract_amount);
    if (c > 0 && f.amount && !f.percent_of_contract) setF({ ...f, percent_of_contract: ((Number(f.amount) / c) * 100).toFixed(1) });
  };

  async function save(e) {
    e.preventDefault();
    const row = {
      project_id: project.id, number: Number(f.number), title: f.title.trim(), amount: Number(f.amount),
      percent_of_contract: f.percent_of_contract === '' ? null : Number(f.percent_of_contract), details: f.details.trim(),
      status: f.status, due_date: f.due_date || null, paid_on: f.status === 'paid' ? (f.paid_on || today()) : null,
    };
    const ok = await run(() => must(f.id ? supabase.from('bills').update(row).eq('id', f.id) : supabase.from('bills').insert(row)));
    if (ok) { say(f.id ? 'Bill updated' : 'Bill added'); setF({ ...EMPTY_BILL, number: '' }); reload(); }
  }

  async function attach(b, field, file) {
    if (!file) return;
    const ok = await run(async () => {
      const path = await uploadFile(project.id, 'bills', file);
      await must(supabase.from('bills').update({ [field]: path }).eq('id', b.id));
      if (b[field]) await removeFile(b[field]);
    });
    if (ok) { reload(); say('File uploaded'); }
  }

  async function markPaid(b) {
    const d = window.prompt('Paid on (YYYY-MM-DD)', today());
    if (!d) return;
    if (await run(() => must(supabase.from('bills').update({ status: 'paid', paid_on: d }).eq('id', b.id)))) reload();
  }

  async function remove(b) {
    if (!window.confirm(`Delete Bill ${b.number}?`)) return;
    if (await run(() => must(supabase.from('bills').delete().eq('id', b.id)))) {
      await removeFile(b.bill_path); await removeFile(b.receipt_path); reload();
    }
  }

  if (!rows) return <Spinner />;
  const total = (st) => rows.filter((b) => b.status === st).reduce((s, b) => s + Number(b.amount), 0);

  return (
    <>
      <div className="toolbar small">
        <span>Contract: <b>{inr(project.contract_amount)}</b></span>·
        <span className="green">Paid: <b>{inr(total('paid'))}</b></span>·
        <span className="amber">Due: <b>{inr(total('due'))}</b></span>·
        <span>Upcoming: <b>{inr(total('upcoming'))}</b></span>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>#</th><th>Title</th><th>Amount</th><th>Status</th><th>Files</th><th /></tr></thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id}>
                <td>{b.number}</td>
                <td>{b.title}<div className="small muted">{b.details}</div></td>
                <td style={{ whiteSpace: 'nowrap' }}>{inr(b.amount)}</td>
                <td><span className={`pill ${b.status === 'paid' ? 'done' : b.status === 'due' ? 'due' : 'upcoming'}`}>{b.status}</span>
                  <div className="small muted">{b.status === 'paid' ? longDate(b.paid_on) : b.due_date ? `due ${shortDate(b.due_date)}` : ''}</div></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <FileCell label="Bill PDF" path={b.bill_path} onPick={(file) => attach(b, 'bill_path', file)} />
                  <FileCell label="Receipt" path={b.receipt_path} onPick={(file) => attach(b, 'receipt_path', file)} />
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {b.status !== 'paid' && <><button className="btn small" disabled={busy} onClick={() => markPaid(b)}>Mark paid</button>{' '}</>}
                  <button className="btn ghost small" onClick={() => setF({ ...EMPTY_BILL, ...b, number: String(b.number), amount: String(b.amount), percent_of_contract: b.percent_of_contract ?? '', due_date: b.due_date || '', paid_on: b.paid_on || '' })}>Edit</button>{' '}
                  <button className="btn danger small" disabled={busy} onClick={() => remove(b)} aria-label="Delete bill"><Icon name="trash" size={16} /></button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="muted">No bills yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <form className="card" onSubmit={save}>
        <div className="card-title">{f.id ? `Edit Bill ${f.number}` : 'Add a bill'}</div>
        <div className="form-grid">
          <label className="field"><span>Bill no.</span><input className="input" type="number" required value={f.number} onChange={set('number')} /></label>
          <label className="field"><span>Title</span><input className="input" required placeholder="First floor slab" value={f.title} onChange={set('title')} /></label>
          <label className="field"><span>Amount (₹)</span><input className="input" type="number" step="any" required value={f.amount} onChange={set('amount')} onBlur={autoPct} /></label>
          <label className="field"><span>% of contract</span><input className="input" type="number" step="any" value={f.percent_of_contract} onChange={set('percent_of_contract')} /></label>
          <label className="field"><span>Status</span>
            <select className="select" value={f.status} onChange={set('status')}><option value="upcoming">Upcoming</option><option value="due">Due now</option><option value="paid">Paid</option></select>
          </label>
          <label className="field"><span>Due date</span><input className="input" type="date" value={f.due_date} onChange={set('due_date')} /></label>
          {f.status === 'paid' && <label className="field"><span>Paid on</span><input className="input" type="date" value={f.paid_on} onChange={set('paid_on')} /></label>}
        </div>
        <label className="field"><span>Details line (optional)</span><input className="input" placeholder="6 BOQ items measured · 24 photos" value={f.details} onChange={set('details')} /></label>
        <div className="small muted">Upload the bill PDF and receipt from the table after saving.</div>
        <ErrorBox error={error} />
        <div className="toolbar">
          <button className="btn" disabled={busy}>{f.id ? 'Save changes' : 'Add bill'}</button>
          {f.id && <button type="button" className="btn ghost" onClick={() => setF({ ...EMPTY_BILL, number: String((rows.at(-1)?.number || 0) + 1) })}>Cancel</button>}
        </div>
      </form>
    </>
  );
}

function FileCell({ label, path, onPick }) {
  const ref = useRef(null);
  return (
    <span style={{ marginRight: 8 }}>
      <input ref={ref} type="file" accept="application/pdf,image/*" hidden onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = ''; }} />
      {path && <button className="linkish small" style={{ padding: '4px' }} onClick={() => openFile(path)}>{label} ↗</button>}
      <button className="btn ghost small" onClick={() => ref.current?.click()}>{path ? 'Replace' : `Upload ${label.toLowerCase()}`}</button>
    </span>
  );
}

// ---------------------------------------------------------------- Decisions
const newOpt = () => ({ key: Math.random(), name: '', detail: '', cost_delta: '', file: null });

export function DecisionsSection({ project, say }) {
  const [rows, reload, error, setError] = useRows('approvals', project.id);
  const [opts, setOpts] = useState([]);
  const [busy, run] = useAction(setError);
  const [f, setF] = useState({ title: '', description: '', due_date: '', reference: '' });
  const [options, setOptions] = useState([newOpt(), newOpt()]);

  const loadOpts = useCallback(async () => {
    const { data } = await supabase.from('approval_options').select('*').eq('project_id', project.id).order('position');
    setOpts(data || []);
  }, [project.id]);
  useEffect(() => { loadOpts(); }, [loadOpts]);

  const setOpt = (i, k, v) => setOptions(options.map((o, j) => (j === i ? { ...o, [k]: v } : o)));

  async function create(e) {
    e.preventDefault();
    const filled = options.filter((o) => o.name.trim());
    const ok = await run(async () => {
      if (filled.length < 1) throw new Error('Add at least one option.');
      const a = await must(supabase.from('approvals').insert({
        project_id: project.id, title: f.title.trim(), description: f.description.trim(), due_date: f.due_date || null, reference: f.reference.trim(),
      }).select().single());
      for (let i = 0; i < filled.length; i++) {
        const o = filled[i];
        const photo_path = o.file ? await uploadFile(project.id, 'decisions', o.file) : null;
        await must(supabase.from('approval_options').insert({
          approval_id: a.id, project_id: project.id, position: i, name: o.name.trim(), detail: o.detail.trim(), cost_delta: Number(o.cost_delta || 0), photo_path,
        }));
      }
    });
    if (ok) {
      setF({ title: '', description: '', due_date: '', reference: '' }); setOptions([newOpt(), newOpt()]);
      reload(); loadOpts(); say('Sent to the client');
    }
  }

  async function setStatus(a, status) {
    const patch = status === 'open' ? { status, chosen_option_id: null, decided_by: null, decided_by_name: '', decided_at: null } : { status };
    if (await run(() => must(supabase.from('approvals').update(patch).eq('id', a.id)))) reload();
  }

  async function remove(a) {
    if (!window.confirm(`Delete "${a.title}"?`)) return;
    const paths = opts.filter((o) => o.approval_id === a.id && o.photo_path).map((o) => o.photo_path);
    if (await run(() => must(supabase.from('approvals').delete().eq('id', a.id)))) {
      await Promise.all(paths.map(removeFile)); reload(); loadOpts();
    }
  }

  if (!rows) return <Spinner />;
  return (
    <>
      <form className="card" onSubmit={create}>
        <div className="card-title">Ask the client to decide</div>
        <div className="form-grid">
          <label className="field"><span>Title</span><input className="input" required placeholder="Living room floor tile" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
          <label className="field"><span>Decide by</span><input className="input" type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></label>
          <label className="field"><span>Reference (e.g. VO-03)</span><input className="input" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></label>
        </div>
        <label className="field"><span>Explanation</span>
          <textarea className="textarea" rows={3} placeholder="Pick one. Samples were shown on the 7 Nov video call. The upgrade is added as a variation order at the Annexure B rate."
            value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </label>
        {options.map((o, i) => (
          <div key={o.key} className="card" style={{ background: 'var(--bg)' }}>
            <div className="between"><b>Option {i + 1}</b>
              {options.length > 1 && <button type="button" className="linkish" onClick={() => setOptions(options.filter((_, j) => j !== i))}>Remove</button>}
            </div>
            <div className="form-grid">
              <label className="field"><span>Name</span><input className="input" placeholder="Kajaria matt, Ivory" value={o.name} onChange={(e) => setOpt(i, 'name', e.target.value)} /></label>
              <label className="field"><span>Detail</span><input className="input" placeholder="800 × 800 mm · in BOQ item F1" value={o.detail} onChange={(e) => setOpt(i, 'detail', e.target.value)} /></label>
              <label className="field"><span>Extra cost ₹ (0 = none, minus = saving; an extra cost is billed automatically, due the day the client approves)</span><input className="input" type="number" step="any" value={o.cost_delta} onChange={(e) => setOpt(i, 'cost_delta', e.target.value)} /></label>
              <label className="field"><span>Photo (optional)</span><input type="file" accept="image/*" onChange={(e) => setOpt(i, 'file', e.target.files?.[0] || null)} /></label>
            </div>
          </div>
        ))}
        <ErrorBox error={error} />
        <div className="toolbar">
          <button type="button" className="btn ghost" onClick={() => setOptions([...options, newOpt()])}><Icon name="plus" size={18} /> Add option</button>
          <button className="btn" disabled={busy}>{busy ? 'Sending…' : 'Send to client'}</button>
        </div>
      </form>

      {rows.map((a) => {
        const mine = opts.filter((o) => o.approval_id === a.id);
        const chosen = mine.find((o) => o.id === a.chosen_option_id);
        return (
          <div key={a.id} className="card">
            <div className="between">
              <b>{a.reference ? `${a.reference} · ` : ''}{a.title}</b>
              <span className={`pill ${a.status === 'decided' ? 'done' : a.status === 'open' ? 'due' : 'upcoming'}`}>{a.status === 'open' ? 'Waiting for client' : a.status}</span>
            </div>
            <div className="small muted">{a.due_date ? `Decide by ${shortDate(a.due_date)} · ` : ''}Created {longDate(a.created_at)}</div>
            <div className="thumbs" style={{ flexDirection: 'column', gap: 4 }}>
              {mine.map((o) => (
                <div key={o.id} className="row small" style={{ fontWeight: o.id === a.chosen_option_id ? 700 : 400 }}>
                  {o.id === a.chosen_option_id ? '✔' : '•'} {[o.name, o.detail, delta(o.cost_delta)].filter(Boolean).join(' — ')}
                </div>
              ))}
            </div>
            {chosen && <div className="success">Chose "{chosen.name}" — {a.decided_by_name || 'client'}, {new Date(a.decided_at).toLocaleString('en-GB', { timeZone: IST })} IST</div>}
            <div className="toolbar">
              {a.status === 'open' && <button className="btn ghost small" disabled={busy} onClick={() => setStatus(a, 'cancelled')}>Cancel request</button>}
              {a.status !== 'open' && <button className="btn ghost small" disabled={busy} onClick={() => { if (window.confirm('Reopen so the client can choose again?')) setStatus(a, 'open'); }}>Reopen</button>}
              <button className="btn danger small" disabled={busy} onClick={() => remove(a)}>Delete</button>
            </div>
          </div>
        );
      })}
    </>
  );
}
