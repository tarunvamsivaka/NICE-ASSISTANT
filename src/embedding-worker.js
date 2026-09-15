/**
 * Nice — Semantic Embedding Web Worker
 * Runs Xenova/all-MiniLM-L6-v2 for text embeddings (384-dim vectors)
 * Used for semantic search alongside BM25
 */

let pipeline = null;
let loading = false;

async function loadModel() {
    if (pipeline || loading) return;
    loading = true;
    try {
        const { pipeline: createPipeline, env } = await import('@xenova/transformers');

        // Configure transformers.js for completely offline, local execution
        env.allowLocalModels = true;
        env.allowRemoteModels = false;
        env.localModelPath = '/models/';

        pipeline = await createPipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
            quantized: true,
        });
        self.postMessage({ type: 'ready' });
    } catch (e) {
        self.postMessage({ type: 'error', error: `Failed to load embedding model: ${e.message}` });
    }
    loading = false;
}

async function embed(text, id) {
    if (!pipeline) {
        await loadModel();
        if (!pipeline) {
            self.postMessage({ type: 'result', id, error: 'Model not loaded' });
            return;
        }
    }

    try {
        // Truncate to ~256 tokens (~1200 chars) for performance
        const truncated = text.substring(0, 1200);
        const output = await pipeline(truncated, { pooling: 'mean', normalize: true });
        const vector = Array.from(output.data);
        self.postMessage({ type: 'result', id, vector });
    } catch (e) {
        self.postMessage({ type: 'result', id, error: e.message });
    }
}

self.onmessage = async (e) => {
    const { type, text, id } = e.data;
    switch (type) {
        case 'init':
            await loadModel();
            break;
        case 'embed':
            await embed(text, id);
            break;
    }
};
