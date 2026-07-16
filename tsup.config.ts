import {defineConfig} from 'tsup'

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      'eslint-plugin': 'src/eslint-plugin/index.ts',
      confusables: 'src/confusables/index.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    treeshake: true,
  },
  {
    // The CLI is only ever run as a binary (`unicode-shield <command>`),
    // never imported, so it gets its own build step with no .d.ts and no
    // CJS output. `clean: false` because the config above already cleared
    // dist/ once; both configs writing into the same directory is fine.
    entry: {cli: 'src/cli/index.ts'},
    format: ['esm'],
    dts: false,
    sourcemap: true,
    clean: false,
    treeshake: true,
  },
])
