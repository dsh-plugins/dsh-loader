/** 判断宿主是否具有会话客户端所需的消息渲染注册接口。 */
export function supportsSessionClient(version: string): boolean {
  return /^0\.2\.2-rc\.[1-5](?:\+|$)/.test(version)
    || /^0\.2\.3(?:[-+]|$)/.test(version);
}
