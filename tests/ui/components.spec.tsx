/**
 * Tests for the dshloader base controls.
 *
 * These are the public API 12 components wide, so they are pinned on the things
 * a consumer actually depends on: that native props and `className` pass through
 * (the documented escape hatch), that controlled values and disabled states
 * behave, that accessibility attributes are present, and that the stylesheet is
 * injected exactly once with the DSH ownership attributes.
 *
 * Rendering uses plain `react-dom/client` — no testing-library — to keep
 * dshloader's dependency footprint minimal.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  Button,
  Card,
  Checkbox,
  Col,
  Field,
  IconButton,
  Row,
  Select,
  Spinner,
  Switch,
  Textarea,
  TextInput,
  ensureStyles,
} from '../../src/ui/components.js'
import { CX } from '../../src/ui/style.js'
import { ICON_NAMES, Icon, Icons, icon } from '../../src/ui/icons.js'

const roots: Root[] = []
const containers: HTMLElement[] = []

/** Render into a detached-but-attached container and return it. */
function render(element: React.ReactElement): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(element)
  })
  roots.push(root)
  containers.push(container)
  return container
}

/**
 * Drive a controlled text field the way React observes it.
 *
 * Two details matter: React's `onChange` for text fields is wired to the native
 * `input` event (not `change`), and React tracks the last value it wrote on the
 * DOM node — so the value must be set through the prototype setter or React
 * treats the event as a no-op and never calls the handler.
 */
