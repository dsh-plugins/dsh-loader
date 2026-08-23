/**
 * Tests for the dshloader UI slot engine.
 *
 * These pin the behaviour the engine exists to centralise — the five things
 * every plugin used to hand-roll: locate hosts, coalesce mutations, stay
 * idempotent, self-heal after a shell re-render, and tear down cleanly.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createUiAPI, type UiAPI } from '../../src/ui/slots.js'

let engine: UiAPI | undefined

afterEach(() => {
  engine?.destroy()
  engine = undefined
  document.body.innerHTML = ''
})

/**
 * Let the engine's scheduled sweep run, then drain React's work queues.
 *
 * The engine coalesces mutations onto requestAnimationFrame, and `mountReact`
 * commits through a concurrent React root — wrapping the wait in `act` makes
 * both deterministic instead of timer-dependent.
 */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
    await new Promise(resolve => setTimeout(resolve, 20))
  })
}

function host(id: string, attrs: Record<string, string> = {}): HTMLElement {
  const el = document.createElement('div')
  el.dataset.testid = id
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  document.body.appendChild(el)
  return el
}

describe('anchors', () => {
  it('mounts into every element the anchor resolves to', async () => {
    host('a', { 'data-target': '' })
    host('b', { 'data-target': '' })
    engine = createUiAPI()
    engine.defineAnchor('t', { describe: 't', find: () => document.querySelectorAll('[data-target]') })
    engine.mount('t', { id: 'p:one', render: node => { node.textContent = 'X' } })
    await flush()
    expect(document.querySelectorAll('[data-dshl-slot="p:one"]')).toHaveLength(2)
    expect(document.querySelectorAll('[data-dshl-slot="p:one"]')[0].textContent).toBe('X')
  })

  it('falls back when the primary locator finds nothing, and reports it', async () => {
    host('only', { 'data-fallback': '' })
    engine = createUiAPI()
    engine.defineAnchor('t', {
      describe: 't',
      find: () => document.querySelectorAll('[data-primary]'),
      fallback: () => document.querySelectorAll('[data-fallback]'),
    })
    engine.mount('t', { id: 'p:fb', render: () => undefined })
    await flush()
    expect(document.querySelectorAll('[data-dshl-slot="p:fb"]')).toHaveLength(1)
    const [diag] = engine.diagnose()
    expect(diag.usedFallback).toBe(true)
    expect(diag.hosts).toBe(1)
  })

  it('honours accept and when predicates', async () => {
    const keep = host('keep', { 'data-target': '' })
    keep.textContent = 'diving'
    const skip = host('skip', { 'data-target': '' })
    skip.textContent = 'idle'
    engine = createUiAPI()
    engine.defineAnchor('t', {
      describe: 't',
      find: () => document.querySelectorAll('[data-target]'),
      accept: el => /diving/i.test(el.textContent ?? ''),
    })
    engine.mount('t', { id: 'p:acc', render: () => undefined })
    await flush()
    expect(keep.querySelector('[data-dshl-slot="p:acc"]')).not.toBeNull()
    expect(skip.querySelector('[data-dshl-slot="p:acc"]')).toBeNull()
  })

  it('respects the insert mode', async () => {
    const h = host('h', { 'data-target': '' })
    h.appendChild(Object.assign(document.createElement('span'), { textContent: 'first' }))
    engine = createUiAPI()
    engine.defineAnchor('t', {
      describe: 't',
      find: () => document.querySelectorAll('[data-target]'),
      insert: 'prepend',
    })
    engine.mount('t', { id: 'p:pre', render: () => undefined })
    await flush()
    expect(h.firstElementChild?.getAttribute('data-dshl-slot')).toBe('p:pre')
  })

  it('hosts() exposes elements for read-only anchors', async () => {
    host('f', { 'data-sidebar-collapsed': '' })
    engine = createUiAPI()
    engine.defineAnchor('frame', { describe: 'frame', find: () => document.querySelectorAll('[data-sidebar-collapsed]') })
    expect(engine.hosts('frame')).toHaveLength(1)
    expect(engine.hosts('nope')).toHaveLength(0)
  })
})

