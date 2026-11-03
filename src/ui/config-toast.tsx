import * as React from 'react';
import { Toast as PlatformToast } from '@deepseek-ai/dsh-client-ui-primitives';

/** 稳定完成回调，避免旧版宿主在配置页重渲染时重置 Toast 的展示时间。 */
export function ConfigToast({ text, success, onDone }: { text: string; success: boolean; onDone(): void }): React.ReactElement {
  const latest = React.useRef(onDone); latest.current = onDone;
  const complete = React.useCallback(() => latest.current(), []);
  const icon = <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ color: success ? 'var(--dsw-alias-state-success-primary,#2e7d32)' : 'var(--dsw-alias-status-danger,#d33)' }}>
    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5"/>
    <path d={success ? 'm5 8 2 2 4-4' : 'M8 4.5v4M8 11h.01'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>;
  return <PlatformToast text={text} icon={icon} onDone={complete} {...(success ? { tone: 'success' as const } : {})}/>;
}
