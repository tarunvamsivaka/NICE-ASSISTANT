# NICE Assistant 🤖📱

> **A privacy-first, fully offline on-device AI assistant for Android.**

NICE Assistant transforms standard Android smartphones into self-sufficient on-device AI platforms. Engineered to run completely off-the-grid without sending a single byte to cloud servers, it combines on-device machine learning, deep file parsing, fast semantic search, and native Android automation into a single responsive mobile experience.

---

## ✨ Key Features

- **🔒 100% Offline & Private**: Operates entirely on the device CPU/RAM with zero cloud telemetry or data leakage.
- **🎙️ On-Device Speech Recognition**: Offline Speech-to-Text (STT) powered by `@xenova/transformers` (Whisper ONNX).
- **🗣️ Native System Text-to-Speech (TTS)**: Low-latency voice responses bridged to Android native speech engines.
- **📄 Deep File Parsing & RAG**:
  - Instant indexing and semantic search across PDF, DOCX, and plain text files.
  - Offline Image OCR via `Tesseract.js` for scanning screenshots and photos.
  - Sub-100ms answers powered by an inverted index and sliding window scoring model.
- **📱 Android Native Hardware Automation**:
  - App catalog search and app launcher (Spotify, Google Maps, Calculator, etc.).
  - Native media playback for local audio files.
  - System alarms, countdown timers, reminders, and flashlight controls via Capacitor plugins.
- **🧠 Utilitarian Action Engine**:
  - Natural language word math and percentage computation.
  - Persistent offline notes with instant search.
  - Battery, memory, and device hardware diagnostics.

---

## 🏗️ Architecture Overview

```
 ┌─────────────────────────────────────────────────────────────┐
 │                      NICE Mobile UI                         │
 │     (Vite + Vanilla JS + Glassmorphism / Touch Controls)     │
 └──────────────┬───────────────────────────────┬──────────────┘
                │                               │
                ▼                               ▼
 ┌─────────────────────────────┐ ┌─────────────────────────────┐
 │    Local AI & ML Engines    │ │     Device Bridge & RAG     │
 │  • Whisper STT (ONNX WASM)  │ │  • Sliding Window Scoring   │
 │  • Local Intent Classifier  │ │  • Tesseract.js OCR Engine  │
 │  • Offline WebLLM Model     │ │  • Inverted Index (BM25)    │
 └──────────────┬──────────────┘ └──────────────┬──────────────┘
                │                               │
                └───────────────┬───────────────┘
                                │
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │                  Capacitor Android Bridge                   │
 │  • AppCatalogPlugin       • DeviceBridgePlugin              │
 │  • FloatingService        • NativeTtsPlugin                 │
 └─────────────────────────────────────────────────────────────┘
```

---

## 📂 Project Structure

```
├── android/              # Native Android project with custom Capacitor plugins
│   └── app/src/main/     # Java plugin bridges, AndroidManifest, assets, and resources
├── docs/                 # Architectural specifications, audits, and checklists
├── public/               # Web assets, icons, and offline models
├── release/              # Project books, summaries, and dossiers
├── scripts/              # Automated build, signing, model downloading, and release scripts
├── server/               # Local test server and offline backend utility
├── src/                  # Core application source code
│   ├── css/              # Glassmorphic UI stylesheets
│   ├── js/               # AI orchestrator, parser engines, intent router, capacitor bridges
│   └── main.js           # App initialization
├── tests/                # Test suites (parsers, policies, retrieval, E2E benchmarks)
└── package.json          # Dependencies and scripts
```

---

## 🚀 Getting Started

### Prerequisites
- **Node.js**: v18 or higher
- **npm**: v9 or higher
- **Android Studio & SDK**: Android SDK 33+ (for Android builds)
- **Java**: JDK 17+

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/tarunvamsivaka/NICE-ASSISTANT.git
   cd NICE-ASSISTANT
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run local development server:
   ```bash
   npm run dev
   ```

---

## 🧪 Testing

Run unit, integration, and E2E verification suites:

```bash
# Run all automated tests
npm run test:all

# Or run individual test modules:
npm run test:parser
npm run test:policy
npm run test:retrieval
npm run test:embedding
npm run test:conversation
npm run test:e2e
```

---

## 📱 Building the Android APK

1. Build web assets:
   ```bash
   npm run build
   ```

2. Sync with Capacitor Android platform:
   ```bash
   npx cap sync android
   ```

3. Compile signed APK using build script:
   ```bash
   npm run build:signed
   ```

---

## 🛡️ Privacy & Security

NICE Assistant does not collect, transmit, or monetize personal data. All inferences, embeddings, voice processing, and document parses happen strictly on the local hardware.
