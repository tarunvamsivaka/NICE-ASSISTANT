/**
 * Nice — CLIP Vision-Language Module
 * Uses Xenova/clip-vit-base-patch32 for semantic image search
 * Lazy-loads models on first use
 */

let textModel = null;
let visionModel = null;
let processor = null;
let tokenizer = null;
let detectionProcessor = null;
let detectionModel = null;

async function loadModels() {
    if (textModel) return;
    const { AutoTokenizer, CLIPTextModelWithProjection, AutoProcessor, CLIPVisionModelWithProjection } = await import('@xenova/transformers');

    tokenizer = await AutoTokenizer.from_pretrained('Xenova/clip-vit-base-patch32');
    textModel = await CLIPTextModelWithProjection.from_pretrained('Xenova/clip-vit-base-patch32', { quantized: true });
    processor = await AutoProcessor.from_pretrained('Xenova/clip-vit-base-patch32');
    visionModel = await CLIPVisionModelWithProjection.from_pretrained('Xenova/clip-vit-base-patch32', { quantized: true });
}

/**
 * Embed a text query into CLIP vector space
 * @param {string} text - Text query
 * @returns {Promise<number[]>} Embedding vector
 */
export async function embedText(text) {
    await loadModels();
    const inputs = await tokenizer(text, { padding: true, truncation: true });
    const output = await textModel(inputs);
    return Array.from(output.text_embeds.data);
}

/**
 * Embed an image into CLIP vector space
 * @param {Blob} imageBlob - Image as a Blob
 * @returns {Promise<number[]>} Embedding vector
 */
export async function embedImage(imageBlob) {
    await loadModels();
    const { RawImage } = await import('@xenova/transformers');
    const image = await RawImage.fromBlob(imageBlob);
    const inputs = await processor(image);
    const output = await visionModel(inputs);
    return Array.from(output.image_embeds.data);
}

async function loadDetectionModels() {
    if (detectionModel) return;
    const { AutoProcessor, AutoModelForObjectDetection } = await import('@xenova/transformers');
    detectionProcessor = await AutoProcessor.from_pretrained('Xenova/detr-resnet-50');
    detectionModel = await AutoModelForObjectDetection.from_pretrained('Xenova/detr-resnet-50', { quantized: true });
}

export async function detectImageLabels(imageBlob, { max = 5, threshold = 0.7 } = {}) {
    try {
        await loadDetectionModels();
        const { RawImage } = await import('@xenova/transformers');
        const image = await RawImage.fromBlob(imageBlob);
        const inputs = await detectionProcessor(image);
        const output = await detectionModel(inputs);
        const scores = Array.from(output.logits.softmax(-1).data);
        const labels = output.logits.shape[1];
        const results = [];
        for (let i = 0; i < scores.length; i += labels) {
            // class scores are last entry? For DETR, last is "no object"; skip near-zero
            let bestScore = -1;
            let bestIdx = -1;
            for (let c = 0; c < labels - 1; c++) {
                const s = scores[i + c];
                if (s > bestScore) { bestScore = s; bestIdx = c; }
            }
            if (bestScore >= threshold && bestIdx >= 0) {
                const label = detectionProcessor.config.id2label?.[bestIdx] || `obj-${bestIdx}`;
                results.push({ label, score: bestScore });
            }
            if (results.length >= max) break;
        }
        return results;
    } catch {
        return [];
    }
}
