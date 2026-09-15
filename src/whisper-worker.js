import { pipeline, env } from '@xenova/transformers';

// Configure transformers.js for completely offline, local execution
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = '/models/';

let transcriber = null;

self.addEventListener('message', async (e) => {
    const { type, audio } = e.data;

    if (type === 'init') {
        try {
            self.postMessage({ type: 'status', message: 'Loading offline voice model...' });
            transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
                quantized: true,
            });
            self.postMessage({ type: 'ready' });
        } catch (err) {
            self.postMessage({ type: 'error', error: err.message });
        }
    } else if (type === 'transcribe') {
        if (!transcriber) return;
        try {
            self.postMessage({ type: 'status', message: 'Processing audio...' });
            const result = await transcriber(audio, {
                chunk_length_s: 30,
                stride_length_s: 5,
                language: 'english',
                task: 'transcribe'
            });
            self.postMessage({ type: 'result', text: result.text.trim() });
        } catch (err) {
            self.postMessage({ type: 'error', error: err.message });
        }
    }
});
