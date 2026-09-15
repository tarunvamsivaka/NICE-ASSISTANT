/**
 * Nice — CLIP Vision-Language Web Worker
 * Uses Xenova/clip-vit-base-patch32 for semantic image search
 * Embeds both images and text into a shared vector space
 */

let textModel = null;
let visionModel = null;
let processor = null;
let tokenizer = null;
let loading = false;

async function loadModels() {
    if (textModel || loading) return;
    loading = true;
    try {
        const { AutoTokenizer, CLIPTextModelWithProjection, AutoProcessor, CLIPVisionModelWithProjection, env } = await import('@xenova/transformers');

        // Configure transformers.js for completely offline, local execution
        env.allowLocalModels = true;
        env.allowRemoteModels = false;
        env.localModelPath = '/models/';

        tokenizer = await AutoTokenizer.from_pretrained('Xenova/clip-vit-base-patch32');
        textModel = await CLIPTextModelWithProjection.from_pretrained('Xenova/clip-vit-base-patch32', { quantized: true });
        processor = await AutoProcessor.from_pretrained('Xenova/clip-vit-base-patch32');
        visionModel = await CLIPVisionModelWithProjection.from_pretrained('Xenova/clip-vit-base-patch32', { quantized: true });

        self.postMessage({ type: 'ready' });
    } catch (e) {
        self.postMessage({ type: 'error', error: `Failed to load CLIP model: ${e.message}` });
    }
    loading = false;
}

async function embedText(text, id) {
    if (!textModel || !tokenizer) {
        await loadModels();
        if (!textModel) {
            self.postMessage({ type: 'result', id, error: 'CLIP text model not loaded' });
            return;
        }
    }

    try {
        const inputs = await tokenizer(text, { padding: true, truncation: true });
        const output = await textModel(inputs);
        const vector = Array.from(output.text_embeds.data);
        self.postMessage({ type: 'result', id, vector, mode: 'text' });
    } catch (e) {
        self.postMessage({ type: 'result', id, error: e.message });
    }
}

async function embedImage(imageData, id) {
    if (!visionModel || !processor) {
        await loadModels();
        if (!visionModel) {
            self.postMessage({ type: 'result', id, error: 'CLIP vision model not loaded' });
            return;
        }
    }

    try {
        const { RawImage } = await import('@xenova/transformers');
        const image = await RawImage.fromBlob(new Blob([imageData]));
        const inputs = await processor(image);
        const output = await visionModel(inputs);
        const vector = Array.from(output.image_embeds.data);
        self.postMessage({ type: 'result', id, vector, mode: 'image' });
    } catch (e) {
        self.postMessage({ type: 'result', id, error: e.message });
    }
}

self.onmessage = async (e) => {
    const { type, text, imageData, id } = e.data;
    switch (type) {
        case 'init':
            await loadModels();
            break;
        case 'embedText':
            await embedText(text, id);
            break;
        case 'embedImage':
            await embedImage(imageData, id);
            break;
    }
};
