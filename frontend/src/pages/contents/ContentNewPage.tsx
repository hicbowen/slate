// 新建帧页面 — 路由 /groups/:gid/contents/new
// 统一入口，支持图片 + 所有动态类型在同一页面切换。

import { useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ContentCreateEditor } from '@/features/contents/components/ContentCreateEditor';
import { RequireRouteParams } from '@/components/layout/RequireRouteParams';
import { appRoutes } from '@/app/routes';

export function ContentNewPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const type = params.get('type');
  const initialType = type === 'image' || type === 'dynamic' ? type : undefined;

  return (
    <RequireRouteParams names={['gid'] as const} hint="请从总览页进入具体内容组。">
      {({ gid }) => (
        <ContentNewPageContent
          key={gid}
          gid={gid}
          initialType={initialType}
          navigate={(path) => navigate(path)}
        />
      )}
    </RequireRouteParams>
  );
}

function ContentNewPageContent({
  gid,
  initialType,
  navigate,
}: {
  gid: string;
  initialType?: 'image' | 'dynamic';
  navigate: (path: string) => void;
}) {
  const onDone = useCallback(() => {
    navigate(appRoutes.group(gid));
  }, [gid, navigate]);

  const onEditCreatedImage = useCallback(
    (contentId: string) => {
      navigate(appRoutes.editImageContent(gid, contentId));
    },
    [gid, navigate]
  );

  return (
    <ContentCreateEditor
      gid={gid}
      initialType={initialType}
      onDone={onDone}
      onEditCreatedImage={onEditCreatedImage}
    />
  );
}
