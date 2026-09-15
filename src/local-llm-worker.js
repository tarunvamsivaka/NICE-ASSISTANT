/**
 * Nice - Local LLM Answer Worker
 * Uses a quantized local T5 model to synthesize answers from retrieved file evidence.
 */

let generator = null;
let loading = false;

const MODEL_ID = 'Xenova/flan-t5-small';
const DEFAULT_MAX_NEW_TOKENS = 160;
const MAX_CONTEXT_CHARS = 2800;

function buildPrompt(question, context) {
    const safeQuestion = String(question || '').trim();
    const safeContext = String(context || '').trim().slice(0, MAX_CONTEXT_CHARS);

    return [
        'You are Nice, an offline assistant.',
        'Answer only from the given local context.',
        'If context is insufficient, say you could not find enough evidence in local files.',
        `Question: ${safeQuestion}`,
        'Context:',
        safeContext,
        'Answer:',
    ].join('\n');
}

async function loadModel() {
    if (generator || loading) return;
    loading = true;
    try {
        const { pipeline, env } = await import('@xenova/transformers');
        env.allowLocalModels = true;
        env.allowRemoteModels = false;
        env.localModelPath = '/models/';

        generator = await pipeline('text2text-generation', MODEL_ID, {
            quantized: true,
        });
        self.postMessage({ type: 'ready' });
    } catch (error) {
        self.postMessage({
            type: 'error',
            error: `Failed to load local LLM model (${MODEL_ID}): ${error?.message || error}`,
        });
    }
    loading = false;
}

async function generateAnswer(payload) {
    const id = Number(payload?.id);
    const question = String(payload?.question || '').trim();
    const context = String(payload?.context || '').trim();
    const maxNewTokens = Math.max(48, Math.min(220, Number(payload?.maxNewTokens) || DEFAULT_MAX_NEW_TOKENS));

    if (!id || !question) {
        self.postMessage({ type: 'result', id, error: 'Invalid generate payload' });
        return;
    }

    if (!generator) {
        await loadModel();
        if (!generator) {
            self.postMessage({ type: 'result', id, error: 'Local LLM model is unavailable' });
            return;
        }
    }

    try {
        const prompt = buildPrompt(question, context);
        const output = await generator(prompt, {
            max_new_tokens: maxNewTokens,
            do_sample: false,
            temperature: 0.2,
            top_p: 0.92,
            repetition_penalty: 1.05,
        });

        let text = '';
        if (Array.isArray(output) && output.length > 0) {
            text = String(output[0]?.generated_text || output[0]?.summary_text || '').trim();
        } else {
            text = String(output?.generated_text || output?.summary_text || '').trim();
        }

        if (!text) {
            self.postMessage({ type: 'result', id, error: 'Local LLM produced an empty response' });
            return;
        }

        self.postMessage({ type: 'result', id, text });
    } catch (error) {
        self.postMessage({ type: 'result', id, error: error?.message || 'Local LLM generation failed' });
    }
}

self.onmessage = async (event) => {
    const payload = event?.data || {};
    switch (payload.type) {
        case 'init':
            await loadModel();
            break;
        case 'generate':
            await generateAnswer(payload);
            break;
        default:
            break;
    }
};

