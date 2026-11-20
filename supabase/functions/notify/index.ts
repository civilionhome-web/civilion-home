// Supabase Edge Function "notify"
// Called by the database with { id } of a new client notification (migration 09),
// or { staff_id } of a new staff alert (migration 12: day-plan reminders).
// Client notifications go to the project's clients; staff alerts to that one staff member.
// It is safe to call more than once: a notification is only sent the first time.
//
// Secrets to set in Supabase → Edge Functions → Secrets:
//   VAPID_PRIVATE_KEY  – private push key (matches the public key below)
//   SMTP_PASS          – Gmail app password for the sender account
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import nodemailer from 'npm:nodemailer@6.9.16';

const APP_URL = 'https://civilionhome-web.github.io/civilion-home';
const VAPID_PUBLIC_KEY = 'BNgju1XLLKxEA9HUmYbUWnSrwby-ZUpmKo7QXTZfNjhYQ4o1sh_r0cryaKczrlIbav2XJ9HayU2fK9fqMaSFyao';
const SMTP_USER = 'ceocivilionbuilders@gmail.com';
const FROM_NAME = 'Civilion Home';
// Kinds that also go out by email (daily logs and stage ticks are bell + push only)
const EMAIL_KINDS = new Set(['bill', 'credit', 'decision', 'update', 'message', 'document']);
// Staff alerts that also go out by email (the 6 pm and 8 pm reminders)
const STAFF_EMAIL_KINDS = new Set(['plan_reminder', 'plan_summary']);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function emailHtml(project: string, title: string, body: string, url: string) {
  return `<!doctype html><html><body style="margin:0;background:#f5f2ef;font-family:Arial,Helvetica,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f2ef;padding:24px 0"><tr><td align="center">
  <table width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden">
    <tr><td style="background:#8a1c22;color:#ffffff;padding:16px 24px;font-size:15px;font-weight:bold">Civilion Home · ${esc(project)}</td></tr>
    <tr><td style="padding:24px">
      <div style="font-size:19px;font-weight:bold;color:#1f1a17;margin-bottom:8px">${esc(title)}</div>
      <div style="font-size:15px;line-height:1.5;color:#4a423c;white-space:pre-wrap">${esc(body)}</div>
      <div style="margin-top:22px"><a href="${url}" style="background:#8a1c22;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold;display:inline-block">Open Civilion Home</a></div>
    </td></tr>
    <tr><td style="padding:14px 24px;color:#8a817a;font-size:12px;border-top:1px solid #eee">Civilion Builders and Developers LLP · You can turn off these emails in the app under Notifications.</td></tr>
  </table></td></tr></table></body></html>`;
}

const isId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);

function serverClient() {
  // Server key: legacy service_role, or the new secret key ("default")
  let serverKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!serverKey) { try { serverKey = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default || ''; } catch { /* ignore */ } }
  return createClient(Deno.env.get('SUPABASE_URL')!, serverKey, { auth: { persistSession: false } });
}

async function pushTo(sb: any, userIds: string[], payload: string, result: any) {
  const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY');
  if (!vapidPrivate) { result.notes.push('VAPID_PRIVATE_KEY not set'); return; }
  try {
    webpush.setVapidDetails('mailto:' + SMTP_USER, VAPID_PUBLIC_KEY, vapidPrivate);
    if (!userIds.length) return;
    const { data: subs } = await sb.from('push_subscriptions').select('*').in('user_id', userIds);
    await Promise.all((subs || []).map(async (s: any) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400 });
        result.push++;
      } catch (e: any) {
        result.pushFailed++;
        if (e?.statusCode === 404 || e?.statusCode === 410) await sb.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
        else result.notes.push('push: ' + (e?.statusCode || e?.message || e));
      }
    }));
  } catch (e: any) { result.notes.push('push setup: ' + (e?.message || e)); }
}

