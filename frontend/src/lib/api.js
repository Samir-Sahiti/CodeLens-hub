const rawApiBaseUrl = (import.meta.env.VITE_API_URL || '').trim();

const normalizedApiBaseUrl = rawApiBaseUrl.replace(/\/+$/, '');

export function apiUrl(path) {
  if (!path) {
    return normalizedApiBaseUrl || '';
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return normalizedApiBaseUrl ? `${normalizedApiBaseUrl}${normalizedPath}` : normalizedPath;
}

export function prReviewPublishMessage(status, payload = {}) {
  if (status === 401) return payload.error || 'GitHub token expired. Reconnect GitHub, then try publishing again.';
  if (status === 403) return payload.error || 'GitHub rejected the publish. Confirm pull request write access for this repository.';
  if (status === 422) return payload.error || 'GitHub could not place one or more comments. CodeLens logged details and retried once.';
  return payload.error || 'Failed to publish the PR review. Try again in a moment.';
}

export async function publishPrReview({ repoId, reviewId, token }) {
  const res = await fetch(apiUrl(`/api/repos/${repoId}/reviews/${reviewId}/publish`), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(prReviewPublishMessage(res.status, data));
    error.status = res.status;
    error.payload = data;
    throw error;
  }
  return data;
}
