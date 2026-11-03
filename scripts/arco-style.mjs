import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';

/** 共享构建与预览的样式处理，避免 Arco 的全局重置覆盖宿主页面。 */
export function arcoStyle() {
  const source = '@arco-design/web-react/dist/css/arco.min.css?inline';
  const id = '\0dsh-loader:arco-style';
  return {
    name: 'dsh-loader-arco-style',
    enforce: 'pre',
    resolveId(specifier) {
      if (specifier === source) {
        return id;
      }
    },
    load(specifier) {
      if (specifier !== id) {
        return;
      }
      const path = fileURLToPath(import.meta.resolve(source.replace('?inline', '')));
      const css = postcss.parse(readFileSync(path, 'utf8'), { from: path });
      css.walkRules(rule => {
        if (rule.parent.type === 'atrule' && rule.parent.name.endsWith('keyframes')) {
          return;
        }
        if (rule.selectors.every(selector => /\.[a-zA-Z_-]/.test(selector))) {
          return;
        }
        // body 上的调色板变量供 Portal 继承，其余全局声明属于页面重置。
        rule.walkDecls(declaration => {
          if (!declaration.prop.startsWith('--')) {
            declaration.remove();
          }
        });
        if (rule.nodes.length === 0) {
          rule.remove();
        }
      });
      css.walkComments(comment => comment.remove());
      return { code: `export default ${JSON.stringify(css.toString())};`, map: null };
    },
  };
}
