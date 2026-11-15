import { Fragment, useEffect, useRef, useState } from 'react';
import { supabase, must } from '../lib/supabase';
import { uploadFile } from '../lib/files';
import { dualTime, longDate } from '../lib/format';
import { Icon, Photo, Lightbox, Spinner, ErrorBox } from './ui';

export function markChatSeen(projectId) {
  try { localStorage.setItem(`civ_seen_${projectId}`, new Date().toISOString()); } catch { /* ignore */ }
}
export function chatSeenAt(projectId) {
  try { return localStorage.getItem(`civ_seen_${projectId}`) || ''; } catch { return ''; }
}

// staffView: messages from staff appear on the right (as "me"), clients on the left
export default function ChatView({ projectId, staffView = false, quickReplies = [], placeholder = 'Message', initialText = '' }) {
  const [msgs, setMsgs] = useState(null);
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [lightbox, setLightbox] = useState(null);
  const listRef = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => {
    let live = true;
    setMsgs(null);
    supabase.from('messages').select('*').eq('project_id', projectId)
      .order('created_at', { ascending: false }).limit(300)
      .then(({ data, error: e }) => {
        if (!live) return;
        if (e) setError(e);
        setMsgs((data || []).reverse());
      });
    const ch = supabase.channel(`chat-${projectId}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `project_id=eq.${projectId}` },
        (p) => setMsgs((m) => (m && !m.some((x) => x.id === p.new.id) ? [...m, p.new] : m)))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' },
        (p) => setMsgs((m) => m && m.filter((x) => x.id !== p.old.id)))
      .subscribe();
    markChatSeen(projectId);
    return () => { live = false; supabase.removeChannel(ch); };
  }, [projectId]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    markChatSeen(projectId);
  }, [msgs, projectId]);

  async function send(body, photoPath = null) {
    const clean = (body || '').trim();
    if (!clean && !photoPath) return;
    setBusy(true); setError(null);
    try {
      const row = await must(supabase.from('messages').insert({ project_id: projectId, body: clean, photo_path: photoPath }).select().single());
      setMsgs((m) => (m && !m.some((x) => x.id === row.id) ? [...m, row] : m));
      setText('');
    } catch (e) { setError(e); }
    setBusy(false);
  }

  async function onPick(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true); setError(null);
    try {
      const path = await uploadFile(projectId, 'chat', f);
      await send(text, path);
    } catch (err) { setError(err); setBusy(false); }
  }

  async function remove(id) {
    if (!window.confirm('Delete this message for everyone?')) return;
    const { error: e } = await supabase.from('messages').delete().eq('id', id);
    if (e) setError(e); else setMsgs((m) => m.filter((x) => x.id !== id));
  }

  if (!msgs) return <Spinner />;

  let lastDay = '';
  return (
    <>
      <div className="chat-list" ref={listRef} aria-live="polite">
        {msgs.length === 0 && <div className="empty">No messages yet. Say hello!</div>}
        {msgs.map((m) => {
          const mine = staffView ? m.from_staff : !m.from_staff;
          const day = longDate(m.created_at);
          const showDay = day !== lastDay;
          lastDay = day;
          return (
            <Fragment key={m.id}>
              {showDay && <div className="day-chip">{day === longDate(new Date()) ? 'Today' : day}</div>}
              <div className={`bubble ${mine ? 'me' : 'them'}`}>
                {!mine && <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--maroon)', marginBottom: 2 }}>{m.sender_name}</div>}
                {m.photo_path && <Photo path={m.photo_path} alt="Photo in chat" onClick={() => setLightbox(m)} />}
                {m.body}
              </div>
              <div className={`bubble-time ${mine ? 'me' : ''}`}>
                {dualTime(m.created_at)}
                {staffView && <button className="linkish" style={{ padding: '0 6px', fontSize: 11 }} onClick={() => remove(m.id)}>Delete</button>}
              </div>
            </Fragment>
          );
        })}
      </div>
      <ErrorBox error={error} />
      {quickReplies.length > 0 && (
        <div className="chips-row">
          {quickReplies.map((q) => <button key={q} className="chip" disabled={busy} onClick={() => send(q)}>{q}</button>)}
        </div>
      )}
      <form className="composer" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPick} />
        <button type="button" className="circle soft" aria-label="Attach photo" disabled={busy} onClick={() => fileRef.current?.click()}><Icon name="attach" size={20} /></button>
        <label htmlFor={`msg-${projectId}`} className="sr-only">Message</label>
        <textarea id={`msg-${projectId}`} rows={1} value={text} placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer: fine)').matches) { e.preventDefault(); send(text); } }} />
        <button type="submit" className="circle primary" aria-label="Send" disabled={busy || !text.trim()}><Icon name="send" size={18} stroke={2.2} /></button>
      </form>
      {lightbox && <Lightbox path={lightbox.photo_path} caption={lightbox.body} onClose={() => setLightbox(null)} />}
    </>
  );
}
