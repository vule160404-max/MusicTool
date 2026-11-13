/**
 * SpotFlow MP3 - API Client & Backend Connection Manager
 * Supports running in unified Full-Stack mode, or Vercel Frontend + Render/Railway/Cloud Run Backend.
 */

const STORAGE_KEY = 'spotflow_custom_backend_url';

export function getBackendBaseUrl(): string {
  // 1. Check custom user configured URL in localStorage
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && saved.trim()) {
      return saved.trim().replace(/\/+$/, '');
    }
  }

  // 2. Check environment variable VITE_API_URL
  const envUrl = (import.meta as unknown as { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL;
  if (envUrl && envUrl.trim()) {
    return envUrl.trim().replace(/\/+$/, '');
  }

  // 3. Default to relative path (current origin)
  return '';
}

export function setBackendBaseUrl(url: string | null): void {
  if (typeof window === 'undefined') return;
  if (!url || !url.trim()) {
    localStorage.removeItem(STORAGE_KEY);
  } else {
    localStorage.setItem(STORAGE_KEY, url.trim().replace(/\/+$/, ''));
  }
}

export async function apiFetch(endpoint: string, init?: RequestInit): Promise<Response> {
  const base = getBackendBaseUrl();
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const url = base ? `${base}${cleanEndpoint}` : cleanEndpoint;

  try {
    const response = await fetch(url, init);
    const contentType = response.headers.get('content-type') || '';

    // If the server returned HTML instead of JSON for an API call, it means
    // Vercel or a static host served index.html as a 404/SPA fallback because the backend is missing.
    if (
      cleanEndpoint.startsWith('/api/') &&
      contentType.includes('text/html') &&
      !cleanEndpoint.includes('/api/download/file')
    ) {
      throw new Error(
        'Backend chưa được kết nối! Máy chủ đang trả về trang HTML tĩnh (Vercel SPA fallback) thay vì API Backend Node.js.'
      );
    }

    return response;
  } catch (err) {
    if (err instanceof Error) {
      throw err;
    }
    throw new Error('Không thể kết nối máy chủ.');
  }
}

export async function checkBackendStatus(): Promise<{ ok: boolean; ffmpeg?: boolean; error?: string }> {
  try {
    const res = await apiFetch('/api/health');
    if (!res.ok) {
      return { ok: false, error: `Máy chủ phản hồi mã lỗi ${res.status}` };
    }
    const data = (await res.json()) as { ok?: boolean; ffmpeg?: boolean };
    return { ok: Boolean(data.ok), ffmpeg: Boolean(data.ffmpeg) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Không thể kết nối máy chủ.',
    };
  }
}
