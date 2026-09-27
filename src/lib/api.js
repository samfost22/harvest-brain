// Thin client for the local API. Errors carry the server's plain-language message.
async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `The server answered ${res.status}. Is \`npm run dev\` running?`);
  return data;
}

export const api = {
  state: () => request('/state'),
  batch: id => request(`/batches/${id}`),
  createBatch: batch => request('/batches', { method: 'POST', body: batch }),
  updateBatch: (id, patch) => request(`/batches/${id}`, { method: 'PATCH', body: patch }),
  saveEntry: entry => request('/entries', { method: 'POST', body: entry }),
  journal: date => request(`/journal?date=${encodeURIComponent(date)}`),
  addJournal: entry => request('/journal', { method: 'POST', body: entry }),
  brain: batchId => request(`/brain?batchId=${batchId ?? ''}`),
  ask: (batchId, message) => request('/brain', { method: 'POST', body: { batchId, message } }),
  decide: decision => request('/decisions', { method: 'POST', body: decision }),
};
