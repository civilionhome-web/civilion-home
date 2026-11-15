import { Link, useLocation } from 'react-router-dom';
import { useProject } from './ClientLayout';
import { digitsOnly, initials } from '../../lib/format';
import { Icon } from '../../components/ui';
import ChatView from '../../components/ChatView';

export default function Chat() {
  const { project } = useProject();
  const loc = useLocation();
  const pm = project.pm_name || 'Civilion team';
  const wa = digitsOnly(project.pm_phone);

  return (
    <div className="screen no-tabs" style={{ height: '100dvh', paddingBottom: 0 }}>
      <div className="chat-head">
        <Link to="/" className="icon-btn" aria-label="Back to home"><Icon name="back" stroke={2.2} /></Link>
        <div className="avatar">{initials(pm)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{pm}</div>
          <div className="small muted">Project manager · replies in IST working hours</div>
        </div>
        {wa && (
          <a className="circle" style={{ background: 'var(--maroon-tint)', color: 'var(--maroon)' }} aria-label={`WhatsApp video call with ${pm}`}
            href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer"><Icon name="video" size={20} /></a>
        )}
      </div>
      <ChatView
        projectId={project.id}
        initialText={loc.state?.draft || ''}
        placeholder={`Message ${pm.split(' ')[0]} · English or Malayalam`}
        quickReplies={['Can we book a video call?', 'Please share fresh site photos']}
      />
    </div>
  );
}
