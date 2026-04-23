const rawApiBaseUrl = (import.meta.env.VITE_API_URL || '').trim();

const normalizedApiBaseUrl = rawApiBaseUrl.replace(/\/+$/, '');

export function apiUrl(path) {
  if (!path) {
    return normalizedApiBaseUrl || '';
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return normalizedApiBaseUrl ? `${normalizedApiBaseUrl}${normalizedPath}` : normalizedPath;
}
