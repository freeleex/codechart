import tseslint from 'typescript-eslint';

// Complexity guardrails. The allowlist in src/ is empty: a violation may be allowlisted inline with
// `// eslint-disable-next-line <rule> -- ratchet: <reason>`, but the list may only shrink,
// and stale entries fail lint (reportUnusedDisableDirectives).
export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', '.*/', 'src/render/web/client.ts'] },
  ...tseslint.configs.recommended,
  { linterOptions: { reportUnusedDisableDirectives: 'error' } },
  {
    files: ['src/**/*.ts'],
    rules: {
      complexity: ['error', 20],
      'max-lines-per-function': ['error', { max: 60, skipBlankLines: true, skipComments: true }],
      'max-depth': ['error', 4],
      'max-params': ['error', 6],
      'max-lines': ['error', { max: 250, skipBlankLines: true, skipComments: true }],
      'max-nested-callbacks': ['error', 3],
    },
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      'max-lines': ['error', { max: 650, skipBlankLines: true, skipComments: true }],
    },
  },
);
