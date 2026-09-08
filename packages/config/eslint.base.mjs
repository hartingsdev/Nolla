import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** Packages allowed to be imported from inside packages/domain. Nothing else. */
const DOMAIN_ALLOWED = ['@vst/contracts'];

/** Anything that would make the domain impure or vendor-bound. */
const DOMAIN_FORBIDDEN_PATTERNS = [
  // frameworks / runtimes
  'hono', 'hono/*', 'fastify', 'express', 'react', 'react/*', 'react-native', 'expo', 'expo-*', '@expo/*',
  // persistence
  'drizzle-orm', 'drizzle-orm/*', 'pg', 'postgres', '@prisma/*', 'kysely',
  // vendor SDKs
  '@aws-sdk/*', 'aws-sdk', '@sentry/*', 'nodemailer', 'expo-server-sdk', 'firebase*', '@supabase/*',
  // Node built-ins: the domain has no I/O
  'node:*', 'fs', 'path', 'crypto', 'http', 'https', 'net', 'os', 'child_process',
];

export const base = tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: { parserOptions: { projectService: true } },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
    },
  },
  {
    // Plain-JS scripts and config files are not part of a tsconfig project.
    files: ['**/*.mjs', '**/*.cjs', '**/*.js'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      globals: { process: 'readonly', console: 'readonly', URL: 'readonly' },
    },
  },
  {
    // Tests may use `!` on values they just constructed.
    files: ['**/*.test.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  { ignores: ['**/dist/**', '**/node_modules/**', '**/*.config.*'] },
);

/** Extra rules that only apply inside packages/domain (NFR-14 c). */
export const domainBoundary = {
  files: ['packages/domain/src/**/*.ts'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [{
        group: DOMAIN_FORBIDDEN_PATTERNS,
        message: 'packages/domain is pure: no framework, ORM, vendor SDK or Node I/O imports (architecture.md §3).',
      }],
    }],
    // Time and randomness come in through ports, never ambiently.
    'no-restricted-syntax': ['error',
      { selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']", message: 'Use the Clock port.' },
      { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: 'Use the Clock port.' },
      { selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']", message: 'Use the IdGen port.' },
      { selector: "CallExpression[callee.name='parseFloat']", message: 'No floats in money code (P6).' },
      { selector: "CallExpression[callee.name='Number']", message: 'No floats in money code (P6).' },
    ],
  },
};

export const domainAllowedImports = DOMAIN_ALLOWED;
