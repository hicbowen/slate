import { useCallback, useEffect, useRef, useState } from 'react';

interface CanvasOffset {
  x: number;
  y: number;
}

export function useCanvasPan({
  enabled,
  offset,
  currentOffsetRef,
  onOffsetChange,
  onPreviewMove,
  onCommit,
  normalizeOffset,
}: {
  enabled: boolean;
  offset: CanvasOffset;
  currentOffsetRef: React.MutableRefObject<CanvasOffset>;
  onOffsetChange: (o: CanvasOffset) => void;
  onPreviewMove: () => void;
  onCommit: () => void;
  normalizeOffset: (offset: CanvasOffset) => CanvasOffset;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{
    x: number;
    y: number;
    offsetX: number;
    offsetY: number;
    ratioX: number;
    ratioY: number;
    id: number;
  } | null>(null);

  useEffect(() => {
    if (!isDraggingRef.current) currentOffsetRef.current = offset;
  }, [currentOffsetRef, offset]);

  useEffect(() => {
    if (enabled) return;
    isDraggingRef.current = false;
    setIsDragging(false);
    dragStartRef.current = null;
    currentOffsetRef.current = offset;
  }, [currentOffsetRef, enabled, offset]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!enabled || !event.isPrimary || event.button !== 0) return;
      const canvas = event.currentTarget;
      const bounds = canvas.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      isDraggingRef.current = true;
      setIsDragging(true);
      const startOffset = normalizeOffset(offset);
      currentOffsetRef.current = startOffset;
      dragStartRef.current = {
        x: event.clientX,
        y: event.clientY,
        offsetX: startOffset.x,
        offsetY: startOffset.y,
        ratioX: canvas.width / bounds.width,
        ratioY: canvas.height / bounds.height,
        id: event.pointerId,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [currentOffsetRef, enabled, normalizeOffset, offset]
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const start = dragStartRef.current;
      if (!isDraggingRef.current || !start || start.id !== event.pointerId) return;
      currentOffsetRef.current = normalizeOffset({
        x: start.offsetX + (event.clientX - start.x) * start.ratioX,
        y: start.offsetY + (event.clientY - start.y) * start.ratioY,
      });
      onPreviewMove();
    },
    [currentOffsetRef, normalizeOffset, onPreviewMove]
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent) => {
      if (!isDraggingRef.current || dragStartRef.current?.id !== event.pointerId) return;
      isDraggingRef.current = false;
      setIsDragging(false);
      dragStartRef.current = null;
      onOffsetChange(currentOffsetRef.current);
      onCommit();
    },
    [currentOffsetRef, onCommit, onOffsetChange]
  );

  return {
    isDragging,
    isDraggingRef,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };
}
