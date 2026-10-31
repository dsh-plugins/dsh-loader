import * as React from 'react';
import Markdown from 'react-markdown';
import { ConfigError, configAt, configOptions, defaultsFor, mapValues, operationFields } from '../config.js';
import type { ConfigOperation, ConfigOperationResult, ConfigPanel, ConfigResource, ConfigResultDisplay, ConfigValue, ConfigValues } from '../config.js';
import type { ConfigClient } from '../config-client.js';
import { Fields, setAt } from './config-fields.js';

function Result({ display, result }: { display: ConfigResultDisplay; result: ConfigOperationResult }): React.ReactElement {
  const value = configAt(result.value, display.path ?? []);
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? '';
  if (display.type === 'json') return <details className="dshl-config-json"><summary>{display.title ?? 'JSON 结果'}</summary><pre>{JSON.stringify(value, null, 2) ?? 'null'}</pre></details>;
  return <section className="dshl-config-result">{display.title && <h4>{display.title}</h4>}{display.type === 'markdown' ? <Markdown skipHtml>{text}</Markdown> : display.type === 'list' ? <ul>{(Array.isArray(value) ? value : []).map((item, index) => {
    const label = configAt(item, display.label ?? []);
    return <li key={index}>{typeof label === 'string' ? label : JSON.stringify(label)}</li>;
  })}</ul> : <pre>{text}</pre>}</section>;
}
/** No config writes or config watcher notifications occur in this component. */
export function OperationPanel({ pluginId, panel, client, saved, available }: { pluginId: string; panel: ConfigPanel; client: ConfigClient; saved: ConfigValues; available?: string[] }): React.ReactElement {
  const [draft, setDraft] = React.useState(() => defaultsFor(panel.fields));
  const [results, setResults] = React.useState<Record<string, ConfigOperationResult>>({});
  const [resource, setResource] = React.useState<ConfigResource>();
  const [busy, setBusy] = React.useState<string[]>([]);
  const [messages, setMessages] = React.useState<Record<string, { error?: string; success?: string; fields?: Record<string, string> }>>({});
  const prefix = React.useId();
  const current = React.useRef(draft), version = React.useRef(0), edited = React.useRef(false);
  const calls = React.useRef(new Map<string, AbortController>()), mounted = React.useRef(false);
  const resourceRef = React.useRef(resource);
  const latest = React.useRef({ panel, available }); latest.current = { panel, available };
  const updateResource = (next?: ConfigResource) => { resourceRef.current = next; setResource(next); };
  const allowed = (id: string) => !latest.current.available || latest.current.available.includes(id);
  const mutate = (next: ConfigValues) => { current.current = next; setDraft(next); };
  const run = async (operation: ConfigOperation, inputDraft = current.current, reason: 'button' | 'change' | 'background' = 'button'): Promise<void> => {
    if (!mounted.current || !allowed(operation.id)) return;
    const previous = calls.current.get(operation.id);
    if (previous) { if (!operation.readOnly || reason === 'button') return; previous.abort(); }
    if (!operation.readOnly && [...calls.current.keys()].some(id => !latest.current.panel.operations.find(item => item.id === id)?.readOnly)) return;
    if (operation.requiresRevision && !resourceRef.current) return;
    if (!operation.readOnly) version.current++;
    const controller = new AbortController(), started = version.current;
    const selectedResource = resourceRef.current;
    calls.current.set(operation.id, controller); setBusy([...calls.current.keys()]);
    setMessages(old => ({ ...old, [operation.id]: {} }));
    try {
      const input = mapValues(operationFields(latest.current.panel.fields, operation.input), inputDraft, (_field, value) => value);
      const result = await client.invoke(pluginId, operation.id, { input, ...(operation.requiresRevision ? { resource: selectedResource! } : {}) }, controller.signal);
      if (!mounted.current || controller.signal.aborted || calls.current.get(operation.id) !== controller) return;
      setResults(old => ({ ...old, [operation.id]: result }));
      const canFill = version.current === started && (reason !== 'background' || !edited.current);
      if (operation.fill?.length && canFill) {
        let next = current.current;
        for (const binding of operation.fill) {
          const value = configAt(result.value, binding.from);
          if (value === undefined) throw new ConfigError('invalid-result', '操作结果缺少绑定字段');
          next = setAt(next, binding.to, value);
        }
        mutate(next); edited.current = !operation.readOnly; version.current++;
      }
      // Background list refreshes must never replace an editor's optimistic revision.
      if (result.resource !== undefined && canFill && (reason !== 'background' || Boolean(operation.fill?.length))) updateResource(result.resource ?? undefined);
      const skipped = Boolean(operation.fill?.length && !canFill);
      setMessages(old => ({ ...old, [operation.id]: { success: skipped ? '草稿已变化，未覆盖编辑内容。' : operation.button?.success ?? (reason === 'button' ? '操作成功' : '') } }));
      if (reason !== 'background') for (const id of operation.refresh ?? []) {
        const target = latest.current.panel.operations.find(item => item.id === id)!;
        void run(target, current.current, 'background');
      }
    } catch (error) {
      if (mounted.current && !controller.signal.aborted && calls.current.get(operation.id) === controller) setMessages(old => ({ ...old, [operation.id]: { error: error instanceof Error ? error.message : String(error), fields: error instanceof ConfigError ? error.fields : {} } }));
    } finally {
      if (calls.current.get(operation.id) === controller) { calls.current.delete(operation.id); if (mounted.current) setBusy([...calls.current.keys()]); }
    }
  };
  const runRef = React.useRef(run); runRef.current = run;
  const availableKey = available?.join(',');
  React.useEffect(() => {
    mounted.current = true; setBusy([]);
    const refresh = () => { for (const operation of latest.current.panel.operations) if (operation.autoRun) void runRef.current(operation, current.current, 'background'); };
    const off = client.subscribe(refresh); refresh();
    return () => { mounted.current = false; off(); for (const call of calls.current.values()) call.abort(); calls.current.clear(); };
  }, [client, pluginId, panel.id, availableKey]);
  const changing = busy.some(id => !panel.operations.find(operation => operation.id === id)?.readOnly);
  const fields = Object.assign({}, ...Object.values(messages).map(message => message.fields));
  const change = (path: string[], value: ConfigValue) => {
    version.current++; edited.current = true;
    const next = setAt(current.current, path, value); mutate(next);
    for (const operation of panel.operations) if (operation.onChange?.some(trigger => JSON.stringify(trigger) === JSON.stringify(path))) {
      // A selection change invalidates its previously loaded revision immediately.
      if (operation.fill?.length) updateResource();
      void run(operation, next, 'change');
    }
  };
  return <section className="dshl-config-panel" aria-label={panel.title}><h3>{panel.title}</h3>{panel.description && <p>{panel.description}</p>}
    <form noValidate onSubmit={event => event.preventDefault()}>
      <fieldset className="dshl-config-fields" disabled={changing}><Fields fields={panel.fields} draft={draft} errors={fields} prefix={prefix} change={change} options={field => configOptions(field, saved, results)}/></fieldset>
      <div className="dshl-config-actions">{panel.operations.filter(operation => operation.button).map(operation => <button key={operation.id} type="button" disabled={!allowed(operation.id) || busy.includes(operation.id) || changing || Boolean(operation.requiresRevision && !resource)} onClick={() => { void run(operation); }}>{busy.includes(operation.id) ? `${operation.button!.label}中…` : operation.button!.label}</button>)}</div>
      {panel.operations.map(operation => <div key={operation.id} className="dshl-config-operation" aria-busy={busy.includes(operation.id)}>
        {busy.includes(operation.id) && <p role="status">{operation.button?.label ?? operation.id}：处理中… <button type="button" onClick={() => { calls.current.get(operation.id)?.abort(); calls.current.delete(operation.id); setBusy([...calls.current.keys()]); setMessages(old => ({ ...old, [operation.id]: { success: '操作已取消' } })); }}>取消操作</button></p>}
        {messages[operation.id]?.error && <p role="alert" className="dshl-config-error">{messages[operation.id].error}</p>}
        {messages[operation.id]?.success && <p role="status">{messages[operation.id].success}</p>}
        {results[operation.id] && operation.result?.map((display, index) => <Result key={index} display={display} result={results[operation.id]}/>)}
      </div>)}
    </form>
  </section>;
}
