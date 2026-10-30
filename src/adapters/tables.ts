export const hostPackageAliases: Record<string, string> = {
  '@dsh-plugin/dsh-loader/tools': '@deepseek-ai/dsh-tools',
  '@dsh-plugin/dsh-loader/llm': '@deepseek-ai/dsh-llm',
  '@dsh-plugin/dsh-loader/agent': '@deepseek-ai/dsh-agent',
  '@dsh-plugin/dsh-loader/settings': '@deepseek-ai/dsh-settings',
  '@dsh-plugin/dsh-loader/timeout': '@deepseek-ai/dsh-timeout',
  '@dsh-plugin/dsh-loader/subagent': '@deepseek-ai/dsh-subagent',
  '@dsh-plugin/dsh-loader/credentials': '@deepseek-ai/dsh-credentials',
  '@dsh-plugin/dsh-loader/compaction-basic': '@deepseek-ai/dsh-compaction-basic',
};

// Client-side deep-import module aliases (registered as module-table alias
// factories): deep source imports that break when dsh ships no `src/`
// (fix 1), plus the stable module name form (design.md §3.3.3).
export const clientModuleAliases: Record<string, string> = {
  '@deepseek-ai/dsh-client-runtime/src/client/sessions/context-provenance.ts':
    '@dsh-plugin/dsh-loader/client',
  'dsh/runtime/context-provenance': '@dsh-plugin/dsh-loader/client',
};

// Client-side stable package names → real dsh package names for dsh 1.x.
// Plugins import from @dsh-plugin/dsh-loader/* subpaths (e.g.
// '@dsh-plugin/dsh-loader/ui-primitives'); the boot-alias injection
// (src/boot-injection.ts) pre-registers an alias factory per entry before
// any client entry materializes, and the apply-time __ModuleLoader__ load
// wrapper (installClient) covers late arrivals. When dsh renames a package,
// only this table changes — plugin source and bundle stay the same.
//
// The table ALSO accepts old-real-name → new-real-name entries as a
// transition measure for plugin bundles built before adopting stable names.
export const clientPackageAliases: Record<string, string> = {
  // Client UI component libraries
  '@dsh-plugin/dsh-loader/ui-primitives': '@deepseek-ai/dsh-client-ui-primitives',
  '@dsh-plugin/dsh-loader/ui-slots': '@deepseek-ai/dsh-client-ui-slots',
  '@dsh-plugin/dsh-loader/web-react': '@dsh-plugin/dsh-loader/client',
  '@dsh-plugin/dsh-loader/schema-form': '@dsh-plugin/dsh-loader/client',
  '@dsh-plugin/dsh-loader/ui-settings': '@deepseek-ai/dsh-client-ui-settings/client',
  // Client runtime
  '@dsh-plugin/dsh-loader/runtime': '@dsh-plugin/dsh-loader/client',
};
