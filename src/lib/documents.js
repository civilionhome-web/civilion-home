import { supabase, BUCKET } from './supabase';

export const DOC_CATEGORIES = [
  'Agreement',
  'Drawings & plans',
  'Approvals & permits',
  'BOQ & estimates',
  'Reports & tests',
  'Warranties & manuals',
  'Other',
];

export function formatSize(bytes) {
  const b = Number(bytes || 0);
  if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  if (b >= 1024) return `${Math.round(b / 1024)} KB`;
  return b ? `${b} B` : '';
}

// Short label for the file badge: PDF, DWG, JPG…
export function fileKind(name = '', mime = '') {
  const ext = (name.split('.').pop() || '').toUpperCase();
  if (ext && ext.length <= 4 && ext !== name.toUpperCase()) return ext;
  if (mime.includes('pdf')) return 'PDF';
  if (mime.startsWith('image/')) return 'IMG';
  return 'FILE';
}

// Uploads the file exactly as it is (no resizing — drawings must stay sharp).
export async function uploadDocument(projectId, file) {
  const safe = file.name.replace(/[^\w.\-]+/g, '_').slice(-80) || 'file';
  const path = `${projectId}/documents/${crypto.randomUUID()}-${safe}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  });
  if (error) throw error;
  return path;
}

// Opens a private document in a new tab. The tab is opened first so phone
// browsers don't block it as a pop-up while the secure link is being made.
export async function openDocument(path, fileName, download = false) {
  const win = window.open('', '_blank');
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 3600, download ? { download: fileName || true } : undefined);
  if (error || !data?.signedUrl) {
    if (win) win.close();
    throw error || new Error('Could not open the file');
  }
  if (win) win.location.href = data.signedUrl;
  else window.location.href = data.signedUrl;
}
