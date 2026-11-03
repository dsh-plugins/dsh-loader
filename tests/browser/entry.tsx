import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { createConfigClient } from '../../src/config-client.js';
import { createBootDescriptor } from '../../src/bootstrap.js';
import { installConfigUI } from '../../src/ui/config-form.js';
import type { ConfigModelSource } from '../../src/ui/config-model-source.js';
import { createConfigDialogs } from '../../src/ui/config-dialogs.js';
import { apply as applyDialogExample } from '../../examples/config-plugin/client.js';
import { Arco, installArco } from '../../src/ui/arco.js';
const version = new URLSearchParams(location.search).get('version') ?? '0.1.5-rc.3';
const boot = createBootDescriptor(version, 'dsh-' + version.split('-')[0]);
const client = createConfigClient(fetch.bind(window), url => new EventSource(url));
const dialogs = createConfigDialogs(client), releases: (() => void)[] = [];
applyDialogExample({ effect(fn) { const off = fn(); if (off) releases.push(off); }, dshLoaderUi: { config: dialogs } });
const root = createRoot(document.getElementById('root')!);
const slots = {
  inject(_name: string, register: () => unknown) { register(); return () => root.render(null); },
  register(options: { name: string }, Component: React.ComponentType) {
    document.getElementById('location')!.textContent = options.name === 'settings.section' ? '更多 → 设置 → 插件配置' : '插件 → 示例插件 → 配置';
    root.render(<Component/>);
  },
};
const loadModels: ConfigModelSource = async signal => {
  signal.throwIfAborted();
  return { groups: [
    { id: 'example', name: '示例提供商', models: [
      { id: 'example-flash', name: 'Example Flash', reasoning: { efforts: [{ id: 'off', name: 'Off' }, { id: 'low', name: 'Low' }, { id: 'high', name: 'High' }, { id: 'max', name: 'Max' }], defaultEffort: 'high' } },
      ...Array.from({ length: 24 }, (_, index) => ({ id: `example-${index}`, name: `Example Model ${index}` })),
    ] },
    { id: 'example-alt', name: '另一提供商', models: [{ id: 'example-flash', name: 'Another Flash' }] },
  ], failures: [] };
};
const offUI = installConfigUI({ get: () => slots }, client, boot, dialogs, loadModels);
window.addEventListener('beforeunload', () => { for (const off of releases) off(); offUI(); dialogs.dispose(); client.dispose(); });
const offArco = installArco();
document.getElementById('theme')!.onclick = () => {
  const dark = document.body.classList.toggle('dark');
  document.body.toggleAttribute('data-ds-dark-theme', dark);
};
const arcoContainer = document.createElement('section');
arcoContainer.setAttribute('aria-label', '共享 Arco 控件');
document.querySelector('main')!.appendChild(arcoContainer);
const arcoRoot = createRoot(arcoContainer);
function ArcoExample(): React.ReactElement {
  const [visible, setVisible] = React.useState(false);
  const [value, setValue] = React.useState('foo');
  return <Arco.Space direction="vertical">
    <Arco.Typography.Title heading={5}>共享 Arco 控件</Arco.Typography.Title>
    <Arco.Input placeholder="Arco 输入框"/>
    <Arco.Select aria-label="Arco 选项" value={value} onChange={setValue} options={['foo', 'bar']} style={{ width: 240 }}/>
    <Arco.Button type="primary" onClick={() => setVisible(true)}>打开 Arco 弹窗</Arco.Button>
    <Arco.Modal title="共享 Arco 弹窗" visible={visible} onOk={() => setVisible(false)} onCancel={() => setVisible(false)}>附属插件共享组件与主题</Arco.Modal>
  </Arco.Space>;
}
arcoRoot.render(<ArcoExample/>);
window.addEventListener('beforeunload', () => { arcoRoot.unmount(); offArco(); });

// Record actual browser transition events for phase-order verification.
const motionLog=document.getElementById('group-motion-log')!;
for(const type of ['transitionstart','transitionend','transitioncancel'])document.getElementById('root')!.addEventListener(type,event=>{
  const motion=event as TransitionEvent, target=motion.target as HTMLElement;
  if(!['border-top-color','grid-template-rows'].includes(motion.propertyName))return;
  const group=target.closest('.dshl-config-group')!;
  const data={type,time:Math.round(performance.now()),property:motion.propertyName,group:group.querySelector('legend')!.textContent,expanded:group.getAttribute('data-expanded'),height:Math.round(group.getBoundingClientRect().height),border:getComputedStyle(group).borderTopColor};
  motionLog.textContent+=(JSON.stringify(data)+'\n');
});
