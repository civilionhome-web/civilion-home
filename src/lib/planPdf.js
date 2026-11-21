// Builds an A4 PDF of the day plan with no extra libraries: the plan is drawn on
// canvases (so Malayalam and ₹ come out right with the phone's own fonts), each page
// is turned into a JPEG, and the JPEGs are wrapped in a minimal PDF file.
import { longDate } from './format';
import { planWorkers } from './dayplan';

const W = 1240;            // A4 at 150 dpi
const H = 1754;
const M = 80;              // page margin
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans Malayalam", "Noto Sans", sans-serif';
const MAROON = '#8a1c22';
const INK = '#1f1a17';
const MUTED = '#7a716a';
const LINE = '#e6dfd8';

function wrap(ctx, text, maxW) {
  const out = [];
  for (const para of String(text ?? '').split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width <= maxW) { line = test; continue; }
      if (line) out.push(line);
      if (ctx.measureText(word).width <= maxW) { line = word; continue; }
      let part = '';                       // a single very long word: break it
      for (const ch of word) {
        if (ctx.measureText(part + ch).width > maxW) { out.push(part); part = ch; } else part += ch;
      }
      line = part;
    }
    out.push(line);
  }
  return out.length ? out : [''];
}

class Doc {
  constructor(footer) { this.pages = []; this.footer = footer; this.add(); }
  add() {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
    x.textBaseline = 'top';
    this.pages.push(c); this.x = x; this.y = M;
  }
  ensure(h) { if (this.y + h > H - M - 30) this.add(); }
  font(size, weight = 400, color = INK) { this.x.font = `${weight} ${size}px ${FONT}`; this.x.fillStyle = color; }
  text(str, { size = 22, weight = 400, color = INK, x = M, maxW = W - 2 * M, gap = 6 } = {}) {
    this.font(size, weight, color);
    const lh = Math.round(size * 1.3);
    for (const line of wrap(this.x, str, maxW)) {
      this.ensure(lh);
      this.font(size, weight, color);
      this.x.fillText(line, x, this.y);
      this.y += lh;
    }
    this.y += gap;
  }
  rule(color = LINE, h = 2) { this.ensure(h + 10); this.x.fillStyle = color; this.x.fillRect(M, this.y, W - 2 * M, h); this.y += h + 12; }
  // simple table; cols = [{ label, w (fraction), align }]
  table(cols, rows, { boldLast = false } = {}) {
    const total = W - 2 * M;
    const xs = []; let acc = M;
    cols.forEach((c) => { xs.push(acc); acc += c.w * total; });
    const pad = 8; const size = 21; const lh = Math.round(size * 1.3);
    const head = () => {
      this.ensure(lh + 14);
      this.font(16, 700, MUTED);
      cols.forEach((c, i) => {
        const tx = c.align === 'right' ? xs[i] + c.w * total - pad : xs[i] + pad;
        this.x.textAlign = c.align === 'right' ? 'right' : 'left';
        this.x.fillText(c.label.toUpperCase(), tx, this.y);
      });
      this.x.textAlign = 'left';
      this.y += 26;
      this.x.fillStyle = LINE; this.x.fillRect(M, this.y, total, 2); this.y += 8;
    };
    head();
    rows.forEach((r, ri) => {
      const bold = boldLast && ri === rows.length - 1;
      this.font(size, bold ? 700 : 400);
      const cells = r.map((v, i) => wrap(this.x, v, cols[i].w * total - 2 * pad));
      const h = Math.max(...cells.map((l) => l.length)) * lh + 10;
      if (this.y + h > H - M - 30) { this.add(); head(); }
      this.font(size, bold ? 700 : 400);
      cells.forEach((lines, i) => {
        const right = cols[i].align === 'right';
        this.x.textAlign = right ? 'right' : 'left';
        lines.forEach((l, li) => this.x.fillText(l, right ? xs[i] + cols[i].w * total - pad : xs[i] + pad, this.y + 4 + li * lh));
      });
      this.x.textAlign = 'left';
      this.y += h;
      this.x.fillStyle = '#f1ece7'; this.x.fillRect(M, this.y - 2, total, 1);
    });
    this.y += 10;
  }
  finish() {
    this.pages.forEach((c, i) => {
      const x = c.getContext('2d');
      x.font = `400 16px ${FONT}`; x.fillStyle = MUTED; x.textBaseline = 'top';
      x.fillText(this.footer, M, H - M + 10);
      x.textAlign = 'right'; x.fillText(`Page ${i + 1} of ${this.pages.length}`, W - M, H - M + 10); x.textAlign = 'left';
    });
    return this.pages;
  }
}

