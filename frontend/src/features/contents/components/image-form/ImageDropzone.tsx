// Mono Press 图片 dropzone — 虚线框，0 圆角。

import { useDropzone } from 'react-dropzone';
import { ImagePlus } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatBytes } from '@/lib/format';

interface ImageDropzoneProps {
  isEdit: boolean;
  imageFile: File | null;
  onPick: (file: File) => void;
  pending: boolean;
  error: string | null;
}

export function ImageDropzone({ isEdit, imageFile, onPick, pending, error }: ImageDropzoneProps) {
  const [rejection, setRejection] = useState('');
  const dz = useDropzone({
    onDrop: (files, rejected) => {
      setRejection(rejected.length ? '请选择一张受支持的图片，或使用批量导入。' : '');
      if (files[0]) onPick(files[0]);
    },
    multiple: false,
    accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'] },
    maxFiles: 1,
  });

  return (
    <div>
      <div
        {...dz.getRootProps({ role: 'button', 'aria-label': '选择图片' })}
        className={cn(
          'border border-dashed transition-colors px-5 py-6 text-center cursor-pointer',
          dz.isDragActive ? 'border-ink bg-cream' : 'border-ink/50 hover:border-ink hover:bg-cream'
        )}
      >
        <input {...dz.getInputProps()} />
        <ImagePlus
          size={20}
          className={cn(
            'mx-auto mb-2 transition-colors',
            imageFile ? 'text-ink' : 'text-stone-light'
          )}
        />
        {imageFile ? (
          <>
            <p className="font-serif text-[14px] text-ink truncate">{imageFile.name}</p>
            <p className="font-sans text-[11px] text-stone mt-0.5">
              {formatBytes(imageFile.size)} · 点击换图
            </p>
          </>
        ) : isEdit ? (
          <p className="font-sans text-[13px] text-stone">拖一张图替换原图，不传则保留</p>
        ) : (
          <>
            <p className="font-sans text-[13px] text-stone">拖图至此或点击选择</p>
            <p className="font-sans text-[11px] text-stone-light mt-0.5">
              PNG / JPG / WEBP / GIF / BMP
            </p>
          </>
        )}
      </div>
      {pending && (
        <p role="status" className="mt-2 text-[12px] text-stone">
          正在读取图片…
        </p>
      )}
      {(rejection || error) && (
        <p role="alert" className="mt-2 text-[12px] text-clay">
          {rejection || error}
        </p>
      )}
    </div>
  );
}
import { useState } from 'react';
