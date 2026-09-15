/**
 * Nice — Offline Translation Module
 * Uses Xenova/nllb-200-distilled-600M for on-device translation
 * Lazy-loads the model on first use
 */

let translator = null;

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
    return LANG_CODES[key] || key;
}

async function loadModel() {
    if (translator) return translator;
    const { pipeline } = await import('@xenova/transformers');
    translator = await pipeline('translation', 'Xenova/nllb-200-distilled-600M', {
        quantized: true,
    });
    return translator;
}

/**
 * Translate text to a target language
 * @param {string} text - Text to translate
 * @param {string} targetLang - Target language name (e.g., "spanish", "french")
 * @param {string} [srcLang] - Source language name (default: "english")
 * @returns {Promise<string>} Translated text
 */
export async function translate(text, targetLang, srcLang) {
    const model = await loadModel();
    const tgtCode = resolveLangCode(targetLang);
    const srcCode = srcLang ? resolveLangCode(srcLang) : 'eng_Latn';

    // Chunk long text
    const maxChunkLen = 800;
    const chunks = [];
    for (let i = 0; i < text.length; i += maxChunkLen) {
        chunks.push(text.substring(i, i + maxChunkLen));
    }

    const results = [];
    for (const chunk of chunks) {
        const output = await model(chunk, {
            src_lang: srcCode,
            tgt_lang: tgtCode,
        });
        results.push(output[0]?.translation_text || chunk);
    }

    return results.join(' ');
}
