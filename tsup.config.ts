import { defineConfig } from 'tsup';

export default defineConfig([
  // Paquets npm : ESM + CommonJS + types, pour le navigateur et pour Node.js.
  {
    entry: { index: 'src/index.ts', server: 'src/server.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    target: 'es2020',
    sourcemap: true,
  },
  // Script CDN : <script src="https://js.fomapay.cd/v1/fomapay.js"> expose `window.FomaPay`.
  {
    entry: { fomapay: 'src/index.ts' },
    format: ['iife'],
    globalName: 'FomaPaySDK',
    outExtension: () => ({ js: '.js' }),
    minify: true,
    target: 'es2019',
    footer: { js: 'window.FomaPay=FomaPaySDK.FomaPay;window.FomaPayError=FomaPaySDK.FomaPayError;' },
  },
]);
