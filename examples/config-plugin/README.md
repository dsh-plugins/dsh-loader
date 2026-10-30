# config-api 示例

先安装 dsh-loader 2.0.0，再将此目录作为本地 bundle 加载。示例仅包含宿主代码，配置页面由 loader 根据模板生成。

安全 ID 为 `config-example`，npm 包名为 `@dsh-plugin/config-example`。保存后文件位于当前 profile 的 `config/config-example/config.json`。首次注册在内存中补齐默认值，点击保存才写入文件。

`0.1.6-alpha.2` 之前从「更多 → 设置 → 插件配置」进入；之后从本插件详情的配置槽位进入。修改高级模式可观察条件字段，目标列表演示嵌套对象和数组。插件卸载回收注册及监听，不删除配置。

完整接口与冲突处理见 [config-api](../../docs/config-api.md)。
