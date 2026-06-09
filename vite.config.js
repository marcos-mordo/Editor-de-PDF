import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import path from 'node:path';
import fs from 'node:fs';
/**
 * Copies electron/preload.cjs to dist-electron/preload.cjs verbatim.
 * The preload is intentionally NOT bundled to avoid Vite/Rollup producing
 * a mixed ESM/CJS file that Electron cannot load.
 */
function copyPreloadPlugin() {
    function copy() {
        var src = path.resolve(__dirname, 'electron/preload.cjs');
        var dest = path.resolve(__dirname, 'dist-electron/preload.cjs');
        if (!fs.existsSync(src))
            return;
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
        console.log("[copy-preload] ".concat(src, " -> ").concat(dest));
    }
    return {
        name: 'copy-preload-cjs',
        apply: function () { return true; },
        buildStart: function () {
            copy();
        },
        closeBundle: function () {
            copy();
        },
    };
}
export default defineConfig({
    resolve: {
        alias: {
            '@': path.resolve(__dirname, 'src'),
        },
    },
    plugins: [
        react(),
        copyPreloadPlugin(),
        electron([
            {
                entry: 'electron/main.ts',
                onstart: function (args) {
                    args.startup();
                },
                vite: {
                    build: {
                        outDir: 'dist-electron',
                        emptyOutDir: false,
                        rollupOptions: {
                            external: ['electron'],
                        },
                    },
                },
            },
        ]),
        renderer(),
    ],
    optimizeDeps: {
        exclude: ['pdfjs-dist'],
    },
    worker: {
        format: 'es',
    },
    build: {
        outDir: 'dist',
        rollupOptions: {
            output: {
                manualChunks: {
                    'pdf-vendor': ['pdf-lib', 'pdfjs-dist'],
                    'ocr-vendor': ['tesseract.js'],
                },
            },
        },
    },
    server: {
        port: 5173,
        strictPort: true,
    },
});
