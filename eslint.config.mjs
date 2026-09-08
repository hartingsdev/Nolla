import { base, domainBoundary } from './packages/config/eslint.base.mjs';
import reactHooks from 'eslint-plugin-react-hooks';
import i18next from 'eslint-plugin-i18next';

/** Client rules: hooks discipline and no untranslated UI text (D10, NFR-8). */
const mobile = {
  files: ['apps/mobile/**/*.{ts,tsx}'],
  plugins: { 'react-hooks': reactHooks, i18next },
  rules: {
    ...reactHooks.configs.recommended.rules,
    'i18next/no-literal-string': ['error', { mode: 'jsx-text-only' }],
  },
};

export default [...base, domainBoundary, mobile, { ignores: ['apps/mobile/dist/**', 'apps/mobile/.expo/**'] }];
