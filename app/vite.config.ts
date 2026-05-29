import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// The CSP meta in index.html keeps 'unsafe-eval' for the dev server (Vite HMR /
// React Fast Refresh need it). The production bundle is plain ESM and never
// evals, so we strip 'unsafe-eval' from the shipped index.html. apply:'build'
// means this runs only for `vite build`, leaving the dev CSP untouched.
function stripUnsafeEvalInProd() {
    return {
        name: 'voixify-strip-unsafe-eval',
        apply: 'build' as const,
        transformIndexHtml(html: string) {
            return html.replace(/\s*'unsafe-eval'/g, '');
        },
    };
}

export default defineConfig({
    plugins: [react(), stripUnsafeEvalInProd()],
    base: './',
    build: {
        outDir: 'dist',
        emptyOutDir: true,
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    server: {
        port: 5173,
        strictPort: true,
    },
});
