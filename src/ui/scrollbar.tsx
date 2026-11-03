import * as React from 'react';

/** 使用 Arco 主题的纵向滚动容器；隐藏原生滚动条与轨道，保留拖动和键盘操作。 */
export interface ScrollbarProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

const CSS = `
.dshl-scrollbar{position:relative;display:flex;min-height:0;min-width:0;overflow:hidden}
.dshl-scrollbar-viewport{flex:1;min-height:0;min-width:0;overflow:auto;overscroll-behavior:contain;scrollbar-width:none;padding-right:12px}
.dshl-scrollbar-viewport::-webkit-scrollbar{display:none}
.dshl-scrollbar-content{min-width:0;display:flow-root}
.dshl-scrollbar-thumb{position:absolute;right:0;width:6px;border-radius:4px;background:var(--color-text-4,var(--dsw-alias-border-l2,#8888));touch-action:none;user-select:none;cursor:default}
.dshl-scrollbar-thumb:hover,.dshl-scrollbar-thumb:active{background:var(--color-text-3,var(--dsw-alias-label-secondary,#888))}
.dshl-scrollbar-thumb:focus-visible{outline:2px solid rgb(var(--primary-6,64,128,255));outline-offset:1px}
`;

/** 设置 maxHeight 或放入可收缩的 flex 容器，以限制内容高度。 */
export function Scrollbar({ children, className = '', ...props }: ScrollbarProps): React.ReactElement {
  const viewport = React.useRef<HTMLDivElement>(null), content = React.useRef<HTMLDivElement>(null);
  const drag = React.useRef<{ y: number; scroll: number }>();
  const id = React.useId();
  const [size, setSize] = React.useState({ height: 0, total: 0, top: 0 });
  const measure = React.useCallback(() => {
    const element = viewport.current!;
    const next = { height: element.clientHeight, total: element.scrollHeight, top: element.scrollTop };
    setSize(previous => previous.height === next.height && previous.total === next.total && previous.top === next.top ? previous : next);
  }, []);
  React.useLayoutEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport.current!);
    observer.observe(content.current!);
    return () => observer.disconnect();
  }, [measure]);
  React.useLayoutEffect(measure, [children, measure]);
  const range = Math.max(0, size.total - size.height);
  const thumb = Math.min(size.height, Math.max(24, size.height * size.height / (size.total || 1)));
  const travel = size.height - thumb;
  const scroll = (top: number) => {
    viewport.current!.scrollTop = Math.max(0, Math.min(range, top));
    measure();
  };
  return <div {...props} className={`dshl-scrollbar ${className}`}>
    <style>{CSS}</style>
    <div className="dshl-scrollbar-viewport" id={id} ref={viewport} onScroll={measure} tabIndex={0}>
      <div className="dshl-scrollbar-content" ref={content}>{children}</div>
    </div>
    {range > 0 && size.height > 0 && <div className="dshl-scrollbar-thumb" role="scrollbar" tabIndex={0}
      aria-label={props['aria-label'] ?? '滚动内容'} aria-orientation="vertical" aria-controls={id} aria-valuemin={0} aria-valuemax={range} aria-valuenow={Math.round(size.top)}
      style={{ height: thumb, top: Math.max(0, Math.min(travel, size.top / range * travel)) }}
      onPointerDown={event => {
        if (event.button !== 0) {
          return;
        }
        event.preventDefault();
        event.currentTarget.focus();
        drag.current = { y: event.clientY, scroll: size.top };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        if (drag.current && travel > 0) {
          scroll(drag.current.scroll + (event.clientY - drag.current.y) * range / travel);
        }
      }}
      onPointerUp={event => {
        drag.current = undefined;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerCancel={() => { drag.current = undefined; }}
      onLostPointerCapture={() => { drag.current = undefined; }}
      onKeyDown={event => {
        const steps: Record<string, number> = { ArrowDown: 40, ArrowUp: -40, PageDown: size.height, PageUp: -size.height, Home: -size.total, End: size.total };
        if (event.key in steps) {
          event.preventDefault();
          scroll(size.top + steps[event.key]!);
        }
      }} />}
  </div>;
}
