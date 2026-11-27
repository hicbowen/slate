// 组详情：metadata + 内容网格（拖拽排序 + 试听/编辑/删除）+ 顶部「新增」。
//
// dnd-kit reorder 通过 useDndOrder 复用；本地顺序会在保存失败时回滚。

import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Layers } from 'lucide-react';
import { useGroup, useUpdateGroup } from '@/features/groups/query/group-queries';
import { useGroupContents } from '@/features/contents/query/content-read-queries';
import { useReorderContents } from '@/features/contents/query/content-mutation-queries';
import type { Content, Group } from '@/api';
import { Spinner } from '@/components/ui/Spinner';
import { Select, SelectItem } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { SortableGrid } from '@/components/dnd/SortableGrid';
import { ContentCard } from '@/features/contents/components/cards/ContentCard';
import { PageHeader } from '@/components/layout/PageHeader';
import { RequireRouteParams } from '@/components/layout/RequireRouteParams';
import { InlineRename } from '@/components/ui/InlineRename';
import { useInlineRename } from '@/hooks/useInlineRename';
import { useToast } from '@/components/feedback/toast-context';
import { getApiErrorMessage } from '@/lib/api-errors';
import { formatBytes } from '@/lib/format';
import { useDndOrder } from '@/components/dnd/useDndOrder';
import { appRoutes } from '@/app/routes';

export function GroupDetailPage() {
  const navigate = useNavigate();

  return (
    <RequireRouteParams
      names={['gid'] as const}
      hint="请从总览页进入具体内容组。"
      action={<BackHomeLink />}
    >
      {({ gid }) => <GroupDetailContent key={gid} gid={gid} navigate={navigate} />}
    </RequireRouteParams>
  );
}

function GroupDetailContent({
  gid,
  navigate,
}: {
  gid: string;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const groupQuery = useGroup(gid);
  const rotationUpdate = useUpdateGroup(gid);
  const contents = useGroupContents(gid);
  const reorder = useReorderContents(gid);
  const toast = useToast();

  const group = groupQuery.data;
  const { sensors, currentOrder, orderedItems, onDragEnd } = useDndOrder(
    contents.data,
    getContentId,
    (newOrder) =>
      reorder.mutateAsync({ order: newOrder }).catch((err: unknown) => {
        toast.error('排序保存失败', getApiErrorMessage(err));
        throw err;
      })
  );

  const openCreate = (type: 'image' | 'dynamic') => navigate(appRoutes.newContent(gid, type));
  const openEdit = (content: Content) => {
    if (content.kind === 'dynamic') {
      navigate(appRoutes.editDynamicContent(gid, content.id));
    } else {
      navigate(appRoutes.editImageContent(gid, content.id));
    }
  };
  const goBack = () => {
    navigate(appRoutes.home);
  };

  if (groupQuery.isPending) {
    return (
      <div className="pt-16 text-center">
        <Spinner label="加载中" />
      </div>
    );
  }
  if (groupQuery.isError || !group) {
    return (
      <EmptyState
        title="内容不存在或已被删除"
        action={
          <Link
            to={appRoutes.home}
            className="inline-flex items-center gap-1 text-[13px] text-stone border-b border-stone"
          >
            <ArrowLeft size={13} /> 返回总览
          </Link>
        }
      />
    );
  }

  return (
    <div>
      <GroupHeader group={group} onBack={goBack} />
      <div className="mt-4 flex flex-wrap gap-2">
        <Button iconLeft={<Plus size={16} />} size="sm" onClick={() => openCreate('image')}>
          添加图片
        </Button>
        <Button size="sm" variant="outline" onClick={() => openCreate('dynamic')}>
          添加动态帧
        </Button>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 text-[13px] text-stone">
        <span>插电轮播</span>
        <Select
          aria-label="插电轮播间隔"
          value={String(group.rotationMinutes)}
          disabled={rotationUpdate.isPending}
          className="w-36"
          onValueChange={(value) =>
            rotationUpdate.mutate(
              { rotationMinutes: Number(value) },
              { onError: (err) => toast.error('轮播设置保存失败', getApiErrorMessage(err)) }
            )
          }
        >
          <SelectItem value="0">关闭</SelectItem>
          <SelectItem value="15">每 15 分钟</SelectItem>
          <SelectItem value="30">每 30 分钟</SelectItem>
          <SelectItem value="60">每 60 分钟</SelectItem>
        </Select>
      </div>
      <div className="mt-6 fade-up fade-up-1">
        {contents.isPending ? (
          <Spinner label="加载中" />
        ) : contents.isError ? (
          <EmptyState title="加载失败" hint="请刷新重试。" />
        ) : contents.data && contents.data.length > 0 ? (
          <SortableGrid
            sensors={sensors}
            order={currentOrder}
            items={orderedItems}
            onDragEnd={onDragEnd}
            getKey={(content) => content.id}
            className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
            renderItem={(content) => <ContentCard gid={gid} content={content} onEdit={openEdit} />}
          />
        ) : (
          <EmptyState title="尚无内容" />
        )}
      </div>
    </div>
  );
}

function getContentId(content: Content): string {
  return content.id;
}

function BackHomeLink() {
  return (
    <Link
      to={appRoutes.home}
      className="inline-flex items-center gap-1 text-[13px] text-stone border-b border-stone"
    >
      <ArrowLeft size={13} /> 返回总览
    </Link>
  );
}

// ───── 组标题 + inline 改名 + 新建内容 ───────────────────────────
function GroupHeader({ group, onBack }: { group: Group; onBack: () => void }) {
  const update = useUpdateGroup(group.id);
  const toast = useToast();

  const { editing, draft, setDraft, startEditing, commit, handleKeyDown } = useInlineRename(
    group.name,
    async (name) => {
      try {
        await update.mutateAsync({ name });
        toast.success('已改名');
      } catch (err) {
        toast.error('改名失败', getApiErrorMessage(err));
        throw err;
      }
    }
  );

  return (
    <PageHeader
      backLabel="总览"
      onBack={onBack}
      icon={<Layers size={24} />}
      title={group.name}
      titleContent={
        <InlineRename
          editing={editing}
          value={group.name}
          draft={draft}
          onDraftChange={setDraft}
          onStart={startEditing}
          onCommit={commit}
          onKeyDown={handleKeyDown}
          pending={update.isPending}
          titleClassName="font-serif text-[32px] sm:text-[40px] font-bold leading-[1.2] truncate tracking-tight"
          inputClassName="!font-serif !font-bold !text-[32px] sm:!text-[40px] !leading-[1.2]"
          buttonClassName="p-2 -m-1"
        />
      }
      subtitle={
        <>
          {group.contentCount} 项 · 缓存估算
          <br />
          Note4 图片 {formatBytes(group.note4ImageBytes)} · Note4C 图片{' '}
          {formatBytes(group.note4cImageBytes)} · 音频 {formatBytes(group.audioBytes)}
        </>
      }
    />
  );
}
