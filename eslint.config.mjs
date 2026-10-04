// G20.16 (issue #487): focused async/error check for production tools/*.mjs.
// Type-aware rules only — the two defect classes the task names: forgotten
// asynchronous work and empty error handlers. No formatting, no style rules.
//
// The enforced file selection is owned by tools/validate/tools-check.mjs,
// which passes an explicit list; the ignores below only keep a manual
// `npx eslint tools` aligned with it. A file the runner enforces but the
// config ignores is skipped with a warning, not a failure — the guard suite
// asserts the config ignores nothing from the enforced selection.
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
