import { useCallback, useRef, useState } from 'react';
import {
  DEFAULT_IMAGE_RENDER_PRESET,
  type ContentDetailT,
  type FrameFormatT,
  type ImageDisplayModeT,
  type ImageRenderPreset,
} from 'shared';
import { useAudioFormState } from './useAudioFormState';
import { useCropState } from './useCropState';
import { useImageFormSubmit } from './useImageFormSubmit';

export function useImageContentForm(content?: ContentDetailT) {
  const isEdit = !!content;
  const previewRef = useRef<HTMLCanvasElement>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const audio = useAudioFormState(content);
  const [renderPreset, setRenderPreset] = useState<ImageRenderPreset>(
    content?.render_preset ?? DEFAULT_IMAGE_RENDER_PRESET
  );
  const [previewFormat, setPreviewFormat] = useState<FrameFormatT>(
    content?.display_mode === 'gray16' ? 'gray4' : 'mono1'
  );
  const [displayMode, setDisplayModeState] = useState<ImageDisplayModeT>(
    content?.display_mode ?? 'mono1'
  );
  const [frameName, setFrameName] = useState(content?.frame_name ?? '');
  const { scale, setScale, offset, setOffset, resetCrop } = useCropState();
  const frameNameChanged = isEdit && frameName !== (content.frame_name ?? '');
  const displayModeChanged = isEdit && displayMode !== content.display_mode;
  const renderPresetChanged = isEdit && renderPreset !== content.render_preset;
  const trimmedTtsText = audio.ttsText.trim();
  const existingTtsText = content?.audio_text?.trim() ?? '';
  const hasExistingTts = isEdit && content?.audio_source === 'tts';
  const wantsTts =
    audio.audioMode === 'tts' &&
    trimmedTtsText.length > 0 &&
    (!hasExistingTts ||
      content?.audio_status === 'failed' ||
      trimmedTtsText !== existingTtsText ||
      audio.ttsVoice !== content?.audio_voice);
  const hasFilePatch = !!imageFile || !!audio.audioFile;
  const hasContentPatch =
    hasFilePatch || frameNameChanged || displayModeChanged || renderPresetChanged;
  const canCreate = !!imageFile && (audio.audioMode !== 'tts' || trimmedTtsText.length > 0);
  const canApplyPreset = !renderPresetChanged || !!imageFile || !!content?.source_available;
  const canEdit =
    (hasContentPatch || wantsTts) &&
    canApplyPreset &&
    (audio.audioMode !== 'tts' || trimmedTtsText.length > 0);

  const onImagePick = useCallback(
    (file: File | null) => {
      setImageFile(file);
      resetCrop();
    },
    [resetCrop]
  );

  const setDisplayMode = useCallback((value: ImageDisplayModeT) => {
    setDisplayModeState(value);
    setPreviewFormat(value === 'gray16' ? 'gray4' : 'mono1');
  }, []);

  const reset = useCallback(() => {
    setImageFile(null);
    audio.resetAudio();
    setRenderPreset(DEFAULT_IMAGE_RENDER_PRESET);
    setPreviewFormat('mono1');
    setDisplayModeState('mono1');
    setFrameName('');
    resetCrop();
  }, [audio, resetCrop]);

  const buildFormData = useImageFormSubmit({
    imageFile,
    audioFile: audio.audioFile,
    frameName,
    renderPreset,
    scale,
    offset,
    displayMode,
  });

  return {
    image: {
      previewRef,
      file: imageFile,
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
    render: {
      preset: renderPreset,
      setPreset: setRenderPreset,
      changed: renderPresetChanged,
      canApply: canApplyPreset,
      sourceAvailable: !!content?.source_available,
    },
    preview: {
      format: previewFormat,
      setFormat: setPreviewFormat,
    },
    display: {
      mode: displayMode,
      setMode: setDisplayMode,
      changed: displayModeChanged,
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
    hasFilePatch,
    canCreate,
    canEdit,
    reset,
    buildFormData,
  };
}
