// dshloader version — keep in sync with package.json.
export const LOADER_VERSION = '1.3.3';

// Prefix used in every console log / error so users can grep dshloader output.
export const LOG_PREFIX = '[dshloader]';

// Window global the boot-alias injection (src/boot-injection.ts) sets to the
// list of alias module ids it pre-registered with the client module system,
// so installClient (src/client.ts) skips re-registering them (the live module
// system throws on duplicate factory ids).
export const BOOT_ALIAS_IDS_FLAG = '__dshLoaderBootAliases__';
