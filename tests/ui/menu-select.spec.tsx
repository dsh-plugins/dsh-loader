/**
 * Tests for `MenuSelect` — the settings-page dropdown built on `DshMenu`.
 *
 * Contract under test: the trigger matches the shell picker look (layer-1
 * bordered button, chevron, inherited font), the popup receives one menu item
 * per option with the current value marked selected, and choosing a row emits
 * the option VALUE (not a DOM event) through `onChange` and closes the popup.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

/** The platform primitive each test installs before rendering. */
let platformImpl: ((props: Record<string, unknown>) => React.ReactElement) | undefined

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Menu: (props: Record<string, unknown>) => {
    if (platformImpl === undefined) throw new Error('platform menu exploded')
    return platformImpl(props)
  },
}))

import { MenuSelect } from '../../src/ui/components.js'
import { CX } from '../../src/ui/style.js'

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
  document.head.querySelectorAll('style[data-plugin-css]').forEach(n => n.remove())
  platformImpl = undefined
})

const options = [
  { value: 'http', label: 'HTTP (CONNECT 隧道)' },
  { value: 'socks5', label: 'SOCKS5' },
]

/** Platform stub that renders the anchor plus one clickable row per item. */
function menuStub(seen: Array<Record<string, unknown>>): (props: Record<string, unknown>) => React.ReactElement {
  return (props) => {
    seen.push(props)
    const items = (props.items as Array<{ id: string; label?: React.ReactNode }>) ?? []
    return (
      <span data-role="menu-host">
        {props.anchor as React.ReactNode}
        {(props.open as boolean)
          ? items.map(item => (
              <button
                key={item.id}
                data-role="menu-row"
                data-id={item.id}
                onClick={() => (props.onSelect as (id: string) => void)(item.id)}
              >
                {item.label}
              </button>
            ))
          : null}
      </span>
    )
  }
}

describe('MenuSelect', () => {
  it('renders the selected option label on a shell-styled trigger', () => {
    const seen: Array<Record<string, unknown>> = []
    platformImpl = menuStub(seen)
    const c = render(<MenuSelect options={options} value="socks5" onChange={() => {}} />)
    const trigger = c.querySelector(`button.${CX}-mselect__trigger`)!
    expect(trigger.textContent).toContain('SOCKS5')
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    expect(c.querySelector(`.${CX}-mselect__caret svg`)).not.toBeNull()
  })

  it('shows the placeholder in tertiary styling when nothing is selected', () => {
    const seen: Array<Record<string, unknown>> = []
    platformImpl = menuStub(seen)
    const c = render(<MenuSelect options={options} value="" placeholder="选择协议" onChange={() => {}} />)
    const text = c.querySelector(`.${CX}-mselect__text`)!
    expect(text.textContent).toBe('选择协议')
    expect(text.className).toContain(`${CX}-mselect__text--ph`)
  })

  it('opens on trigger click and forwards items with the selected id', () => {
    const seen: Array<Record<string, unknown>> = []
    platformImpl = menuStub(seen)
    const c = render(<MenuSelect options={options} value="http" label="协议" onChange={() => {}} />)
    act(() => {
      c.querySelector(`button.${CX}-mselect__trigger`)!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const last = seen[seen.length - 1]!
    expect(last.open).toBe(true)
    expect(last.selectedId).toBe('http')
    expect(last.dense).toBe(true)
    expect((last.items as unknown[]).length).toBe(2)
    expect(c.querySelectorAll('[data-role="menu-row"]')).toHaveLength(2)
  })

  it('emits the chosen value and closes the popup', () => {
    const seen: Array<Record<string, unknown>> = []
    platformImpl = menuStub(seen)
    const chosen: string[] = []
    const c = render(<MenuSelect options={options} value="http" onChange={v => chosen.push(v)} />)
    act(() => {
      c.querySelector(`button.${CX}-mselect__trigger`)!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    act(() => {
      c.querySelector('[data-role="menu-row"][data-id="socks5"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(chosen).toEqual(['socks5'])
    expect(seen[seen.length - 1]!.open).toBe(false)
  })

  it('disables the trigger without opening', () => {
    const seen: Array<Record<string, unknown>> = []
    platformImpl = menuStub(seen)
    const c = render(<MenuSelect options={options} value="http" disabled onChange={() => {}} />)
    const trigger = c.querySelector(`button.${CX}-mselect__trigger`) as HTMLButtonElement
    expect(trigger.disabled).toBe(true)
    act(() => {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(seen[seen.length - 1]!.open).toBe(false)
  })
})
