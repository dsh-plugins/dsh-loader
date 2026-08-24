/**
 * The dshloader BASE CONTROLS.
 *
 * A small, deliberately unopinionated control set so every plugin in this family
 * renders the same design language instead of each hand-rolling inline styles
 * (dsh-network-settings alone carries ~40 inline style objects today, and
 * dsh-auxiliary / dsh-code-review each maintain their own button and input
 * looks).
 *
 * Design rules:
 *  - Styling is ONE injected stylesheet with `dshl-` prefixed classes, tagged
 *    with the DSH `data-plugin` / `data-plugin-css` ownership attributes so HMR
 *    can reclaim it. No CSS Modules, so consumers need no build-time CSS setup.
 *  - Every colour is a DSH token with a fallback (see `./style.js`), so controls
 *    follow the shell's theme, including dark mode, with no JS theme plumbing.
 *  - Icons come from the curated set and inherit `currentColor`.
 *  - Every control forwards native props and `className`, so a plugin can always
 *    escape the defaults without forking the component.
 *
 * @module @dsh-plugin/dsh-loader/ui/components
 */
import * as React from 'react';
import { CX, G, T, cx, injectStyle } from './style.js';
import { Icon, type IconName } from './icons.js';

/** Owner id used on the injected `<style>` tag. */
const OWNER = '@dsh-plugin/dsh-loader';

