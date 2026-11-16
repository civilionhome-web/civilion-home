import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase, CLIENT_LOGIN } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { digitsOnly } from '../lib/format';
import { Logo, ErrorBox } from '../components/ui';

const COUNTRIES = [
  ['+971', 'UAE'], ['+966', 'Saudi'], ['+974', 'Qatar'], ['+968', 'Oman'], ['+965', 'Kuwait'], ['+973', 'Bahrain'],
  ['+91', 'India'], ['+44', 'UK'], ['+1', 'US/Canada'], ['+61', 'Australia'], ['+65', 'Singapore'], ['+64', 'NZ'],
];

export default function Login() {
  const { session, profile, isStaff, loading } = useAuth();
  const [mode, setMode] = useState(CLIENT_LOGIN === 'email' ? 'email' : 'phone'); // phone | email | staff
  const [step, setStep] = useState('enter'); // enter | code
  const [cc, setCc] = useState('+971');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState('');

  if (!loading && session && profile) return <Navigate to={isStaff ? '/admin' : '/'} replace />;

  const fullPhone = `${cc}${digitsOnly(phone).replace(/^0+/, '')}`;
  const channel = CLIENT_LOGIN === 'sms' ? 'sms' : 'whatsapp';

  async function sendCode(e) {
    e.preventDefault();
    setBusy(true); setError(null); setInfo('');
    const { error: err } = mode === 'phone'
      ? await supabase.auth.signInWithOtp({ phone: fullPhone, options: { channel } })
      : await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
    setBusy(false);
    if (err) { setError(err); return; }
    setStep('code');
    setInfo(mode === 'phone'
      ? `We sent a 6-digit code to ${fullPhone} on ${channel === 'whatsapp' ? 'WhatsApp' : 'SMS'}.`
      : `We emailed a 6-digit code to ${email.trim()}.`);
  }

  async function verify(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    const token = digitsOnly(code);
    const { error: err } = mode === 'phone'
      ? await supabase.auth.verifyOtp({ phone: fullPhone, token, type: 'sms' })
      : await supabase.auth.verifyOtp({ email: email.trim(), token, type: 'email' });
    setBusy(false);
    if (err) setError(err);
  }

  async function staffSignIn(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (err) setError(err);
  }

  function switchMode(m) { setMode(m); setStep('enter'); setError(null); setInfo(''); setCode(''); }

  return (
    <div className="login">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div className="logo-box"><Logo width={170} /></div>
        <div>
          <div className="kicker">CIVILION HOME</div>
          <h1>Watch your Kerala home rise, from anywhere.</h1>
        </div>
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, opacity: 0.9 }}>
          Live site camera, weekly updates, BOQ bills and your project manager, in one place.
        </p>
      </div>

      {mode === 'staff' ? (
        <form className="login-form" onSubmit={staffSignIn}>
          <div style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 17 }}>Civilion staff sign in</div>
          <label className="field"><span>Work email</span>
            <input className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field"><span>Password</span>
            <input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <ErrorBox error={error} />
          <button className="btn" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <button type="button" className="linkish" onClick={() => switchMode(CLIENT_LOGIN === 'email' ? 'email' : 'phone')}>I'm a client</button>
        </form>
      ) : step === 'enter' ? (
        <form className="login-form" onSubmit={sendCode}>
          {mode === 'phone' ? (
            <>
              <label htmlFor="phone" style={{ fontSize: 13, fontWeight: 600 }}>Mobile number registered with Civilion</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <select className="select" style={{ width: 'auto', padding: '0 8px' }} aria-label="Country code" value={cc} onChange={(e) => setCc(e.target.value)}>
                  {COUNTRIES.map(([c, n]) => <option key={c} value={c}>{c} {n}</option>)}
                </select>
                <input id="phone" className="input" type="tel" inputMode="tel" autoComplete="tel-national" required
                  placeholder="50 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
            </>
          ) : (
            <label className="field"><span>Email registered with Civilion</span>
              <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
          )}
          <ErrorBox error={error} />
          <button className="btn" disabled={busy}>
            {busy ? 'Sending…' : mode === 'phone' ? `Send OTP on ${channel === 'whatsapp' ? 'WhatsApp' : 'SMS'}` : 'Email me a code'}
          </button>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', textAlign: 'center' }}>
            No account yet? Your project manager sends an invite when you sign the agreement.
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 4, flexWrap: 'wrap' }}>
            {CLIENT_LOGIN !== 'email' && (
              <button type="button" className="linkish" onClick={() => switchMode(mode === 'phone' ? 'email' : 'phone')}>
                {mode === 'phone' ? 'Use email instead' : 'Use mobile number'}
              </button>
            )}
            <button type="button" className="linkish" onClick={() => switchMode('staff')}>Staff sign in</button>
          </div>
        </form>
      ) : (
        <form className="login-form" onSubmit={verify}>
          <div style={{ fontSize: 14 }}>{info}</div>
          <label className="field"><span>Enter the code</span>
            <input className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={8} required autoFocus
              style={{ letterSpacing: '0.3em', fontSize: 22, textAlign: 'center' }} value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
          <ErrorBox error={error} />
          <button className="btn" disabled={busy || digitsOnly(code).length < 6}>{busy ? 'Checking…' : 'Sign in'}</button>
          <button type="button" className="linkish" onClick={() => { setStep('enter'); setCode(''); setError(null); }}>Change number or resend code</button>
        </form>
      )}
    </div>
  );
}
