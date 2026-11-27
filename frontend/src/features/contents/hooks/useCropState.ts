import { useCallback, useState } from 'react';
import type { CropOptions } from '@/lib/eink/image-preview';
import type { ImageCrop } from '@/api';

export interface CropOffset {
  x: number;
  y: number;
}

export function useCropState(initial?: ImageCrop) {
  const [scale, setScale] = useState(initial?.scale ?? 1);
  const [offset, setOffset] = useState<CropOffset>({ x: initial?.x ?? 0, y: initial?.y ?? 0 });
  const [fit, setFit] = useState<NonNullable<CropOptions['fit']>>(initial?.fit ?? 'contain');

  const resetCrop = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  return { scale, setScale, offset, setOffset, fit, setFit, resetCrop };
}