/** The single stylesheet backing every control. */
const CSS = `
.${CX}-row{display:flex;align-items:center;gap:${G.gap}px}
.${CX}-col{display:flex;flex-direction:column;gap:${G.gap}px}
.${CX}-btn{
  display:inline-flex;align-items:center;justify-content:center;gap:6px;
  height:${G.buttonHeight}px;padding:0 ${G.padXButton}px;
  font-size:14px;font-family:inherit;line-height:22px;
  border-radius:${G.radiusPill}px;border:none;
  background:${T.bgBase};color:${T.labelPrimary};
  cursor:pointer;box-sizing:border-box;white-space:nowrap;
  transition:background .12s ease,border-color .12s ease,opacity .12s ease;
}
.${CX}-btn:hover:not(:disabled){background:${T.bgHover}}
.${CX}-btn:disabled{opacity:.5;cursor:not-allowed}
.${CX}-btn--primary{
  background:${T.buttonPrimaryFill};
  color:${T.buttonPrimaryForeground};
}
.${CX}-btn--primary:hover:not(:disabled){filter:brightness(1.07);background:${T.buttonPrimaryFill}}
.${CX}-btn--ghost{background:transparent;border-color:transparent;color:${T.labelSecondary}}
.${CX}-btn--ghost:hover:not(:disabled){background:${T.bgHover};color:${T.labelPrimary}}
.${CX}-btn--danger{background:transparent;border:1px solid ${T.danger};color:${T.danger};border-radius:${G.radius}px}
.${CX}-btn--sm{height:${G.controlHeightSm}px;padding:0 ${G.padX + 2}px;font-size:${G.fontSizeSm}px;border-radius:${G.radius}px}
.${CX}-iconbtn{
  display:inline-flex;align-items:center;justify-content:center;
  width:${G.controlHeight}px;height:${G.controlHeight}px;padding:0;
  border-radius:${G.radius}px;border:1px solid transparent;
  background:transparent;color:${T.labelSecondary};cursor:pointer;
}
.${CX}-iconbtn:hover:not(:disabled){background:${T.bgHover};color:${T.labelPrimary}}
.${CX}-iconbtn:disabled{opacity:.5;cursor:not-allowed}
.${CX}-input,.${CX}-textarea,.${CX}-select{
  width:100%;box-sizing:border-box;font-family:inherit;font-size:${G.fontSize}px;
  color:${T.labelPrimary};background:${T.bgLayer1};
  border:1px solid ${T.border};border-radius:${G.radius}px;
  padding:0 ${G.padX}px;height:${G.controlHeight}px;
  transition:border-color .12s ease;
}
.${CX}-textarea{height:auto;min-height:72px;padding:7px ${G.padX}px;line-height:1.5;resize:vertical}
.${CX}-input:focus,.${CX}-textarea:focus,.${CX}-select:focus{outline:none;border-color:${T.accent}}
.${CX}-input:disabled,.${CX}-textarea:disabled,.${CX}-select:disabled{opacity:.55;cursor:not-allowed}
.${CX}-input--mono,.${CX}-textarea--mono{font-family:${T.fontCode}}
.${CX}-input--invalid,.${CX}-textarea--invalid{border-color:${T.danger}}
.${CX}-select{appearance:none;padding-right:26px;cursor:pointer;background-color:${T.bgBase}}
.${CX}-selectwrap{position:relative;display:block;width:100%}
.${CX}-selectwrap>.${CX}-caret{
  position:absolute;right:8px;top:50%;transform:translateY(-50%);
  pointer-events:none;color:${T.labelTertiary};display:inline-flex;
}
.${CX}-check{display:inline-flex;align-items:center;gap:7px;cursor:pointer;font-size:13px;color:${T.labelPrimary};line-height:20px}
.${CX}-check input{
  position:relative;margin:0;width:16px;height:16px;flex:none;
  appearance:auto;-webkit-appearance:checkbox;cursor:pointer;
  accent-color:${T.accent};
}
.${CX}-check input[disabled]{cursor:not-allowed}
.${CX}-check--disabled{opacity:.55;cursor:not-allowed}
.${CX}-switch{display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-size:${G.fontSize}px;color:${T.labelPrimary}}
.${CX}-switch input{position:absolute;opacity:0;width:0;height:0}
.${CX}-switch__track{
  position:relative;flex:none;width:34px;height:20px;border-radius:${G.radiusPill}px;
  background:${T.border};transition:background .16s ease;
}
.${CX}-switch__knob{
  position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;
  background:${T.bgBase};box-shadow:0 1px 2px rgba(0,0,0,.2);transition:transform .16s ease;
}
.${CX}-switch input:checked+.${CX}-switch__track{background:${T.accent}}
.${CX}-switch input:checked+.${CX}-switch__track>.${CX}-switch__knob{transform:translateX(14px)}
.${CX}-switch input:focus-visible+.${CX}-switch__track{box-shadow:0 0 0 2px ${T.accent}55}
.${CX}-switch--disabled{opacity:.55;cursor:not-allowed}
.${CX}-field{display:flex;flex-direction:column;gap:6px}
.${CX}-field__label{font-size:12px;font-weight:500;color:${T.labelSecondary};line-height:18px}
.${CX}-field__desc{font-size:${G.fontSizeSm}px;color:${T.labelTertiary};line-height:18px}
.${CX}-field__error{font-size:${G.fontSizeSm}px;color:${T.danger}}
.${CX}-card{
  display:flex;flex-direction:column;gap:10px;
  padding:16px;border:1px solid ${T.border};border-radius:${G.cardRadius}px;
  background:transparent;box-sizing:border-box;
}
.${CX}-card__title{margin:0;font-size:15px;font-weight:500;line-height:22px;color:${T.labelPrimary}}
.${CX}-spin{display:inline-flex;animation:${CX}-spin 1s linear infinite}
@keyframes ${CX}-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){
  .${CX}-spin{animation:none}
  .${CX}-btn,.${CX}-input,.${CX}-switch__track,.${CX}-switch__knob,.${CX}-check__box{transition:none}
}
`;

/** Inject the control stylesheet once (idempotent, safe to call from any component). */
export function ensureStyles(): void {
  injectStyle(OWNER, 'ui/controls.css', CSS);
}

/** Call `ensureStyles` on first render of any control. */
function useStyles(): void {
  // Runs during render on purpose: the stylesheet must exist before first paint,
  // and `injectStyle` is idempotent so repeated calls are free.
  ensureStyles();
}

