import { useEffect, useRef, useState } from 'react';

interface Detector {
  detect(v: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: new (o: { formats: string[] }) => Detector;
  }
}

export const canScan = (): boolean =>
  typeof window !== 'undefined' &&
  !!window.BarcodeDetector &&
  !!navigator.mediaDevices?.getUserMedia;

/** Camera barcode scanner using the browser's built-in detector. Nothing leaves the device but the number. */
export function BarcodeScanner({
  onCode,
  onClose,
}: {
  onCode: (code: string) => void;
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [msg, setMsg] = useState('Point the camera at a barcode');

  useEffect(() => {
    let stream: MediaStream | undefined;
    let stopped = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const det = new window.BarcodeDetector!({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
        while (!stopped) {
          const found = await det.detect(video.current).catch(() => []);
          if (found[0]?.rawValue) return onCode(found[0].rawValue);
          await new Promise((r) => setTimeout(r, 250));
        }
      } catch {
        setMsg('Camera not available. Type the number instead.');
      }
    })();
    return () => {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onCode]);

  return (
    <div className="grid gap-2">
      <video
        ref={video}
        muted
        playsInline
        className="aspect-video w-full rounded-2xl bg-black object-cover"
        aria-label="Camera preview"
      />
      <p role="status" className="text-sm text-[var(--ink-soft)]">
        {msg}
      </p>
      <button
        type="button"
        onClick={onClose}
        className="min-h-11 justify-self-start text-sm text-[var(--accent-text)]"
      >
        Close camera
      </button>
    </div>
  );
}
