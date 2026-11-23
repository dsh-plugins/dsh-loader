/** Browser-safe metadata: each patch owns its own selection and breakpoints. */
export interface PatchMetadata {
  id: string;
  patch: string;
  moduleAliases: Record<string, string>;
  packageAliases: Record<string, string>;
  configUI(version: string): 'settings' | 'plugins';
  /** Native WebServer verifies the browser peer before dispatch. */
  auth?: 'native-route';
  settingsModel: 'namespaces' | 'forms';
  removedExports(version: string): Record<string, string[]>;
  /** The section the shell facade reads: its local executor packages and the executor seam. */
  shell: ShellMetadata;
}

/** The local executor package name per platform. */
export interface ShellLocalPackages {
  windows: string;
  posix: string;
}

/** The host executor seam: 0.1.5/0.1.6 expose `run`/`start`, 0.1.7 on exposes `execute`. */
export type ShellSeam = 'run-start' | 'execute';

/** One patch's shell metadata; the facade dispatches on `seam` and never on a version number. */
export interface ShellMetadata {
  localPackage: ShellLocalPackages;
  seam: ShellSeam;
}

/**
 * The local executor package names.
 *
 * Both patch generations use the same pair of packages and differ only in the
 * seam; keeping them here gives the platform-to-package mapping a single home,
 * which the facade's no-metadata default also reuses.
 */
export const SHELL_LOCAL_PACKAGES: ShellLocalPackages = {
  windows: '@deepseek-ai/dsh-pwsh-local',
  posix: '@deepseek-ai/dsh-bash-local',
};
