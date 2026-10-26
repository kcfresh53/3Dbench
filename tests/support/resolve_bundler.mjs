// Node loader that resolves extension-less relative imports (as bundlers do), so TypeScript sources and
// bundler-style packages can be imported directly in tests.  Usage: node --import ./tests/support/resolve_bundler.mjs
import { register } from 'node:module';
register('./resolve_bundler_hook.mjs', import.meta.url);
