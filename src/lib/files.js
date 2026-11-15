import { useEffect, useState } from 'react';
import { supabase, BUCKET } from './supabase';

// Signed links for private files, cached for ~50 minutes.
const cache = new Map();

export async function signedUrl(path) {
  if (!path) return null;
  const hit = cache.get(path);
  if (hit && hit.exp > Date.now()) return hit.url;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error) return null;
  cache.set(path, { url: data.signedUrl, exp: Date.now() + 50 * 60 * 1000 });
  return data.signedUrl;
}

export function useSignedUrl(path) {
  const [url, setUrl] = useState(() => cache.get(path)?.url || null);
  useEffect(() => {
    let live = true;
    if (!path) { setUrl(null); return; }
    signedUrl(path).then((u) => { if (live) setUrl(u); });
    return () => { live = false; };
  }, [path]);
  return url;
}

export async function openFile(path) {
  const u = await signedUrl(path);
  if (u) window.open(u, '_blank', 'noopener');
}

// Shrinks phone photos to max 1800px JPEG so uploads are quick on site data.
async function shrinkImage(file, max = 1800) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.type === 'image/svg+xml') return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 900 * 1024) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.82));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  } catch {
    return file;
  }
}

// Uploads to <projectId>/<folder>/<random>.<ext>, returns the storage path.
export async function uploadFile(projectId, folder, file) {
  const f = await shrinkImage(file);
  const ext = (f.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  const path = `${projectId}/${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, f, { contentType: f.type || undefined, upsert: false });
  if (error) throw error;
  return path;
}

export async function removeFile(path) {
  if (!path) return;
  await supabase.storage.from(BUCKET).remove([path]);
  cache.delete(path);
}
