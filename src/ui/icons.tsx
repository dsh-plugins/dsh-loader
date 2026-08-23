/**
 * The curated dshloader ICON SET.
 *
 * Sourced from `@icon-park/react` so no plugin hand-maintains SVG path data
 * again (dsh-better-sidebar's `src/client/icons.tsx` keeps 10 icons by hand
 * today; every entry here replaces one of those or a
 * `@deepseek-ai/dsh-client-ui-primitives` icon import).
 *
 * WHY A SUBSET, NOT `export *`: IconPark ships ~2000 icons. dshloader's client
 * bundle is materialised through the DSH client module table, and a runtime
 * module boundary cannot be tree-shaken — re-exporting everything would put all
 * ~2000 icons into one bundle every plugin pays for. Naming a subset keeps the
 * cost proportional (only the icons listed here are bundled), and a plugin that
 * needs an exotic glyph can still depend on `@icon-park/react` directly.
 *
 * Adding an icon: import it below and add it to the export block. That is the
 * only change needed — no SVG, no viewBox, no stroke bookkeeping.
 *
 * @module @dsh-plugin/dsh-loader/ui/icons
 */
import * as React from 'react';
import Add from '@icon-park/react/es/icons/Add';
import Alarm from '@icon-park/react/es/icons/Alarm';
import AllApplication from '@icon-park/react/es/icons/AllApplication';
import Attention from '@icon-park/react/es/icons/Attention';
import Back from '@icon-park/react/es/icons/Back';
import Branch from '@icon-park/react/es/icons/Branch';
import Browser from '@icon-park/react/es/icons/Browser';
import Check from '@icon-park/react/es/icons/Check';
import CheckSmall from '@icon-park/react/es/icons/CheckSmall';
import Close from '@icon-park/react/es/icons/Close';
import CloseSmall from '@icon-park/react/es/icons/CloseSmall';
import Code from '@icon-park/react/es/icons/Code';
import Config from '@icon-park/react/es/icons/Config';
import Copy from '@icon-park/react/es/icons/Copy';
import Delete from '@icon-park/react/es/icons/Delete';
import Diamond from '@icon-park/react/es/icons/Diamond';
import Down from '@icon-park/react/es/icons/Down';
import Download from '@icon-park/react/es/icons/Download';
import Edit from '@icon-park/react/es/icons/Edit';
import ErrorIcon from '@icon-park/react/es/icons/Error';
import FileCode from '@icon-park/react/es/icons/FileCode';
import FileText from '@icon-park/react/es/icons/FileText';
import Folder from '@icon-park/react/es/icons/Folder';
import FolderOpen from '@icon-park/react/es/icons/FolderOpen';
import FullScreen from '@icon-park/react/es/icons/FullScreen';
import Globe from '@icon-park/react/es/icons/Globe';
import Help from '@icon-park/react/es/icons/Help';
import Info from '@icon-park/react/es/icons/Info';
import Left from '@icon-park/react/es/icons/Left';
import Link from '@icon-park/react/es/icons/Link';
import Loading from '@icon-park/react/es/icons/Loading';
import Lock from '@icon-park/react/es/icons/Lock';
import More from '@icon-park/react/es/icons/More';
import Pause from '@icon-park/react/es/icons/Pause';
import Play from '@icon-park/react/es/icons/Play';
import PreviewClose from '@icon-park/react/es/icons/PreviewClose';
import PreviewOpen from '@icon-park/react/es/icons/PreviewOpen';
import Redo from '@icon-park/react/es/icons/Redo';
import Refresh from '@icon-park/react/es/icons/Refresh';
import Right from '@icon-park/react/es/icons/Right';
import Save from '@icon-park/react/es/icons/Save';
import Search from '@icon-park/react/es/icons/Search';
import Setting from '@icon-park/react/es/icons/Setting';
import SettingTwo from '@icon-park/react/es/icons/SettingTwo';
import Sort from '@icon-park/react/es/icons/Sort';
import Success from '@icon-park/react/es/icons/Success';
import Terminal from '@icon-park/react/es/icons/Terminal';
import Undo from '@icon-park/react/es/icons/Undo';
import Unlock from '@icon-park/react/es/icons/Unlock';
import Up from '@icon-park/react/es/icons/Up';
import Upload from '@icon-park/react/es/icons/Upload';
import Write from '@icon-park/react/es/icons/Write';
import { IconProvider, DEFAULT_ICON_CONFIGS, type IIconProps, type Theme } from '@icon-park/react/es/runtime';
import { G } from './style.js';