function drawPlan({ date, projects, plans, names, summary, siteName, logo, offSites = [], approvedText = '', changeLines = [] }) {
  const doc = new Doc(`Civilion Builders and Developers · Day plan · ${longDate(date)}`);
  // header
  if (logo) { try { doc.x.drawImage(logo, W - M - 150, M - 10, 150, 150 * logo.height / logo.width); } catch { /* ignore */ } }
  doc.text('Civilion Builders and Developers', { size: 20, weight: 700, color: MAROON, gap: 4, maxW: W - 2 * M - 170 });
  doc.text('Day plan', { size: 44, weight: 800, gap: 2 });
  doc.text(longDate(date), { size: 26, weight: 600, color: MUTED, gap: approvedText ? 4 : 14 });
  if (approvedText) doc.text(approvedText, { size: 19, weight: 600, color: '#1f7a3a', gap: 12 });
  const planned = projects.filter((p) => plans.some((x) => x.project_id === p.id));
  const missing = projects.filter((p) => !plans.some((x) => x.project_id === p.id));
  doc.text(`${planned.length} of ${projects.length} sites planned  ·  ${summary.workers} workers  ·  ${summary.teams.length} teams`, { size: 22, weight: 600, gap: 6 });
  if (missing.length) doc.text(`No plan: ${missing.map((p) => p.name).join(', ')}`, { size: 20, color: '#9b1c1c', gap: 6 });
  if (offSites.length) doc.text(`Sites off: ${offSites.map((o) => `${o.name} (${o.reason})`).join(', ')}`, { size: 20, color: MUTED, gap: 6 });
  if (summary.clashes.length) {
    doc.text('Booked at more than one site: ' + summary.clashes.map((c) => `${c.name} (${c.sites.join(', ')})`).join('; '), { size: 20, color: '#8a5a00', gap: 6 });
  }
  doc.y += 6; doc.rule(MAROON, 3);

  // one block per site
  for (const p of planned) {
    for (const plan of plans.filter((x) => x.project_id === p.id)) {
      doc.ensure(160);
      doc.text(p.name + (p.location ? `  ·  ${p.location}` : ''), { size: 28, weight: 800, gap: 2 });
      const status = { submitted: 'Waiting for review', approved: 'Approved', changes: 'Changes asked' }[plan.status] || '';
      doc.text([names[plan.created_by] && `By ${names[plan.created_by]}`, plan.supervisor && `In-charge: ${plan.supervisor}`,
        plan.start_time && `Starts ${plan.start_time}`, status].filter(Boolean).join('  ·  '), { size: 19, color: MUTED, gap: 8 });
      const tasks = (plan.tasks || []).filter((t) => t.work || t.team);
      if (tasks.length) {
        doc.table(
          [{ label: 'Work', w: 0.56 }, { label: 'Team', w: 0.3 }, { label: 'Workers', w: 0.14, align: 'right' }],
          [...tasks.map((t) => [t.work || '', t.team || '', t.workers ? String(t.workers) : '']), ['Total workers', '', String(planWorkers(plan))]],
          { boldLast: true },
        );
      }
      if (plan.materials) doc.text(`Materials: ${plan.materials}`, { size: 20, gap: 4 });
      if (plan.equipment) doc.text(`Machinery / tools: ${plan.equipment}`, { size: 20, gap: 4 });
      if (plan.remarks) doc.text(`Remarks: ${plan.remarks}`, { size: 20, gap: 4 });
      if (plan.admin_note) doc.text(`Admin note: ${plan.admin_note}`, { size: 20, weight: 600, color: MAROON, gap: 4 });
      doc.y += 8; doc.rule();
    }
  }

  // labour across sites
  if (summary.teams.length) {
    doc.ensure(140);
    doc.text('Labour across sites', { size: 26, weight: 800, gap: 8 });
    doc.table(
      [{ label: 'Team', w: 0.34 }, { label: 'Sites', w: 0.52 }, { label: 'Workers', w: 0.14, align: 'right' }],
      [...summary.teams.map((t) => [t.name + (t.sites.length > 1 ? '  (!)' : ''), t.sites.join(', '), t.workers ? String(t.workers) : '']),
        ['All sites', '', String(summary.workers)]],
      { boldLast: true },
    );
  }
  if (changeLines.length) {
    doc.ensure(120);
    doc.text('Changes during the day', { size: 26, weight: 800, gap: 8 });
    changeLines.forEach((l) => doc.text('\u2022 ' + l, { size: 20, gap: 4 }));
    doc.y += 8;
  }
  const mats = plans.filter((x) => x.materials);
  if (mats.length || summary.equipment.length) {
    doc.ensure(120);
    doc.text('Materials & machinery to arrange', { size: 26, weight: 800, gap: 8 });
    mats.forEach((x) => doc.text(`${siteName(x.project_id)}: ${x.materials}`, { size: 20, gap: 4 }));
    if (summary.equipment.length) {
      doc.text('Machinery: ' + summary.equipment.map((e) => e.name + (e.sites.length > 1 ? ` (${e.sites.length} sites!)` : '')).join(', '), { size: 20, gap: 4 });
    }
  }
  return doc.finish();
}