describe('idempotence and self-healing', () => {
  it('does not mount twice into the same host across sweeps', async () => {
    const h = host('h', { 'data-target': '' })
    const render = vi.fn()
    engine = createUiAPI()
    engine.defineAnchor('t', { describe: 't', find: () => document.querySelectorAll('[data-target]') })
    engine.mount('t', { id: 'p:once', render })
    await flush()
    // Provoke more mutation batches.
    h.appendChild(document.createElement('i'))
    document.body.appendChild(document.createElement('i'))
    await flush()
    expect(render).toHaveBeenCalledTimes(1)
    expect(h.querySelectorAll('[data-dshl-slot="p:once"]')).toHaveLength(1)
  })

  it('re-mounts after a shell re-render wipes the node', async () => {
    const h = host('h', { 'data-target': '' })
    const render = vi.fn()
    engine = createUiAPI()
    engine.defineAnchor('t', { describe: 't', find: () => document.querySelectorAll('[data-target]') })
    engine.mount('t', { id: 'p:heal', render })
    await flush()
    expect(render).toHaveBeenCalledTimes(1)

    // Simulate React replacing the host's children.
    h.innerHTML = ''
    await flush()
    expect(h.querySelector('[data-dshl-slot="p:heal"]')).not.toBeNull()
    expect(render).toHaveBeenCalledTimes(2)
  })

  it('runs cleanup and forgets a host that leaves the document', async () => {
    const h = host('h', { 'data-target': '' })
    const cleanup = vi.fn()
    engine = createUiAPI()
    engine.defineAnchor('t', { describe: 't', find: () => document.querySelectorAll('[data-target]') })
    engine.mount('t', { id: 'p:gone', render: () => cleanup })
    await flush()
    h.remove()
    await flush()
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(engine.diagnose()[0].live).toBe(0)
  })

  it('coalesces a mutation burst into a single sweep', async () => {
    host('h', { 'data-target': '' })
    let sweeps = 0
    engine = createUiAPI()
    engine.defineAnchor('t', {
      describe: 't',
      find: () => {
        sweeps += 1
        return document.querySelectorAll('[data-target]')
      },
    })
    engine.mount('t', { id: 'p:burst', render: () => undefined })
    await flush()
    const afterFirst = sweeps
    for (let i = 0; i < 40; i += 1) document.body.appendChild(document.createElement('i'))
    await flush()
    // 40 mutations must not produce 40 resolutions.
    expect(sweeps - afterFirst).toBeLessThanOrEqual(2)
  })
})

describe('teardown and failure containment', () => {
  it('the mount disposer removes nodes and runs cleanup', async () => {
    const h = host('h', { 'data-target': '' })
    const cleanup = vi.fn()
    engine = createUiAPI()
    engine.defineAnchor('t', { describe: 't', find: () => document.querySelectorAll('[data-target]') })
    const off = engine.mount('t', { id: 'p:off', render: () => cleanup })
    await flush()
    off()
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(h.querySelector('[data-dshl-slot="p:off"]')).toBeNull()
  })

  it('destroy() unmounts everything and stops observing', async () => {
    const h = host('h', { 'data-target': '' })
    const cleanup = vi.fn()
    engine = createUiAPI()
    engine.defineAnchor('t', { describe: 't', find: () => document.querySelectorAll('[data-target]') })
    engine.mount('t', { id: 'p:d', render: () => cleanup })
    await flush()
    engine.destroy()
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(h.querySelector('[data-dshl-slot="p:d"]')).toBeNull()
    // Further mutations must not resurrect anything.
    h.appendChild(document.createElement('i'))
    await flush()
    expect(h.querySelector('[data-dshl-slot="p:d"]')).toBeNull()
    engine = undefined
  })

  it('a throwing render is contained and leaves no orphan node', async () => {
    const h = host('h', { 'data-target': '' })
    const warn = vi.fn()
    engine = createUiAPI({ warn })
    engine.defineAnchor('t', { describe: 't', find: () => document.querySelectorAll('[data-target]') })
    engine.mount('t', { id: 'p:boom', render: () => { throw new Error('boom') } })
    await flush()
    expect(warn).toHaveBeenCalled()
    expect(h.querySelector('[data-dshl-slot="p:boom"]')).toBeNull()
  })

  it('a missing anchor warns but keeps the mount for later definition', async () => {
    const warn = vi.fn()
    engine = createUiAPI({ warn })
    engine.mount('later', { id: 'p:late', render: () => undefined })
    expect(warn).toHaveBeenCalled()
    host('h', { 'data-target': '' })
    engine.defineAnchor('later', { describe: 'later', find: () => document.querySelectorAll('[data-target]') })
    await flush()
    expect(document.querySelector('[data-dshl-slot="p:late"]')).not.toBeNull()
  })

  it('removing an anchor unmounts its instances', async () => {
    const h = host('h', { 'data-target': '' })
    const cleanup = vi.fn()
    engine = createUiAPI()
    const off = engine.defineAnchor('t', { describe: 't', find: () => document.querySelectorAll('[data-target]') })
    engine.mount('t', { id: 'p:anch', render: () => cleanup })
    await flush()
    off()
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(h.querySelector('[data-dshl-slot="p:anch"]')).toBeNull()
  })

  it('re-registering a mount id replaces the old instances', async () => {
    host('h', { 'data-target': '' })
    const first = vi.fn(() => vi.fn())
    const second = vi.fn()
    engine = createUiAPI()
    engine.defineAnchor('t', { describe: 't', find: () => document.querySelectorAll('[data-target]') })
    engine.mount('t', { id: 'p:hmr', render: first })
    await flush()
    engine.mount('t', { id: 'p:hmr', render: second })
    await flush()
    expect(second).toHaveBeenCalledTimes(1)
    expect(document.querySelectorAll('[data-dshl-slot="p:hmr"]')).toHaveLength(1)
  })

  it('mount requires an id', () => {
    engine = createUiAPI()
    engine.defineAnchor('t', { describe: 't', find: () => [] })
    expect(() => engine!.mount('t', { id: '', render: () => undefined })).toThrow(/spec\.id is required/)
  })
})