// Staff alert (day-plan reminders): bell row already exists; send push and, for reminders, email
async function sendStaffAlert(id: string) {
  const sb = serverClient();
  const { data: n, error } = await sb.from('staff_notifications')
    .update({ sent_at: new Date().toISOString() })
    .eq('id', id).is('sent_at', null)
    .select('id, user_id, kind, title, body, link, profiles(email, full_name)')
    .maybeSingle();
  if (error) return json({ ok: false, error: error.message }, 500);
  if (!n) return json({ ok: true, skipped: 'already sent or not found' });
  const url = APP_URL + (n.link || '/admin/planner');
  const result = { push: 0, pushFailed: 0, email: 0, emailFailed: 0, notes: [] as string[] };
  await pushTo(sb, [n.user_id], JSON.stringify({ title: n.title, body: n.body, url, tag: n.kind }), result);

  const to = String((n as any).profiles?.email || '').toLowerCase();
  const smtpPass = Deno.env.get('SMTP_PASS');
  if (STAFF_EMAIL_KINDS.has(n.kind) && to.includes('@') && smtpPass) {
    const mailer = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: SMTP_USER, pass: smtpPass } });
    try {
      await mailer.sendMail({
        from: `${FROM_NAME} <${SMTP_USER}>`, to, subject: n.title,
        text: `${n.title}\n\n${n.body}\n\nOpen the day planner: ${url}`,
        html: emailHtml('Day planner', n.title, n.body, url).replace('Open Civilion Home', 'Open day planner').replace('You can turn off these emails in the app under Notifications.', 'Staff reminder from the day planner.'),
      });
      result.email++;
    } catch (e: any) { result.emailFailed++; result.notes.push('email: ' + (e?.message || e)); }
    mailer.close();
  }
  return json({ ok: true, ...result });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }
  if (isId(body?.staff_id)) return sendStaffAlert(body.staff_id);
  const id = body?.id;
  if (!isId(id)) return json({ ok: false, error: 'bad id' }, 400);

  const sb = serverClient();

  // Claim the notification so it is only ever sent once
  const { data: n, error: claimErr } = await sb.from('notifications')
    .update({ sent_at: new Date().toISOString() })
    .eq('id', id).is('sent_at', null)
    .select('id, project_id, kind, title, body, link, projects(name)')
    .maybeSingle();
  if (claimErr) return json({ ok: false, error: claimErr.message }, 500);
  if (!n) return json({ ok: true, skipped: 'already sent or not found' });

  const project = (n as any).projects?.name || 'Your home';
  const url = APP_URL + (n.link || '/');
  const result = { push: 0, pushFailed: 0, email: 0, emailFailed: 0, notes: [] as string[] };

  // ---------- phone push
  const { data: ids } = await sb.rpc('project_client_user_ids', { p_project: n.project_id });
  const userIds = (ids || []).map((r: any) => (typeof r === 'string' ? r : r.project_client_user_ids));
  await pushTo(sb, userIds, JSON.stringify({ title: n.title, body: n.body, url, tag: n.kind + '-' + n.project_id }), result);

  // ---------- email
  const smtpPass = Deno.env.get('SMTP_PASS');
  if (EMAIL_KINDS.has(n.kind) && smtpPass) {
    const { data: rows } = await sb.from('project_clients')
      .select('email').eq('project_id', n.project_id).eq('email_notifications', true).neq('email', '');
    const emails = [...new Set((rows || []).map((r: any) => String(r.email).toLowerCase()).filter((e) => e.includes('@')))];
    if (emails.length) {
      const mailer = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: SMTP_USER, pass: smtpPass } });
      for (const to of emails) {
        try {
          await mailer.sendMail({
            from: `${FROM_NAME} <${SMTP_USER}>`, to, subject: `${n.title} · ${project}`,
            text: `${n.title}\n\n${n.body}\n\nOpen Civilion Home: ${url}`,
            html: emailHtml(project, n.title, n.body, url),
          });
          result.email++;
        } catch (e: any) { result.emailFailed++; result.notes.push('email: ' + (e?.message || e)); }
      }
      mailer.close();
    }
  } else if (EMAIL_KINDS.has(n.kind)) result.notes.push('SMTP_PASS not set');

  return json({ ok: true, ...result });
});
