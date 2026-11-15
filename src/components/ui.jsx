import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useSignedUrl } from '../lib/files';

const paths = {
  home: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
  progress: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  payments: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></>,
  chat: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  back: <path d="M15 6l-6 6 6 6" />,
  chevron: <path d="M9 6l6 6-6 6" />,
  bell: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10 21h4" /></>,
  expand: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  video: <><rect x="2" y="6" width="14" height="12" rx="2" /><path d="M16 10l6-3v10l-6-3" /></>,
  attach: <path d="M21 12l-8.5 8.5a5 5 0 0 1-7-7L14 5a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 8" />,
  send: <path d="M4 12l16-8-6 16-2-7z" />,
  logout: <><path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4" /><path d="M10 17l-5-5 5-5M5 12h11" /></>,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  download: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  camera: <><path d="M3 8h4l2-3h6l2 3h4v11H3z" /><circle cx="12" cy="13" r="3.5" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />,
};

export function Icon({ name, size = 22, stroke = 2, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {paths[name]}
    </svg>
  );
}

// Shows /logo.png if you add one to the public folder, else a text wordmark.
export function Logo({ width = 150, compact = false }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <span className="wordmark" style={{ fontSize: compact ? 13 : 20 }}>{compact ? 'C' : 'CIVILION'}</span>;
  }
  return (
    <img src={`${import.meta.env.BASE_URL}${compact ? 'logo-mark.png' : 'logo.png'}`} alt="Civilion Builders and Developers LLP"
      style={{ display: 'block', width, height: 'auto' }} onError={() => setFailed(true)} />
  );
}

export function Spinner({ full = true }) {
  const s = <div className="spinner" role="status" aria-label="Loading" />;
  return full ? <div className="center-fill">{s}</div> : s;
}

export function ErrorBox({ error }) {
  if (!error) return null;
  return <div className="error" role="alert">{error.message || String(error)}</div>;
}

export function TabBar({ chatDot }) {
  const tabs = [
    { to: '/', label: 'Home', icon: 'home', end: true },
    { to: '/progress', label: 'Progress', icon: 'progress' },
    { to: '/payments', label: 'Payments', icon: 'payments' },
    { to: '/chat', label: 'Chat', icon: 'chat' },
  ];
  return (
    <nav className="tabbar" aria-label="Main">
      {tabs.map((t) => (
        <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => (isActive ? 'active' : '')}>
          <Icon name={t.icon} />
          {t.label}
          {t.icon === 'chat' && chatDot ? <span className="dot" aria-label="New messages" /> : null}
        </NavLink>
      ))}
    </nav>
  );
}

export function Photo({ path, alt = '', className, style, onClick }) {
  const url = useSignedUrl(path);
  if (!url) return <span className={className} style={{ display: 'block', background: '#f2dfe0', ...style }} />;
  const img = <img src={url} alt={alt} className={className} style={style} loading="lazy" />;
  return onClick ? <button type="button" onClick={onClick} style={{ border: 0, padding: 0, background: 'none', display: 'block', width: '100%', height: '100%', cursor: 'pointer' }} aria-label={alt || 'Open photo'}>{img}</button> : img;
}

export function Lightbox({ path, caption, onClose }) {
  const url = useSignedUrl(path);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="Photo">
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: 'calc(12px + var(--safe-top)) 12px 0', gap: 4 }}>
        {url && <a className="icon-btn" style={{ color: '#fff' }} href={url} target="_blank" rel="noreferrer" aria-label="Download"><Icon name="download" /></a>}
        <button className="icon-btn" style={{ color: '#fff' }} onClick={onClose} aria-label="Close"><Icon name="close" /></button>
      </div>
      {url ? <img src={url} alt={caption || 'Site photo'} /> : <Spinner />}
      {caption ? <div className="cap">{caption}</div> : null}
    </div>
  );
}

export function Sheet({ title, onClose, children }) {
  return (
    <div className="sheet-back" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="between">
          <h2 style={{ fontSize: 19 }}>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function useToast() {
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(''), 2600);
    return () => clearTimeout(t);
  }, [msg]);
  const node = msg ? <div className="toast" role="status">{msg}</div> : null;
  return [node, setMsg];
}
