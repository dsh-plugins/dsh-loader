import css from '@arco-design/web-react/dist/css/arco.min.css?inline';
// 与下方的 ESM 组件入口共用适配器，独立弹层也使用宿主提供的 createRoot。
import '@arco-design/web-react/es/_util/react-19-adapter.js';
import { injectStyle } from './style.js';

/** 附属插件共享同一套 Arco 组件、上下文与类型，避免与 loader 原有控件重名。 */
export * as Arco from '@arco-design/web-react/es/index.js';

/** 随 loader 生命周期安装共享样式，并同步宿主已解析的深浅主题。 */
export function installArco(): () => void {
  const releaseStyle = injectStyle('@dsh-plugin/dsh-loader', 'ui/arco.css', css);
  if (typeof document === 'undefined') {
    return releaseStyle;
  }
  const body = document.body;
  const previousTheme = body.getAttribute('arco-theme');
  let appliedTheme: string | null;
  const sync = (): void => {
    appliedTheme = body.hasAttribute('data-ds-dark-theme') ? 'dark' : null;
    if (appliedTheme === null) {
      body.removeAttribute('arco-theme');
    } else {
      body.setAttribute('arco-theme', appliedTheme);
    }
  };
  sync();
  // 只观察宿主的主题属性，不在附属插件中重复创建全局 DOM 观察器。
  const observer = new MutationObserver(sync);
  observer.observe(body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] });
  return () => {
    observer.disconnect();
    releaseStyle();
    if (body.getAttribute('arco-theme') === appliedTheme) {
      if (previousTheme === null) {
        body.removeAttribute('arco-theme');
      } else {
        body.setAttribute('arco-theme', previousTheme);
      }
    }
  };
}
