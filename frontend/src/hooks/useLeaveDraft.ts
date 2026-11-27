import { useCallback, useEffect, useRef } from 'react';
import { useBeforeUnload, useBlocker } from 'react-router-dom';
import { useConfirm } from '@/components/feedback/confirm-context';

export function useLeaveDraft(dirty: boolean) {
  const allowLeave = useRef(false);
  const confirm = useConfirm();
  const blocker = useBlocker(useCallback(() => dirty && !allowLeave.current, [dirty]));
  useBeforeUnload(
    useCallback(
      (event) => {
        if (dirty && !allowLeave.current) {
          event.preventDefault();
          event.returnValue = true;
        }
      },
      [dirty]
    )
  );

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    let active = true;
    void confirm({
      title: '离开当前页面？',
      description: '还有未保存的图片修改。',
      confirmText: '离开页面',
      cancelText: '继续编辑',
    }).then((leave) => {
      if (!active) return;
      if (leave) blocker.proceed();
      else blocker.reset();
    });
    return () => {
      active = false;
    };
  }, [blocker, confirm]);

  return useCallback((navigate: () => void) => {
    allowLeave.current = true;
    navigate();
  }, []);
}
