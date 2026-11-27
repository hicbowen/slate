import { useState } from 'react';
import { Images, Plus } from 'lucide-react';
import { DASHBOARD_CUSTOM_STARTER_SAMPLE_DATA } from '@/features/dynamic/model/dashboard-samples';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { TYPE_META, type AllContentType } from '@/features/contents/model/content-type-meta';
import { DynamicCreateForm } from '@/features/dynamic/components/DynamicCreateForm';
import { useDynamicContentForm } from '@/features/dynamic/hooks/useDynamicContentForm';
import { useImageContentForm } from '@/features/contents/hooks/useImageContentForm';
import { useLeaveDraft } from '@/hooks/useLeaveDraft';
import { ContentTypeCardGrid } from './ContentTypePicker';
import { ImageCreateForm } from './ImageCreateForm';

interface ContentCreateEditorProps {
  gid: string;
  initialType?: 'image' | 'dynamic';
  onDone: () => void;
  onEditCreatedImage: (contentId: string) => void;
}

export function ContentCreateEditor({
  gid,
  initialType,
  onDone,
  onEditCreatedImage,
}: ContentCreateEditorProps) {
  const dynamicForm = useDynamicContentForm({ requireDashboardData: true });
  const imageForm = useImageContentForm();
  const [type, setType] = useState<AllContentType | null>(initialType === 'image' ? 'image' : null);
  const leaveAfterSave = useLeaveDraft(imageForm.dirty);

  function selectType(next: AllContentType) {
    setType(next);
    if (next !== 'image' && dynamicForm.type !== next) {
      dynamicForm.loadType(
        next,
        next === 'dashboard' ? { ...DASHBOARD_CUSTOM_STARTER_SAMPLE_DATA } : null
      );
    }
  }

  return (
    <div>
      <PageHeader
        onBack={onDone}
        backLabel="内容组"
        icon={type === 'image' ? <Images size={24} /> : <Plus size={24} />}
        title={
          type === 'image'
            ? '添加图片'
            : type
              ? `添加${TYPE_META[type].label}`
              : initialType === 'dynamic'
                ? '添加动态帧'
                : '新建帧'
        }
        subtitle={
          type === 'image'
            ? '选图后可预览在墨水屏上的效果。'
            : type
              ? TYPE_META[type].description
              : '选择要添加的帧类型。'
        }
        action={
          type && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setType(null)}
              className="px-2 sm:px-4"
            >
              更换类型
            </Button>
          )
        }
      />
      <div className="mt-6">
        {!type ? (
          <ContentTypeCardGrid
            onChange={selectType}
            includeImage={initialType !== 'dynamic' || imageForm.dirty}
          />
        ) : type === 'image' ? (
          <ImageCreateForm
            gid={gid}
            form={imageForm}
            onCancel={onDone}
            onDone={() => leaveAfterSave(onDone)}
            onEditCreatedImage={(id) => leaveAfterSave(() => onEditCreatedImage(id))}
          />
        ) : (
          <DynamicCreateForm
            gid={gid}
            type={type}
            form={dynamicForm}
            header={null}
            onDone={onDone}
          />
        )}
      </div>
    </div>
  );
}
