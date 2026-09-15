import { defineConfig } from 'vite';

export default defineConfig({
    worker: {
        // Required for module workers used by embedding/whisper pipelines.
        format: 'es',
    },
    build: {
        // Production optimizations
        minify: false,
        target: 'es2020',
        sourcemap: false,
        // ML bundles are intentionally large in offline-first mode.
        chunkSizeWarningLimit: 2200,
        // Strip console.log/warn in production
        esbuild: {
            drop: ['debugger'],
            pure: ['console.log'], // Keep console.warn/error for debugging APK issues
        },
        // Chunk splitting for optimal loading
        rollupOptions: {
            onwarn(warning, warn) {
                if (warning?.code === 'EVAL' && String(warning?.id || '').includes('onnxruntime-web')) {
                    // Third-party bundle warning; tracked upstream in onnxruntime-web.
                    return;
                }
                warn(warning);
            },
            output: {
                manualChunks: {
                    pdf: ['pdfjs-dist'],
                    ml_core: ['@xenova/transformers', 'onnxruntime-web'],
                    ocr: ['tesseract.js'],
                },
            },
        },
    },
    // Dev server config
    server: {
        host: true,
        port: 5173,
    },
});