describe('onDomSettled', () => {
  it('fires once per coalesced batch and works with no anchors registered', async () => {
    const listener = vi.fn()
    engine = createUiAPI()
    engine.onDomSettled(listener)
    await flush()
    const afterFirst = listener.mock.calls.length
    expect(afterFirst).toBeGreaterThan(0)

    for (let i = 0; i < 30; i += 1) document.body.appendChild(document.createElement('i'))
    await flush()
    // 30 mutations must collapse into a single extra notification.
    expect(listener.mock.calls.length - afterFirst).toBeLessThanOrEqual(2)
  })

  it('runs AFTER the mount sweep, so listeners observe this batch mounts', async () => {
    host('h', { 'data-target': '' })
    let sawMount = false
    engine = createUiAPI()
    engine.defineAnchor('t', { describe: 't', find: () => document.querySelectorAll('[data-target]') })
    engine.mount('t', { id: 'p:order', render: () => undefined })
    engine.onDomSettled(() => {
      if (document.querySelector('[data-dshl-slot="p:order"]') !== null) sawMount = true
    })
    await flush()
    expect(sawMount).toBe(true)
  })

  it('the unsubscribe function stops notifications', async () => {
    const listener = vi.fn()
    engine = createUiAPI()
    const off = engine.onDomSettled(listener)
    await flush()
    const before = listener.mock.calls.length
    off()
    document.body.appendChild(document.createElement('i'))
    await flush()
    expect(listener.mock.calls.length).toBe(before)
  })

  it('a throwing listener is contained and does not stop siblings', async () => {
    const warn = vi.fn()
    const good = vi.fn()
    engine = createUiAPI({ warn })
    engine.onDomSettled(() => {
      throw new Error('boom')
    })
    engine.onDomSettled(good)
    await flush()
    expect(warn).toHaveBeenCalled()
    expect(good).toHaveBeenCalled()
  })

  it('destroy() clears subscribers', async () => {
    const listener = vi.fn()
    engine = createUiAPI()
    engine.onDomSettled(listener)
    await flush()
    engine.destroy()
    const before = listener.mock.calls.length
    document.body.appendChild(document.createElement('i'))
    await flush()
    expect(listener.mock.calls.length).toBe(before)
    engine = undefined
  })

  it('rejects a non-function listener', () => {
    engine = createUiAPI()
    expect(() => engine!.onDomSettled(undefined as never)).toThrow(/must be a function/)
  })
})

describe('React mounts', () => {
  it('renders a component into each host and unmounts on teardown', async () => {
    // This case deliberately exercises the PRODUCTION path: the engine commits
    // its React root from a MutationObserver sweep, not from inside `act`. The
    // act environment is therefore switched off here — leaving it on would make
    // React warn about the very behaviour this test is asserting.
    const previous = globalThis.IS_REACT_ACT_ENVIRONMENT
    globalThis.IS_REACT_ACT_ENVIRONMENT = false
    try {
      host('h', { 'data-target': '' })
      engine = createUiAPI()
      engine.defineAnchor('t', { describe: 't', find: () => document.querySelectorAll('[data-target]') })
      const off = engine.mountReact('t', {
        id: 'p:react',
        component: ({ host: h }) => <b data-role="rendered">{h.getAttribute('data-testid')}</b>,
      })
      await new Promise(resolve => setTimeout(resolve, 50))
      const rendered = document.querySelector('[data-role="rendered"]')
      expect(rendered).not.toBeNull()
      expect(rendered?.textContent).toBe('h')
      off()
      expect(document.querySelector('[data-role="rendered"]')).toBeNull()
    } finally {
      globalThis.IS_REACT_ACT_ENVIRONMENT = previous
    }
  })
})
