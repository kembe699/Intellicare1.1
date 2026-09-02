// Multipart upload / auth-aware file access for Procurement attachments (PO quotations,
// GRN invoices). authFetch (src/api/apiClient.ts) always forces Content-Type: application/json,
// which breaks multipart/form-data uploads (the browser needs to set its own boundary) — so
// this module has its own minimal auth-aware fetch that leaves Content-Type alone for
// FormData bodies, mirroring authFetch's base-URL resolution and token handling.

const RENDER_BACKEND = 'https://api.nilehc.tech';
const getApiBase = () => {
  const hostname = window.location.hostname;
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
  if (isLocalhost) return '';
  const isPrivateIP = /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(hostname);
  if (isPrivateIP) return `http://${hostname}:3002`;
  return import.meta.env.VITE_API_URL || RENDER_BACKEND;
};

const authHeaders = (): HeadersInit => {
  const token = localStorage.getItem('auth_token');
  const currentBranchId = localStorage.getItem('current_branch_id');
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(currentBranchId ? { 'X-Branch-ID': currentBranchId } : {}),
  };
};

export type AttachmentEntityType = 'purchase-order' | 'goods-receipt-note';

export interface ProcurementAttachment {
  id: string;
  entity_type: AttachmentEntityType;
  entity_id: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  uploaded_by_name?: string;
  created_at: string;
}

export const uploadProcurementAttachments = async (
  entityType: AttachmentEntityType, entityId: string | number, files: File[]
): Promise<ProcurementAttachment[]> => {
  if (files.length === 0) return [];
  const form = new FormData();
  files.forEach(f => form.append('files', f));
  const res = await fetch(`${getApiBase()}/api/procurement/attachments/${entityType}/${entityId}`, {
    method: 'POST', headers: authHeaders(), body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || 'Failed to upload attachments');
  }
  return res.json();
};

export const fetchProcurementAttachments = async (
  entityType: AttachmentEntityType, entityId: string | number
): Promise<ProcurementAttachment[]> => {
  const res = await fetch(`${getApiBase()}/api/procurement/attachments/${entityType}/${entityId}`, {
    headers: authHeaders(),
  });
  if (!res.ok) return [];
  return res.json();
};

// Fetches the file as a blob (auth header required) and returns a local object URL for
// in-page preview (e.g. an <img>/<iframe> inside a modal). Caller owns the URL and must
// revoke it (URL.revokeObjectURL) once the preview is closed.
export const fetchProcurementAttachmentBlobUrl = async (attachment: ProcurementAttachment): Promise<string> => {
  const res = await fetch(`${getApiBase()}/api/procurement/attachments/${attachment.id}/file`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to load attachment');
  const blob = await res.blob();
  return URL.createObjectURL(blob);
};