function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!
  act(() => {
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** Toggle a checkbox/switch: React derives `onChange` from the click. */
function toggle(el: HTMLInputElement): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

/** Pick a `<select>` option; here React really does listen to `change`. */
function selectOption(el: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
  act(() => {
    setter.call(el, value)
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  for (const c of containers.splice(0)) c.remove()
  document.head.querySelectorAll('style[data-plugin-css]').forEach(n => n.remove())
  document.body.innerHTML = ''
})

describe('stylesheet ownership', () => {
  it('injects exactly one stylesheet tagged with the DSH ownership attributes', () => {
    render(<Button>a</Button>)
    render(<TextInput />)
    ensureStyles()
    ensureStyles()
    const tags = document.head.querySelectorAll('style[data-plugin-css]')
    expect(tags).toHaveLength(1)
    const tag = tags[0] as HTMLStyleElement
    expect(tag.dataset.plugin).toBe('@dsh-plugin/dsh-loader')
    expect(tag.dataset.pluginCss).toBe('@dsh-plugin/dsh-loader/ui/controls.css')
    expect(tag.textContent).toContain(`.${CX}-btn`)
  })

  it('styles reference DSH tokens with fallbacks rather than hard-coded colours', () => {
    render(<Button>a</Button>)
    const css = document.head.querySelector('style[data-plugin-css]')?.textContent ?? ''
    expect(css).toContain('var(--dsw-alias-label-primary,')
    expect(css).toContain('var(--dsw-alias-border-l2,')
    expect(css).toContain('prefers-reduced-motion')
  })
})

describe('Button', () => {
  it('renders children, defaults to type=button, and forwards onClick', () => {
    const onClick = vi.fn()
    const c = render(<Button onClick={onClick}>Save</Button>)
    const btn = c.querySelector('button')!
    expect(btn.textContent).toContain('Save')
    expect(btn.getAttribute('type')).toBe('button')
    act(() => btn.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('applies variant and size classes and merges a custom className', () => {
    const c = render(<Button variant="primary" small className="mine">x</Button>)
    const btn = c.querySelector('button')!
    expect(btn.className).toContain(`${CX}-btn`)
    expect(btn.className).toContain(`${CX}-btn--primary`)
    expect(btn.className).toContain(`${CX}-btn--sm`)
    expect(btn.className).toContain('mine')
  })

  it('loading disables the button and swaps the icon for a spinner', () => {
    const onClick = vi.fn()
    const c = render(<Button loading icon="Save" onClick={onClick}>Go</Button>)
    const btn = c.querySelector('button')!
    expect(btn.disabled).toBe(true)
    expect(c.querySelector(`.${CX}-spin`)).not.toBeNull()
    act(() => btn.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('disabled blocks clicks', () => {
    const onClick = vi.fn()
    const c = render(<Button disabled onClick={onClick}>x</Button>)
    act(() => c.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('renders a leading icon as inline svg', () => {
    const c = render(<Button icon="Settings">x</Button>)
    expect(c.querySelector('svg')).not.toBeNull()
  })
})

describe('IconButton', () => {
  it('exposes label as the accessible name and the title', () => {
    const c = render(<IconButton icon="Delete" label="Remove row" />)
    const btn = c.querySelector('button')!
    expect(btn.getAttribute('aria-label')).toBe('Remove row')
    expect(btn.getAttribute('title')).toBe('Remove row')
    expect(c.querySelector('svg')).not.toBeNull()
  })

  it('an explicit title wins over the label', () => {
    const c = render(<IconButton icon="Delete" label="Remove" title="Custom" />)
    expect(c.querySelector('button')!.getAttribute('title')).toBe('Custom')
  })
})

describe('TextInput / Textarea', () => {
  it('is controlled and reports changes', () => {
    const onChange = vi.fn()
    const c = render(<TextInput value="hello" onChange={onChange} />)
    const input = c.querySelector('input')!
    expect(input.value).toBe('hello')
    typeInto(input, 'world')
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('mono and invalid apply their classes and aria-invalid', () => {
    const c = render(<TextInput mono invalid />)
    const input = c.querySelector('input')!
    expect(input.className).toContain(`${CX}-input--mono`)
    expect(input.className).toContain(`${CX}-input--invalid`)
    expect(input.getAttribute('aria-invalid')).toBe('true')
  })

  it('does not set aria-invalid when valid', () => {
    const c = render(<TextInput />)
    expect(c.querySelector('input')!.hasAttribute('aria-invalid')).toBe(false)
  })

  it('forwards arbitrary native props', () => {
    const c = render(<TextInput placeholder="host" maxLength={5} inputMode="numeric" />)
    const input = c.querySelector('input')!
    expect(input.placeholder).toBe('host')
    expect(input.maxLength).toBe(5)
    expect(input.getAttribute('inputmode')).toBe('numeric')
  })

  it('Textarea is controlled and honours rows', () => {
    const onChange = vi.fn()
    const c = render(<Textarea value="a" rows={4} onChange={onChange} />)
    const ta = c.querySelector('textarea')!
    expect(ta.value).toBe('a')
    expect(ta.rows).toBe(4)
    typeInto(ta, 'b')
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})

describe('Select', () => {
  const options = [
    { value: 'http', label: 'HTTP' },
    { value: 'socks5', label: 'SOCKS5' },
    { value: 'off', label: 'Disabled', disabled: true },
  ]

  it('renders options, honours the selected value, and reports changes', () => {
    const onChange = vi.fn()
    const c = render(<Select options={options} value="socks5" onChange={onChange} />)
    const select = c.querySelector('select')!
    expect(select.value).toBe('socks5')
    expect(select.querySelectorAll('option')).toHaveLength(3)
    expect((select.querySelectorAll('option')[2] as HTMLOptionElement).disabled).toBe(true)
    selectOption(select, 'http')
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('renders a disabled placeholder option when asked', () => {
    const c = render(<Select options={options} placeholder="Pick one" value="" onChange={() => {}} />)
    const first = c.querySelector('option') as HTMLOptionElement
    expect(first.textContent).toBe('Pick one')
    expect(first.disabled).toBe(true)
    expect(first.value).toBe('')
  })

  it('renders the caret affordance', () => {
    const c = render(<Select options={options} value="http" onChange={() => {}} />)
    expect(c.querySelector(`.${CX}-caret svg`)).not.toBeNull()
  })
})

describe('Checkbox / Switch', () => {
  it('Checkbox is controlled, labelled, and reports changes', () => {
    const onChange = vi.fn()
    const c = render(<Checkbox checked label="Enable proxy" onChange={onChange} />)
    const input = c.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(input.checked).toBe(true)
    expect(c.querySelector('label')!.textContent).toContain('Enable proxy')
    toggle(input)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('Checkbox disabled marks the wrapper and the input', () => {
    const c = render(<Checkbox disabled label="x" />)
    expect(c.querySelector('label')!.className).toContain(`${CX}-check--disabled`)
    expect((c.querySelector('input') as HTMLInputElement).disabled).toBe(true)
  })

  it('Checkbox hides its decorative box from assistive tech', () => {
    const c = render(<Checkbox label="x" />)
    expect(c.querySelector(`.${CX}-check__box`)!.getAttribute('aria-hidden')).toBe('true')
  })

  it('Switch carries role=switch and is controlled', () => {
    const onChange = vi.fn()
    const c = render(<Switch checked={false} label="UA" onChange={onChange} />)
    const input = c.querySelector('input') as HTMLInputElement
    expect(input.getAttribute('role')).toBe('switch')
    expect(input.checked).toBe(false)
    toggle(input)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('Switch disabled marks the wrapper', () => {
    const c = render(<Switch disabled label="x" />)
    expect(c.querySelector('label')!.className).toContain(`${CX}-switch--disabled`)
  })
})

describe('Field / Card / layout', () => {
  it('Field renders label, description and associates htmlFor', () => {
    const c = render(
      <Field label="Host" description="Proxy address" htmlFor="host-input">
        <TextInput id="host-input" />
      </Field>,
    )
    const label = c.querySelector('label')!
    expect(label.textContent).toBe('Host')
    expect(label.getAttribute('for')).toBe('host-input')
    expect(c.querySelector(`.${CX}-field__desc`)!.textContent).toBe('Proxy address')
    expect(c.querySelector(`.${CX}-field__error`)).toBeNull()
  })

  it('Field renders an error with role=alert', () => {
    const c = render(<Field label="Port" error="must be a number"><TextInput /></Field>)
    const err = c.querySelector(`.${CX}-field__error`)!
    expect(err.textContent).toBe('must be a number')
    expect(err.getAttribute('role')).toBe('alert')
  })

  it('Field suppresses a falsy error', () => {
    const c = render(<Field label="x" error={false}><TextInput /></Field>)
    expect(c.querySelector(`.${CX}-field__error`)).toBeNull()
  })

  it('Card renders a title as a heading and hosts children', () => {
    const c = render(<Card title="Network proxy"><span>body</span></Card>)
    expect(c.querySelector('h3')!.textContent).toBe('Network proxy')
    expect(c.querySelector('section')!.textContent).toContain('body')
  })

  it('Card without a title renders no heading', () => {
    const c = render(<Card><span>body</span></Card>)
    expect(c.querySelector('h3')).toBeNull()
  })

  it('Row and Col apply their layout classes and merge className', () => {
    const row = render(<Row className="x"><i /></Row>)
    expect(row.firstElementChild!.className).toContain(`${CX}-row`)
    expect(row.firstElementChild!.className).toContain('x')
    const col = render(<Col><i /></Col>)
    expect(col.firstElementChild!.className).toContain(`${CX}-col`)
  })

  it('Spinner exposes a status role with an accessible name', () => {
    const c = render(<Spinner />)
    const s = c.querySelector('[role="status"]')!
    expect(s.getAttribute('aria-label')).toBe('loading')
    expect(s.className).toContain(`${CX}-spin`)
  })
})

describe('icon set', () => {
  it('every curated name resolves to a component', () => {
    expect(ICON_NAMES.length).toBeGreaterThan(40)
    for (const name of ICON_NAMES) expect(typeof icon(name)).toBe('function')
  })

  it('an unknown name degrades to Help instead of throwing', () => {
    // Deliberately bypass the type to simulate a stale name from data.
    expect(icon('NotAnIcon' as never)).toBe(Icons.Help)
  })

  it('<Icon name> renders svg and forwards size', () => {
    const c = render(<Icon name="Settings" size={22} />)
    const svg = c.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('22')
  })

  it('icons inherit currentColor so they follow the shell theme', () => {
    const c = render(<Icon name="Check" />)
    const html = c.innerHTML
    expect(html).toContain('currentColor')
  })
})
