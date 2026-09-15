# Final Deployment & Maintenance Plan

**Project**: NICE Assistant  
**Author**: Software Organization Team  
**Date**: August 13, 2026  

---

## 1. Overview & Operational Architecture

The **NICE Assistant** is an offline-first assistant designed to run on Edge devices (Web Browsers, Android via Capacitor, Desktop local environments).

The deployment pipeline consists of three target environments:
1. **Local Development / Web Server**: Vite Frontend (`:5173`) + Node Express Indexing Server (`:5178`).
2. **Web Production Build**: Single Page Application bundled via Vite (`dist/`).
3. **Android Native APK**: Capacitor Android bridge (`android/`) compiled to APK/AAB via Gradle.

---

## 2. Standard Deployment Commands

### Development Execution
```bash
# Launch concurrent development server (Frontend + Backend Indexing Service)
npm run dev
```

### Full Test Verification
```bash
# Run all 10 unit and hardening test suites
npm run test:all
```

### Production Web Build
```bash
# Compile optimized bundle to dist/
npm run build
```

### Local Model Provisioning
```bash
# Download local Small Language Model (SmolLM2-135M) assets
npm run download:local-llm
```

### Android APK Build
```bash
# Run automated release gate checks and build signed Android APK
npm run build:signed
```

---

## 3. Maintenance & Release Governance

- **Pre-release Checklist**: Run `npm run release:check` before every version tag or APK build.
- **Dependency Policy**: Do not introduce remote API dependencies; maintain 100% offline-first capability.
- **Memory Safety Limits**: Enforce maximum 5MB file upload limit in WebView and hardware governor throttling on 4GB RAM phones.
