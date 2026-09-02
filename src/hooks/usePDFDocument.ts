import { useState } from 'react';
import { authFetch } from '@/api/apiClient';
import { toast } from 'sonner';

type DocumentType = 'invoice' | 'bill' | 'receipt';

export function usePDFDocument() {
  const [loading, setLoading] = useState(false);

  const downloadPDF = async (type: DocumentType, id: string, filename?: string) => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/documents/${type}/${id}/pdf`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Download failed' }));
        throw new Error(err.error || 'Failed to generate PDF');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || `${type}-${id}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('PDF downloaded');
    } catch (err: any) {
      toast.error(err.message || 'Failed to download PDF');
    } finally {
      setLoading(false);
    }
  };

  const printPDF = async (type: DocumentType, id: string) => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/documents/${type}/${id}/pdf`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Print failed' }));
        throw new Error(err.error || 'Failed to generate PDF');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const printWindow = window.open(url, '_blank');
      if (printWindow) {
        printWindow.addEventListener('load', () => {
          setTimeout(() => {
            printWindow.print();
          }, 500);
        });
      } else {
        // Fallback: open in iframe
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.src = url;
        document.body.appendChild(iframe);
        iframe.addEventListener('load', () => {
          setTimeout(() => {
            iframe.contentWindow?.print();
            setTimeout(() => document.body.removeChild(iframe), 2000);
          }, 500);
        });
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to print PDF');
    } finally {
      setLoading(false);
    }
  };

  return { downloadPDF, printPDF, loading };
}