/** Props every dshloader icon accepts (IconPark's own prop contract). */
export type IconProps = IIconProps;

/** An icon component. */
export type IconComponent = (props: IconProps) => React.ReactElement;

/**
 * The curated set, grouped by purpose. Names are intent-based (`Settings`,
 * `Warning`) rather than IconPark's raw names so a glyph can be swapped without
 * touching consumers.
 */
export const Icons = {
  // structure / navigation
  ChevronUp: Up,
  ChevronDown: Down,
  ChevronLeft: Left,
  ChevronRight: Right,
  Back,
  Expand: FullScreen,
  More,
  Sort,
  // actions
  Add,
  Edit,
  Write,
  Delete,
  Copy,
  Save,
  Search,
  Refresh,
  Download,
  Upload,
  Undo,
  Redo,
  Play,
  Stop: Pause,
  Close,
  CloseSmall,
  Check,
  CheckSmall,
  // status
  Info,
  Warning: Attention,
  Error: ErrorIcon,
  Success,
  Loading,
  Help,
  // domain
  Settings: Setting,
  SettingsAlt: SettingTwo,
  Config,
  Terminal,
  Code,
  FileCode,
  Doc: FileText,
  Folder,
  FolderOpen,
  GitBranch: Branch,
  Link,
  Web: Globe,
  Browser,
  Lock,
  Unlock,
  EyeOpen: PreviewOpen,
  EyeClosed: PreviewClose,
  Alarm,
  Diamond,
  Apps: AllApplication,
} as const;

/** Name of a curated icon. */
export type IconName = keyof typeof Icons;

/** Every curated icon name, for pickers and tests. */
export const ICON_NAMES = Object.keys(Icons) as IconName[];

/**
 * Look one icon up by name. Unknown names resolve to `Help` rather than
 * throwing, so a stale name degrades to a visible placeholder.
 */
export function icon(name: IconName): IconComponent {
  return (Icons[name] ?? Icons.Help) as IconComponent;
}

/**
 * `<Icon name="Settings" />` — the ergonomic form for data-driven icon choices
 * (menu descriptors, settings rows) where a component reference is awkward.
 */
export function Icon({ name, ...rest }: { name: IconName } & IconProps): React.ReactElement {
  const Component = icon(name);
  return React.createElement(Component, rest);
}

/** The icon defaults dshloader components render with. */
export const DSH_ICON_CONFIG = {
  ...DEFAULT_ICON_CONFIGS,
  size: G.fontSize + 3,
  strokeWidth: 3,
  theme: 'outline' as Theme,
  // `currentColor` is what makes icons follow DSH's theme tokens: the icon
  // inherits the colour of the text around it instead of pinning a hex value.
  colors: {
    ...DEFAULT_ICON_CONFIGS.colors,
    outline: { fill: 'currentColor', background: 'transparent' },
  },
};

/**
 * Wrap a subtree so every dshloader icon inside inherits the DSH defaults
 * (outline theme, `currentColor` fill, matching size). Plugins that render
 * dshloader components inside their own React tree should mount this once near
 * the root; the components in `./components.js` do not require it, but they look
 * consistent with the rest of DSH when it is present.
 */
export function DshIconProvider({ children }: { children?: React.ReactNode }): React.ReactElement {
  return React.createElement(IconProvider, { value: DSH_ICON_CONFIG }, children);
}

export { IconProvider };
