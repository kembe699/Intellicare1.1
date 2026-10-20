import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { FileText, Image as ImageIcon, Eye, Loader2, Paperclip } from 'lucide-react';
import { toast } from '@/lib/notify';
import {
  fetchProcurementAttachments, fetchProcurementAttachmentBlobUrl,
  type AttachmentEntityType, type ProcurementAttachment,
} from '@/api/procurementAttachments';

const fileIcon = (mime: string) => mime === 'application/pdf'
  ? <FileText className="w-4 h-4 text-red-500 flex-shrink-0" />
  : <ImageIcon className="w-4 h-4 text-blue-500 flex-shrink-0" />;

const fmtSize = (bytes: number) => bytes < 1024 * 1024
  ? `${(bytes / 1024).toFixed(0)} KB`
  : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

interface AttachmentListProps {
  entityType: AttachmentEntityType;
  entityId: string | number;
  emptyText?: string;
}

// Retrieves and displays attachments persisted with a PO/GRN record — used both in the
// creator's own details view and, unchanged, in the approver's view (same read gate as
// the parent record), so approvers can view quotations/invoices during the approval step.
export const AttachmentList: React.FC<AttachmentListProps> = ({ entityType, entityId, emptyText = 'No attachments' }) => {
  const [attachments, setAttachments] = useState<ProcurementAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ attachment: ProcurementAttachment; url: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchProcurementAttachments(entityType, entityId)
      .then(rows => { if (!cancelled) setAttachments(rows); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [entityType, entityId]);

  const handleOpen = async (attachment: ProcurementAttachment) => {
    setOpeningId(attachment.id);
    try {
      const url = await fetchProcurementAttachmentBlobUrl(attachment);
      setPreview({ attachment, url });
    } catch {
      toast.error('Failed to open attachment');
    } finally {
      setOpeningId(null);
    }
  };

  const closePreview = () => {
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(null);
  };

  if (loading) return <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Loading attachments...</p>;

  if (attachments.length === 0) {
    return <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Paperclip className="w-3.5 h-3.5" /> {emptyText}</p>;
  }

  return (
    <>
      <ul className="space-y-1.5">
        {attachments.map(a => (
          <li key={a.id} className="flex items-center gap-2 text-xs border rounded px-2 py-1.5">
            {fileIcon(a.mime_type)}
            <span className="flex-1 truncate">{a.original_filename}</span>
            <span className="text-muted-foreground flex-shrink-0">{fmtSize(a.file_size)}</span>
            <Button
              type="button" size="sm" variant="ghost" className="h-6 px-2 gap-1 flex-shrink-0"
              disabled={openingId === a.id}
              onClick={() => handleOpen(a)}
            >
              {openingId === a.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />}
              View
            </Button>
          </li>
        ))}
      </ul>

      {/* In-page preview modal — opens the image/PDF inline instead of a new tab, with the
          dialog's own X to close (and revoke the local blob URL). */}
      <Dialog open={!!preview} onOpenChange={(open) => { if (!open) closePreview(); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="truncate">{preview?.attachment.original_filename}</DialogTitle>
            <DialogDescription>{preview && fmtSize(preview.attachment.file_size)}</DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-muted/30">
            {preview?.attachment.mime_type === 'application/pdf' ? (
              <iframe src={preview.url} title={preview.attachment.original_filename} className="w-full h-[70vh] border-0" />
            ) : preview ? (
              <img src={preview.url} alt={preview.attachment.original_filename} className="max-w-full max-h-[70vh] object-contain rounded" />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
