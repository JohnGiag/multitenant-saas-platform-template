import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import { defineConfig, globalIgnores } from 'eslint/config';

// core-web-vitals includes eslint-plugin-jsx-a11y (WCAG checks on JSX).
export default defineConfig([...nextVitals, ...nextTs, globalIgnores(['.next/**', '.next-e2e/**', 'next-env.d.ts'])]);
