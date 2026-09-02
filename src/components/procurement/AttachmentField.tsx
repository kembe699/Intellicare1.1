import React, { useRef, useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Paperclip, FileText, Image as ImageIcon, X, Eye } from 'lucide-react';

const ACCEPTED = 'application/pdf,image/jpeg,image/png,image/gif,image/webp';

const fileIcon = (file: File) => file.type === 'application/pdf'
  ? <FileText className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
  : <ImageIcon className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />;

const fmtSize = (bytes: number) => bytes < 1024 * 1024
  ? `${(bytes / 1024).toFixed(0)} KB`
  : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

interface AttachmentFieldProps {
  files: File[];
  onChange: (files: File[]) => void;
  label?: string;
}

// Optional multi-file picker for quotations/invoices (PDF or image). Purely local state
// until the parent submits — the files aren't uploaded until the PO/GRN they belong to
// exists, so selecting files here never blocks or is required for submission.
export const AttachmentField: React.FC<AttachmentFieldProps> = ({ files, onChange, label = 'Attachments (optional)' }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);

  // Local object URLs so images can show a real thumbnail and any file (PDF included)
  // can be opened in a new tab before it's ever uploaded.
  useEffect(() => {
    const urls = files.map(f => URL.createObjectURL(f));
    setPreviewUrls(urls);
    return () => { urls.forEach(u => URL.revokeObjectURL(u)); };
  }, [files]);

  const addFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    onChange([...files, ...Array.from(list)]);
    if (inputRef.current) inputRef.current.value = '';
  };

  const removeFile = (idx: number) => onChange(files.filter((_, i) => i !== idx));

  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED}
        className="hidden"
        onChange={(e) => addFiles(e.target.files)}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-9 text-xs gap-1.5 w-full justify-start"
        onClick={() => inputRef.current?.click()}
      >
        <Paperclip className="w-3.5 h-3.5" /> Attach quotation / invoice (PDF or image)
      </Button>
      {files.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {files.map((file, idx) => {
            const url = previewUrls[idx];
            const isImage = file.type.startsWith('image/');
            return (
              <li key={`${file.name}-${idx}`} className="flex items-center gap-2 text-xs bg-muted/40 rounded px-2 py-1.5">
                {isImage && url ? (
                  <img src={url} alt={file.name} className="w-8 h-8 rounded object-cover flex-shrink-0 border" />
                ) : (
                  <div className="w-8 h-8 rounded bg-background border flex items-center justify-center flex-shrink-0">
                    {fileIcon(file)}
                  </div>
                )}
                <span className="flex-1 truncate">{file.name}</span>
                <span className="text-muted-foreground flex-shrink-0">{fmtSize(file.size)}</span>
                {url && (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-primary flex-shrink-0"
                    aria-label={`Preview ${file.name}`}
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => removeFile(idx)}
                  className="text-muted-foreground hover:text-destructive flex-shrink-0"
                  aria-label={`Remove ${file.name}`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
