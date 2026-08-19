#!/usr/bin/env node
// dshloader CLI entry (M6). Subcommands: setup, dump-config, info.
import { setupProfile, dumpConfig, info } from '../src/setup.mjs';

const [cmd, ...rest] = process.argv.slice(2);

function usage() {
  console.log(`dshloader <command> [args]

Commands:
  setup <profile>        Inject dshloader into a profile (dependency + patch).
  dump-config <profile>  Run \`dsh --profile <name> --dump-config\` to validate.
  info [profile]         Print dshloader version, detected dsh version, adapter.`);
}

try {
  switch (cmd) {
    case 'setup': {
      const profile = rest[0];
      if (!profile) throw new Error('setup requires a profile name');
      setupProfile(profile);
      break;
    }
    case 'dump-config': {
      const profile = rest[0];
      if (!profile) throw new Error('dump-config requires a profile name');
      const { ok, output } = dumpConfig(profile);
      process.stdout.write(output);
      process.exit(ok ? 0 : 1);
    }
    case 'info': {
      info(rest[0]);
      break;
    }
    default:
      usage();
      process.exit(cmd ? 1 : 0);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
