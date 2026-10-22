import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { X } from 'lucide-react';

/**
 * Full-screen camera QR scanner. Html5Qrcode is configured with
 * useBarCodeDetectorIfSupported: true, which makes it use the browser's
 * native BarcodeDetector API when available and transparently fall back
 * to its own (zxing-based) decoder otherwise — satisfying "BarcodeDetector
 * API with html5-qrcode fallback" without hand-rolling both paths.
 */
export default function QrScanner({ onScan, onClose }: { onScan: (text: string) => void; onClose: () => void }) {
  const elementId = 'staff-qr-scanner-region';
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const scanner = new Html5Qrcode(elementId, { verbose: false, useBarCodeDetectorIfSupported: true } as any);
    scannerRef.current = scanner;

    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: 250 },
        (decodedText) => {
          onScan(decodedText);
        },
        () => { /* per-frame "no QR found" — expected constantly while aiming, not an error */ },
      )
      .catch((err) => {
        const message = String(err || '');
        if (message.toLowerCase().includes('permission') || message.toLowerCase().includes('notallowed')) {
          setError('Camera access was denied. Allow camera access in your browser settings to scan a QR code.');
        } else if (message.toLowerCase().includes('notfound')) {
          setError('No camera was found on this device.');
        } else {
          setError('Could not start the camera. You can also open the QR code with your phone\'s own camera app.');
        }
      });

    return () => {
      if (scannerRef.current?.isScanning) {
        scannerRef.current.stop().then(() => scannerRef.current?.clear()).catch(() => {});
      }
    };
  }, [onScan]);

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">
      <div className="flex items-center justify-between p-4 text-white">
        <p className="font-medium">Scan the site's QR code</p>
        <button type="button" onClick={onClose} className="p-2" aria-label="Close scanner" style={{ minWidth: 44, minHeight: 44 }}>
          <X className="w-6 h-6" />
        </button>
      </div>
      <div className="flex-1 relative">
        <div id={elementId} className="w-full h-full" />
        {error && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <p className="text-white text-center">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
}