/* ────────────────────────────── Button ────────────────────────────── */

/** Visual weight of a {@link Button}. */
export type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger';

/** {@link Button} props. */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Compact height. */
  small?: boolean;
  /** Leading icon from the curated set. */
  icon?: IconName;
  /** Replace the label with a spinner and disable interaction. */
  loading?: boolean;
}

/** A button in the DSH design language. */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', small, icon, loading, className, children, disabled, ...rest },
  ref,
) {
  useStyles();
  return React.createElement(
    'button',
    {
      ref,
      type: rest.type ?? 'button',
      className: cx(
        `${CX}-btn`,
        variant !== 'default' && `${CX}-btn--${variant}`,
        small && `${CX}-btn--sm`,
        className,
      ),
      disabled: disabled === true || loading === true,
      ...rest,
    },
    loading === true
      ? React.createElement('span', { className: `${CX}-spin`, key: 'spin' }, React.createElement(Icon, { name: 'Loading' }))
      : icon !== undefined
        ? React.createElement(Icon, { name: icon, key: 'icon' })
        : null,
    children,
  );
});

/** {@link IconButton} props. */
export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Icon from the curated set. */
  icon: IconName;
  /** Accessible name — required, since the button has no visible text. */
  label: string;
}

/** A square icon-only button. `label` becomes its accessible name. */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, className, ...rest },
  ref,
) {
  useStyles();
  return React.createElement(
    'button',
    {
      ref,
      type: rest.type ?? 'button',
      className: cx(`${CX}-iconbtn`, className),
      'aria-label': label,
      title: rest.title ?? label,
      ...rest,
    },
    React.createElement(Icon, { name: icon }),
  );
});

/* ────────────────────────────── Inputs ────────────────────────────── */

/** {@link TextInput} props. */
export interface TextInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Render with the monospace stack (paths, commands, tokens). */
  mono?: boolean;
  /** Mark the field as failing validation. */
  invalid?: boolean;
}

/** A single-line text input. */
export const TextInput = React.forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { mono, invalid, className, ...rest },
  ref,
) {
  useStyles();
  return React.createElement('input', {
    ref,
    type: rest.type ?? 'text',
    className: cx(`${CX}-input`, mono && `${CX}-input--mono`, invalid && `${CX}-input--invalid`, className),
    'aria-invalid': invalid === true ? true : undefined,
    ...rest,
  });
});

/** {@link Textarea} props. */
export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  mono?: boolean;
  invalid?: boolean;
}

/** A multi-line text area. */
export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { mono, invalid, className, ...rest },
  ref,
) {
  useStyles();
  return React.createElement('textarea', {
    ref,
    className: cx(`${CX}-textarea`, mono && `${CX}-textarea--mono`, invalid && `${CX}-textarea--invalid`, className),
    'aria-invalid': invalid === true ? true : undefined,
    ...rest,
  });
});

/* ────────────────────────────── Select ────────────────────────────── */

/** One option of a {@link Select}. */
export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/** {@link Select} props. */
export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  options: readonly SelectOption[];
  /** Optional leading placeholder rendered as a disabled empty option. */
  placeholder?: string;
}

/**
 * A dropdown built on the native `<select>`.
 *
 * Native on purpose: it inherits the platform's keyboard handling, mobile
 * pickers, and accessibility for free. Plugins needing DSH's rich popup should
 * use `Menu` from `@dsh-plugin/dsh-loader/ui-primitives` instead.
 */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { options, placeholder, className, value, ...rest },
  ref,
) {
  useStyles();
  return React.createElement(
    'span',
    { className: `${CX}-selectwrap` },
    React.createElement(
      'select',
      { ref, className: cx(`${CX}-select`, className), value, ...rest },
      placeholder !== undefined
        ? React.createElement('option', { key: '__ph', value: '', disabled: true }, placeholder)
        : null,
      options.map(option =>
        React.createElement('option', { key: option.value, value: option.value, disabled: option.disabled }, option.label),
      ),
    ),
    React.createElement('span', { className: `${CX}-caret` }, React.createElement(Icon, { name: 'ChevronDown' })),
  );
});

