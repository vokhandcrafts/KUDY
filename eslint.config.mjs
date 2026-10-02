// G20.16 (issue #487): focused async/error check for production tools/*.mjs.
// Type-aware rules only — the two defect classes the task names: forgotten
// asynchronous work and empty error handlers. No formatting, no style rules.
//
// The enforced file selection is owned by tools/validate/tools-check.mjs; the
// ignores below mirror it so a manual `npx eslint tools` sees the same set.
// Drift between the two self-surfaces: a file the runner includes but the
// config ignores fails the manual run, and the reverse fails tools:check.
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // Tests run under node --test with their own conventions; fixtures carry
    // deliberate violations for the negative guard and are linted by it with
    // --no-ignore instead.
    ignores: ['tools/**/*.test.mjs', 'tools/**/fixtures/**'],
  },
  {
    files: ['tools/**/*.mjs'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: 'tsconfig.tools.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      'no-empty': ['error', { allowEmptyCatch: false }],
    },
  }
);
