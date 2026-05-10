import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: ['./src/__tests__/setup.ts'],
        // The .cjs WebM-repair helper is loaded via require() in tests.
        // Vite normally rejects unknown CJS extensions; whitelist it here.
        server: {
            deps: { inline: [/\.cjs$/] },
        },
        // The Electron renderer never imports `electron`/`fs`/etc., so we
        // don't need any aliasing.
        include: ['src/**/*.{test,spec}.{ts,tsx}', 'lib/**/*.{test,spec}.{ts,tsx,js}'],
    },
});
