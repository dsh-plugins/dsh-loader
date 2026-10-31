import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { createConfigClient } from '../../src/config-client.js';
import { createBootDescriptor } from '../../src/bootstrap.js';
import { installConfigUI } from '../../src/ui/config-form.js';
const version = new URLSearchParams(location.search).get('version') ?? '0.1.5-rc.3';
const boot = createBootDescriptor(version, 'dsh-' + version.split('-')[0]);
const client = createConfigClient(fetch.bind(window), url => new EventSource(url));
const root = createRoot(document.getElementById('root')!);
const slots = {
  inject(_name: string, register: () => unknown) { register(); return () => root.render(null); },
  register(options: { name: string }, Component: React.ComponentType) {
    document.getElementById('location')!.textContent = options.name === 'settings.section' ? '更多 → 设置 → 插件配置' : '插件 → 示例插件 → 配置';
    root.render(<Component/>);
  },
};
installConfigUI({ get: () => slots }, client, boot);
document.getElementById('theme')!.onclick = () => document.body.classList.toggle('dark');

// Record actual browser transition events for phase-order verification.
const motionLog=document.getElementById('group-motion-log')!;
for(const type of ['transitionstart','transitionend','transitioncancel'])document.getElementById('root')!.addEventListener(type,event=>{
  const motion=event as TransitionEvent, target=motion.target as HTMLElement;
  if(!['border-top-color','grid-template-rows'].includes(motion.propertyName))return;
  const group=target.closest('.dshl-config-group')!;
  const data={type,time:Math.round(performance.now()),property:motion.propertyName,group:group.querySelector('legend')!.textContent,expanded:group.getAttribute('data-expanded'),height:Math.round(group.getBoundingClientRect().height),border:getComputedStyle(group).borderTopColor};
  motionLog.textContent+=(JSON.stringify(data)+'\n');
});