// ---------------------------------------------------------------- minimal PDF writer
function jpegBytes(canvas) {
  const b64 = canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function buildPdf(canvases) {
  const enc = new TextEncoder();
  const parts = []; const offsets = []; let size = 0;
  const push = (chunk) => { const b = typeof chunk === 'string' ? enc.encode(chunk) : chunk; parts.push(b); size += b.length; };
  const obj = (n, body) => { offsets[n] = size; push(`${n} 0 obj\n`); body(); push('\nendobj\n'); };
  const n = canvases.length;
  const kids = canvases.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  push('%PDF-1.4\n%âãÏÓ\n');
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Kids [${kids}] /Count ${n} >>`));
  canvases.forEach((c, i) => {
    const pageN = 3 + i * 3; const imgN = pageN + 1; const cntN = pageN + 2;
    const jpg = jpegBytes(c);
    const content = 'q 595.28 0 0 841.89 0 0 cm /Im0 Do Q';
    obj(pageN, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 ${imgN} 0 R >> >> /Contents ${cntN} 0 R >>`));
    obj(imgN, () => { push(`<< /Type /XObject /Subtype /Image /Width ${c.width} /Height ${c.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`); push(jpg); push('\nendstream'); });
    obj(cntN, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
  });
  const total = 3 + n * 3;
  const xref = size;
  let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  push(x);
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}

// Load the logo as soon as the planner opens, so sharing can start straight from the tap
// (phones only allow the share menu right after a tap).
let logoImg = null;
if (typeof Image !== 'undefined') {
  const img = new Image();
  img.onload = () => { logoImg = img; };
  img.src = `${import.meta.env.BASE_URL}logo.png`;
}

// Make the PDF, then share it (phones: Print / WhatsApp / Save) or download it (computers).
export async function shareDayPlanPdf(data) {
  const blob = buildPdf(drawPlan({ ...data, logo: logoImg }));
  const name = `Civilion day plan ${data.date}.pdf`;
  const file = new File([blob], name, { type: 'application/pdf' });
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform));
  if (mobile && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: `Day plan ${longDate(data.date)}` }); return 'shared'; }
    catch (e) { if (e?.name === 'AbortError') return 'cancelled'; /* fall through to download */ }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return 'downloaded';
}

export const _test = { buildPdf, drawPlan };
