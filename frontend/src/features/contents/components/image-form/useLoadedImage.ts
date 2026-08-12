import { useEffect, useState } from 'react';

export interface LoadedImage {
  source: Blob;
  image: HTMLImageElement;
}

export function useLoadedImage(source: Blob | null): LoadedImage | null {
  const [loadedImage, setLoadedImage] = useState<LoadedImage | null>(null);

  useEffect(() => {
    if (!source) {
      setLoadedImage(null);
      return;
    }

    const url = URL.createObjectURL(source);
    let cancelled = false;
    let revoked = false;
    const revoke = () => {
      if (!revoked) {
        URL.revokeObjectURL(url);
        revoked = true;
      }
    };
    const img = new Image();
    img.onload = () => {
      if (!cancelled) setLoadedImage({ source, image: img });
      revoke();
    };
    img.onerror = () => {
      if (!cancelled) setLoadedImage(null);
      revoke();
    };
    img.src = url;
    return () => {
      cancelled = true;
      revoke();
    };
  }, [source]);

  return loadedImage;
}
