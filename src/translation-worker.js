/**
 * Nice — Offline Translation Web Worker
 * Uses Xenova/nllb-200-distilled-600M for on-device translation
 */

let translator = null;
let loading = false;

// Language code mapping (user-friendly name → NLLB code)
const LANG_CODES = {
    english: 'eng_Latn', spanish: 'spa_Latn', french: 'fra_Latn',
    german: 'deu_Latn', italian: 'ita_Latn', portuguese: 'por_Latn',
    dutch: 'nld_Latn', russian: 'rus_Cyrl', chinese: 'zho_Hans',
    japanese: 'jpn_Jpan', korean: 'kor_Hang', arabic: 'arb_Arab',
    hindi: 'hin_Deva', bengali: 'ben_Beng', tamil: 'tam_Taml',
    telugu: 'tel_Telu', urdu: 'urd_Arab', turkish: 'tur_Latn',
    thai: 'tha_Thai', vietnamese: 'vie_Latn', polish: 'pol_Latn',
    swedish: 'swe_Latn', danish: 'dan_Latn', norwegian: 'nob_Latn',
    finnish: 'fin_Latn', greek: 'ell_Grek', czech: 'ces_Latn',
    romanian: 'ron_Latn', hungarian: 'hun_Latn', indonesian: 'ind_Latn',
    malay: 'zsm_Latn', swahili: 'swh_Latn', hebrew: 'heb_Hebr',
    marathi: 'mar_Deva', gujarati: 'guj_Gujr', kannada: 'kan_Knda',
    malayalam: 'mal_Mlym', punjabi: 'pan_Guru', nepali: 'npi_Deva',
};

function resolveLangCode(langName) {
    const key = langName.toLowerCase().trim();
    return LANG_CODES[key] || key; // Pass through if already a code
}

async function loadModel() {
    if (translator || loading) return;
    loading = true;
    try {
        const { pipeline, env } = await import('@xenova/transformers');

        // Configure transformers.js for completely offline, local execution
        env.allowLocalModels = true;
        env.allowRemoteModels = false;
        env.localModelPath = '/models/';

        translator = await pipeline('translation', 'Xenova/nllb-200-distilled-600M', {
            quantized: true,
        });
        self.postMessage({ type: 'ready' });
    } catch (e) {
        self.postMessage({ type: 'error', error: `Failed to load translation model: ${e.message}` });
    }
    loading = false;
}

async function translate(text, targetLang, srcLang, id) {
    if (!translator) {
        await loadModel();
        if (!translator) {
            self.postMessage({ type: 'result', id, error: 'Translation model not loaded' });
            return;
        }
    }

    try {
        const tgtCode = resolveLangCode(targetLang);
        const srcCode = srcLang ? resolveLangCode(srcLang) : 'eng_Latn';

        // Chunk long text (NLLB works best with <512 tokens)
        const chunks = [];
        const maxChunkLen = 800;
        for (let i = 0; i < text.length; i += maxChunkLen) {
            chunks.push(text.substring(i, i + maxChunkLen));
        }

        const results = [];
        for (const chunk of chunks) {
            const output = await translator(chunk, {
                src_lang: srcCode,
                tgt_lang: tgtCode,
            });
            results.push(output[0]?.translation_text || chunk);
        }

        self.postMessage({ type: 'result', id, translation: results.join(' ') });
    } catch (e) {
        self.postMessage({ type: 'result', id, error: e.message });
    }
}

self.onmessage = async (e) => {
    const { type, text, targetLang, srcLang, id } = e.data;
    switch (type) {
        case 'init':
            await loadModel();
            break;
        case 'translate':
            await translate(text, targetLang, srcLang, id);
            break;
    }
};
