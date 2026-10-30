# 版本支持与验证范围

dsh-loader **2.0.0** 使用六个独立 patch 适配器。同一 patch 的预发布版本由适配器内部的断点处理；未知 patch、未知主版本和低于 `0.1.5` 系列的版本拒绝加载。

发布清单冻结于 **2026-10-30**，来源为 [npm 官方元数据](https://registry.npmjs.org/@deepseek-ai%2fdsh)。当前 24 个已发布版本如下。

| 适配器 | 冻结的发布版 | 配置入口 |
|---|---|---|
| `0.1.5` | `0.1.5-alpha.1`, `0.1.5-alpha.2`, `0.1.5-rc.1`, `0.1.5-rc.2`, `0.1.5-rc.3` | 更多 → 设置 → 插件配置 |
| `0.1.6` | `0.1.6-alpha.1`, `0.1.6-alpha.2` | alpha.1 使用聚合页；alpha.2 起使用插件详情 |
| `0.1.7` | `0.1.7-alpha.1`, `0.1.7-alpha.2`, `0.1.7-rc.1`, `0.1.7-rc.2` | 插件详情（bundle / row 配置槽位） |
| `0.2.0` | `0.2.0-rc.1`, `0.2.0-rc.2` | 插件详情（bundle / row 配置槽位） |
| `0.2.1` | `0.2.1-alpha.1`, `0.2.1-alpha.2`, `0.2.1-alpha.3`, `0.2.1-alpha.4`, `0.2.1-alpha.5`, `0.2.1-rc.1`, `0.2.1-rc.2`, `0.2.1-rc.3`, `0.2.1-rc.4`, `0.2.1-rc.5` | 插件详情（bundle / row 配置槽位） |
| `0.2.2` | `0.2.2-alpha.2` | 插件详情（bundle / row 配置槽位） |

## 冻结证据

- `tests/fixtures/upstream-releases.json`：发布清单、原始依赖、导出与槽位快照。
- `tests/fixtures/upstream/package-lock.json`：24 个 npm alias 的完整依赖解析结果，记录版本、下载地址与 integrity。上游存在互相冲突的 peer 约束，因此生成锁时使用 `--legacy-peer-deps`；它不是所有平台均可直接安装的承诺。
- `tests/fixtures/resolved-contracts.json`：从锁文件实际解析到的 213 个相关包的导出、服务、鉴权与槽位契约；下载 tarball 后校验 SHA-512。
- `tests/version-matrix.test.mjs`：对全部目标版本运行选择、实际启动脚本、客户端配置及契约断言。

契约矩阵不等于启动了 24 套完整 dsh。真实浏览器验收使用实际配置服务、HTTP/SSE 桥接和 React 表单，并用最小槽位宿主分别挂载新旧入口；没有在 24 套完整 dsh 界面逐一进行端到端验收。

## 更新冻结

新增 patch 必须增加独立适配器，核对预发布断点、公开符号、服务和槽位，再更新矩阵。不要通过扩大 semver 范围让未知版本自动落入现有适配器。

```powershell
cd tests/fixtures/upstream
npm install --package-lock-only --ignore-scripts --legacy-peer-deps
cd ../../..
python scripts/freeze-contracts.py
npm test
```

此命令仅刷新已有清单的依赖；新增版本时先按官方元数据更新 fixture 的 aliases 与发布快照。网络抓取不会在常规测试中执行。

运行时要求 Node.js **24.9.0+**。稳定宿主子路径提供 ESM 和 CJS 入口；客户端子路径由 dsh 浏览器模块加载器解析。公开声明随 loader 发布，不要求消费者安装某个上游版本。

旧 settings namespace API 在新宿主上已经删除，loader 会给出能力错误；插件自有设置请使用 [config-api](config-api.md)。迁移边界见 [1.x → 2.0](migration-2.0.md)。

## 后续真实启动检查

迁移 dsh-network-settings 2.0.0 时，已分别安装并逐一启动以上 24 个真实 dsh CLI/web profile，验证认证配置读写、落盘、修订冲突、密码遮蔽与实际出站 User-Agent。真实浏览器操作覆盖 0.1.5-alpha.1 与 0.2.2-alpha.2 的新旧入口。

其中 **0.1.6-alpha.1 有上游安装条件**：默认解析到的 app-boot 删除了 CLI 导入的 watchUserPatches，导致插件执行前启动失败。仅固定该 CLI 的直接依赖到同版后通过。pnpm 11 安装目录的 pnpm-workspace.yaml 可写：

```yaml
overrides:
  "@deepseek-ai/dsh@0.1.6-alpha.1>@deepseek-ai/dsh-app-boot": "0.1.6-alpha.1"
```

此次同时修复了实际 Cordis 插件上下文 baseUrl 的 profile 定位，旧实现只读取 loader.config.baseUrl。
