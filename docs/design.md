# dsh-loader 2.0.0 架构

## 版本与启动

宿主选择六个独立 patch 入口之一，patch 内的预发布差异写在各自客户端元数据中。公共机制放在 adapters/shared，不参与版本选择；没有跨 patch 或跨主版本回退。冻结数据与依赖树见[支持表](support.md)。

宿主生成协议 2 启动描述：loader/dsh 版本、adapterId、能力、别名、桥接地址、exposeAllNamespaces。安全 JSON 转义阻止脚本结束标签和 Unicode 行分隔符提前结束脚本。即使别名为空也注入描述；别名工厂在插件模块执行前注册，模块加载器晚到时由属性拦截器完成注册。客户端验证描述，只按宿主 ID 选适配器。

客户端元数据和宿主模块分离，浏览器包不引入 Node 模块。宿主 ESM/CJS 子路径通过显式模块出口解析，CJS 全局别名钩子仅服务插件显式注册的重命名。

## 适配与服务

`src/adapters/<patch>/index.ts` 是宿主入口，`client.ts` 是浏览器安全元数据。模块路径表、settings 差异、HTTP 路由和浏览器认证都在适配层；服务层只保留稳定入口。HostAdapter 可覆盖 settings、web、services、registry、llm 和 dsh。

HTTP 方法路由规范化为宿主 exact 路由，并按方法分发；同路径注册按 token 保留覆盖关系。全局 middleware 包装宿主 Node HTTP request dispatch。配置桥接沿用 Connection 的浏览器 cookie 认证，不开放给未认证或跨站请求。

## 资源协议

ResourceScope 记录有效状态和幂等 disposer。关闭后才取得的异步资源立即释放。别名表保存每次注册的 token；释放中间层不会复活已释放值。解析钩子的 original 在首次安装时固定，外层包装器出现后只更新共享表，不重新捕获委托。

函数补丁用可停用代理。释放后，第三方闭包仍持有代理也只能透传；仅属性仍指向自身时恢复属性。同 ID 重装先停用旧层，旧句柄不能撤销新层。fetch 和 HTTP middleware 使用同一协议。延迟监听保存取消状态与正式 disposer，转正前后都可通过原句柄取消。

## 配置与页面

[config-api](config-api.md)拥有模板、配置文件、修订号、订阅和表单。插件只声明数据结构与布局元数据；group 不产生数据层级，object/array 产生数据层级。密码以 opaque 引用跨过客户端边界，持久化仍由宿主完成。

每个 ID 一个写队列，磁盘提交成功后更新内存并广播。重新注册等待前一 owner 的在途提交，不删除卸载插件的数据。profile 从运行上下文或显式配置确定，不扫描其他 profile。

旧入口使用 settings.section；0.1.6-alpha.2 起使用对应插件详情页 native 槽位。所有入口复用 ConfigCard，独立草稿、独立保存、默认折叠、实测 label 宽度、fieldset/legend 分组以及模板驱动的数组编辑。

## 验证

`npm test` 覆盖回归、真实启动脚本、24 版发布契约矩阵、文件存储与 HTTP/SSE，以及 React 表单。`npm run typecheck` 和 `npm run build` 分别检查宿主与客户端。`tests/browser` 使用真实浏览器与隔离 profile 检查尺寸、主题、交互和两种槽位接入。发布包另行验证声明闭包和无全局解析钩子的 ESM/CJS 使用方式。
