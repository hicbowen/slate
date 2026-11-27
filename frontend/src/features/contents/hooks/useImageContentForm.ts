import { useCallback, useMemo, useRef, useState } from 'react';
import { DisplayModeGray, DisplayModeMono, type Content } from '@/api';
import { DEFAULT_IMAGE_RENDER_PRESET, type ImageRenderPreset } from '@/lib/eink/render-preset';
import type { MonochromeMode } from '@/lib/eink/image-preview';
import { useAudioFormState } from './useAudioFormState';
import { useCropState } from './useCropState';
import { useImageFormSubmit } from './useImageFormSubmit';
import { useBlob } from '@/features/contents/query/content-image-queries';
import { canRetainOriginal, decodeImageFile } from '@/features/contents/lib/image-upload';

/** Default threshold for the threshold dither mode. */
const BW_THRESHOLD_DEFAULT = 128;

export function useImageContentForm(content?: Content) {
  const isEdit = !!content;
  const initialDisplayMode = content?.displayMode ?? DisplayModeMono;
  const [displayMode, setDisplayMode] = useState(initialDisplayMode);
  const displayModeChanged = displayMode !== initialDisplayMode;
  const hasSavedGray = !!content?.grayImageHash;
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePending, setImagePending] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const selection = useRef(0);
  const initialOriginal = content?.imageOriginalHash;
  const initialCrop = content?.imageCrop;
  const [keepOriginal, setKeepOriginal] = useState(!!initialOriginal);
  const source = useBlob(imageFile ? null : (initialOriginal ?? content?.imageSourceHash));
  const sourceFile = useMemo(
    () =>
      source.data ? new File([source.data], initialOriginal ? 'original' : 'source.png') : null,
    [initialOriginal, source.data]
  );
  const audio = useAudioFormState(content);
  const initialThreshold = initialCrop?.threshold ?? BW_THRESHOLD_DEFAULT;
  const initialMode = initialCrop?.dither ?? 'preset';
  const [threshold, setThreshold] = useState(initialThreshold);
  const initialPreset = content?.imageRenderPreset ?? DEFAULT_IMAGE_RENDER_PRESET;
  const [renderPreset, setImageRenderPreset] = useState<ImageRenderPreset>(initialPreset);
  const [mode, setMode] = useState<MonochromeMode>(initialMode);
  const [frameName, setFrameName] = useState(content?.frameName ?? '');
  const { scale, setScale, offset, setOffset, fit, setFit, resetCrop } = useCropState(initialCrop);
  const renderChanged =
    renderPreset !== initialPreset ||
    mode !== initialMode ||
    threshold !== initialThreshold ||
    scale !== (initialCrop?.scale ?? 1) ||
    fit !== (initialCrop?.fit ?? 'contain') ||
    offset.x !== (initialCrop?.x ?? 0) ||
    offset.y !== (initialCrop?.y ?? 0);
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
  const removeImageOriginal = !!initialOriginal && !keepOriginal;
  const hasUploadPatch =
    !!renderFile || !!audio.audioFile || displayModeChanged || removeImageOriginal;
  const hasContentPatch = hasUploadPatch || frameNameChanged;
  const canCreate =
    !imagePending && !!imageFile && (audio.audioMode !== 'tts' || trimmedTtsText.length > 0);
  const canEdit =
    !imagePending &&
    (hasContentPatch || wantsTts) &&
    (audio.audioMode !== 'tts' || trimmedTtsText.length > 0);
  const dirty = isEdit
    ? hasContentPatch || wantsTts || imagePending
    : !!imageFile || imagePending || !!frameName.trim() || !!audio.audioFile || !!trimmedTtsText;

  const onImagePick = useCallback(
    async (file: File) => {
      const attempt = ++selection.current;
      setImagePending(true);
      setImageError(null);
      try {
        const bitmap = await decodeImageFile(file);
        bitmap.close();
        if (attempt !== selection.current) return;
        setImageFile(file);
        if (!canRetainOriginal(file)) setKeepOriginal(false);
        resetCrop();
      } catch {
        if (attempt === selection.current) setImageError('图片无法解码，请换一张图片。');
      } finally {
        if (attempt === selection.current) setImagePending(false);
      }
    },
    [resetCrop]
  );

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
    fit,
    keepOriginal,
    reuseImageOriginal: keepOriginal && !imageFile ? initialOriginal : undefined,
    removeImageOriginal,
  });

  return {
    image: {
      file: imageFile,
      renderFile,
      sourceFile,
      sourceError: source.isError,
      pending: imagePending,
      error: imageError,
      onPick: onImagePick,
      keepOriginal,
      setKeepOriginal,
      canRetainOriginal: imageFile ? canRetainOriginal(imageFile) : !!initialOriginal,
      hadOriginal: !!initialOriginal,
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
      fit,
      setFit,
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
    dirty,
    buildFormData,
  };
}