/* ──────────────────────── Checkbox / Switch ───────────────────────── */

/** {@link Checkbox} props. */
export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Text beside the box. */
  label?: React.ReactNode;
}

/** A checkbox with an optional label. Native input styled via `accent-color`,
 *  matching the shell's own settings pages. */
export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, className, disabled, ...rest },
  ref,
) {
  useStyles();
  return React.createElement(
    'label',
    { className: cx(`${CX}-check`, disabled === true && `${CX}-check--disabled`, className) },
    React.createElement('input', { ref, type: 'checkbox', disabled, ...rest }),
    label === undefined ? null : React.createElement('span', null, label),
  );
});

/** {@link Switch} props. */
export interface SwitchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: React.ReactNode;
}

/** A toggle switch — use for "applies immediately" settings. */
export const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(function Switch(
  { label, className, disabled, ...rest },
  ref,
) {
  useStyles();
  return React.createElement(
    'label',
    { className: cx(`${CX}-switch`, disabled === true && `${CX}-switch--disabled`, className) },
    React.createElement('input', { ref, type: 'checkbox', role: 'switch', disabled, ...rest }),
    React.createElement(
      'span',
      { className: `${CX}-switch__track`, 'aria-hidden': true },
      React.createElement('span', { className: `${CX}-switch__knob` }),
    ),
    label === undefined ? null : React.createElement('span', null, label),
  );
});

/* ─────────────────────── Layout / composition ─────────────────────── */

/** {@link Field} props. */
export interface FieldProps {
  label?: React.ReactNode;
  /** Supporting description under the control. */
  description?: React.ReactNode;
  /** Validation message; renders in the danger colour. */
  error?: React.ReactNode;
  /** Associates the label with the control. */
  htmlFor?: string;
  children?: React.ReactNode;
  className?: string;
}

/** Label + control + description/error, the standard settings row. */
export function Field({ label, description, error, htmlFor, children, className }: FieldProps): React.ReactElement {
  useStyles();
  return React.createElement(
    'div',
    { className: cx(`${CX}-field`, className) },
    label === undefined ? null : React.createElement('label', { className: `${CX}-field__label`, htmlFor }, label),
    children,
    description === undefined ? null : React.createElement('span', { className: `${CX}-field__desc` }, description),
    error === undefined || error === null || error === false
      ? null
      : React.createElement('span', { className: `${CX}-field__error`, role: 'alert' }, error),
  );
}

/** {@link Card} props. */
export interface CardProps {
  title?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

/** A bordered section container — the settings-page card look. */
export function Card({ title, children, className }: CardProps): React.ReactElement {
  useStyles();
  return React.createElement(
    'section',
    { className: cx(`${CX}-card`, className) },
    title === undefined ? null : React.createElement('h3', { className: `${CX}-card__title` }, title),
    children,
  );
}

/** A horizontal flex row with the standard gap. */
export function Row({ children, className }: { children?: React.ReactNode; className?: string }): React.ReactElement {
  useStyles();
  return React.createElement('div', { className: cx(`${CX}-row`, className) }, children);
}

/** A vertical flex column with the standard gap. */
export function Col({ children, className }: { children?: React.ReactNode; className?: string }): React.ReactElement {
  useStyles();
  return React.createElement('div', { className: cx(`${CX}-col`, className) }, children);
}

/** An inline spinner. */
export function Spinner({ size }: { size?: number }): React.ReactElement {
  useStyles();
  return React.createElement(
    'span',
    { className: `${CX}-spin`, role: 'status', 'aria-label': 'loading' },
    React.createElement(Icon, { name: 'Loading', size }),
  );
}
