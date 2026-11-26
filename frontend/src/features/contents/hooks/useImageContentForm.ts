import { useCallback, useMemo, useRef, useState } from 'react';
import { DisplayModeGray, DisplayModeMono, type Content } from '@/api';
import { DEFAULT_IMAGE_RENDER_PRESET, type ImageRenderPreset } from '@/lib/eink/render-preset';
import type { MonochromeMode } from '@/lib/eink/image-preview';
import { useAudioFormState } from './useAudioFormState';
import { useCropState } from './useCropState';
import { useImageFormSubmit } from './useImageFormSubmit';
import { useBlob } from '@/features/contents/query/content-image-queries';

/** Default threshold for the threshold dither mode. */
const BW_THRESHOLD_DEFAULT = 128;

export function useImageContentForm(content?: Content) {
  const isEdit = !!content;
  const initialDisplayMode = content?.displayMode ?? DisplayModeMono;
  const [displayMode, setDisplayMode] = useState(initialDisplayMode);
  const displayModeChanged = displayMode !== initialDisplayMode;
  const hasSavedGray = !!content?.grayImageHash;
  const previewRef = useRef<HTMLCanvasElement>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const source = useBlob(content?.imageSourceHash);
  const sourceFile = useMemo(
    () => (source.data ? new File([source.data], 'source.png', { type: 'image/png' }) : null),
    [source.data]
  );
  const audio = useAudioFormState(content);
  const [threshold, setThreshold] = useState(BW_THRESHOLD_DEFAULT);
  const initialPreset = content?.imageRenderPreset ?? DEFAULT_IMAGE_RENDER_PRESET;
  const [renderPreset, setImageRenderPreset] = useState<ImageRenderPreset>(initialPreset);
  const [mode, setMode] = useState<MonochromeMode>('preset');
  const [frameName, setFrameName] = useState(content?.frameName ?? '');
  const { scale, setScale, offset, setOffset, resetCrop } = useCropState();
  const renderChanged =
    renderPreset !== initialPreset ||
    mode !== 'preset' ||
    threshold !== BW_THRESHOLD_DEFAULT ||
    scale !== 1 ||
    offset.x !== 0 ||
    offset.y !== 0;
  const needsGray = displayModeChanged && displayMode === DisplayModeGray && !hasSavedGray;
  const renderFile = imageFile ?? (renderChanged || needsGray ? sourceFile : null);
  const frameNameChanged = isEdit && frameName !== (content.frameName ?? '');
  const trimmedTtsText = audio.ttsText.trim();
  const existingTtsText = content?.audio?.text?.trim() ?? '';
  const hasExistingTts = isEdit && content?.audio?.source === 'tts';
  const wantsTts =
    audio.audioMode === 'tts' &&
    trimmedTtsText.length > 0 &&
    (!hasExistingTts ||
      content?.audio?.status === 'failed' ||
      trimmedTtsText !== existingTtsText ||
      audio.ttsVoice !== content?.audio?.voice);
  const hasUploadPatch = !!renderFile || !!audio.audioFile || displayModeChanged;
  const hasContentPatch = hasUploadPatch || frameNameChanged;
  const canCreate = !!imageFile && (audio.audioMode !== 'tts' || trimmedTtsText.length > 0);
  const canEdit =
    (hasContentPatch || wantsTts) && (audio.audioMode !== 'tts' || trimmedTtsText.length > 0);

  const onImagePick = useCallback(
    (file: File | null) => {
      setImageFile(file);
      if (!file && !hasSavedGray) setDisplayMode(DisplayModeMono);
      resetCrop();
    },
    [hasSavedGray, resetCrop]
  );

  const reset = useCallback(() => {
    setImageFile(null);
    audio.resetAudio();
    setThreshold(BW_THRESHOLD_DEFAULT);
    setMode('preset');
    setImageRenderPreset(initialPreset);
    setDisplayMode(initialDisplayMode);
    setFrameName('');
    resetCrop();
  }, [audio, initialDisplayMode, initialPreset, resetCrop]);

  const buildFormData = useImageFormSubmit({
    imageFile: renderFile,
    audioFile: audio.audioFile,
    displayMode: displayModeChanged ? displayMode : undefined,
    frameName,
    threshold,
    renderPreset,
    mode,
    scale,
    offset,
  });

  return {
    image: {
      previewRef,
      file: imageFile,
      renderFile,
      sourceFile,
      sourceError: source.isError,
      setFile: setImageFile,
      onPick: onImagePick,
    },
    audio: {
      file: audio.audioFile,
      setFile: audio.setAudioFile,
      mode: audio.audioMode,
      setMode: audio.setAudioMode,
      ttsText: audio.ttsText,
      setTtsText: audio.setTtsText,
      ttsVoice: audio.ttsVoice,
      setTtsVoice: audio.setTtsVoice,
      trimmedTtsText,
      wantsTts,
    },
    dither: {
      threshold,
      setThreshold,
      mode,
      setMode,
      renderPreset,
      setImageRenderPreset,
    },
    crop: {
      scale,
      setScale,
      offset,
      setOffset,
      reset: resetCrop,
    },
    frameName,
    setFrameName,
    frameNameChanged,
    hasContentPatch,
    hasUploadPatch,
    displayMode,
    setDisplayMode,
    canCreate,
    canEdit,
    reset,
    buildFormData,
  };
}
