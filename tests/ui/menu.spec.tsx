/**
 * Tests for the wrapped platform menu (`DshMenu`).
 *
 * The wrapper's contract: forward props verbatim, own hand-written types (so
 * consumer typecheck never resolves @deepseek-ai packages), and degrade to a
 * warn-once empty render when the platform primitive misbehaves — instead of
 * tearing down the host plugin's tree.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

/** The platform primitive each test installs before importing the wrapper. */
let platformImpl: ((props: Record<string, unknown>) => React.ReactElement) | undefined

// The wrapper imports the primitives package statically; vi.mock intercepts it
// so tests control what the "platform" provides without a real shell.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Menu: (props: Record<string, unknown>) => {
    if (platformImpl === undefined) throw new Error('platform menu exploded')
    return platformImpl(props)
  },
}))

import { DshMenu, MenuEntry } from '../../src/ui/menu.js'

const roots: Root[] = []

function render(element: React.ReactElement): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(element)
  })
  roots.push(root)
  return container
}

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.innerHTML = ''
  platformImpl = undefined
})

const entries: readonly MenuEntry[] = [
  { id: 'http', label: 'HTTP' },
  { type: 'separator', id: 's1' },
  { id: 'socks5', label: 'SOCKS5', danger: true },
]

describe('DshMenu forwarding', () => {
  it('forwards every prop verbatim to the platform primitive', () => {
    const seen: Array<Record<string, unknown>> = []
    platformImpl = (props) => {
      seen.push(props)
      return <b data-role="menu" />
    }
    const onSelect = (): void => {}
    const onClose = (): void => {}
    render(
      <DshMenu
        open
        anchor={<button>trigger</button>}
        items={entries}
        selectedId="http"
        onSelect={onSelect}
        onClose={onClose}
        align="end"
        side="top"
        portal
        dense
      />,
    )
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({
      open: true,
      items: entries,
      selectedId: 'http',
      onSelect,
      onClose,
      align: 'end',
      side: 'top',
      portal: true,
      dense: true,
    })
  })

  it('renders whatever the platform returns so styling stays with the shell', () => {
    platformImpl = () => <b data-role="menu">shell markup</b>
    const c = render(<DshMenu open anchor={<i />} items={entries} onSelect={() => {}} onClose={() => {}} />)
    expect(c.querySelector('[data-role="menu"]')).not.toBeNull()
  })

  it('accepts separators and labels in items without transformation', () => {
    const seen: Array<Record<string, unknown>> = []
    platformImpl = (props) => {
      seen.push(props)
      return <i />
    }
    const mixed: readonly MenuEntry[] = [
      { type: 'label', id: 'l1', text: '协议' },
      ...entries,
    ]
    render(<DshMenu open anchor={<i />} items={mixed} onSelect={() => {}} onClose={() => {}} />)
    expect(seen[0].items).toBe(mixed)
  })
})

describe('DshMenu degradation', () => {
  it('a throwing platform degrades to null with exactly one warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    platformImpl = () => {
      throw new Error('prop shape drifted')
    }
    const c = render(
      <DshMenu open anchor={<i />} items={entries} onSelect={() => {}} onClose={() => {}} />,
    )
    expect(c.innerHTML).toBe('')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toContain('[dshloader] DshMenu')
    expect(warn.mock.calls[0]?.[0]).toContain('prop shape drifted')
    // Subsequent renders stay silent — the failure is latched.
    render(<DshMenu open={false} anchor={<i />} items={entries} onSelect={() => {}} onClose={() => {}} />)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})
