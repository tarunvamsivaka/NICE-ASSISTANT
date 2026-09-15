# TEST_INFRA.md — Nice Assistant v1.2.0 Test Infrastructure Reference

## 1. Overview & Architectural Philosophy

Nice Assistant v1.2.0 is an offline-first edge AI assistant engineered for Android (Capacitor) and Web browsers. To ensure that the application maintains 100% functional integrity, strict security isolation, and zero regressions across all new and existing capabilities, the E2E Testing Track provides a comprehensive opaque-box, requirement-driven test infrastructure.

### Core Principles
- **Opaque-Box Enforcement**: Tests interact strictly through public external interfaces (CLI, public entry points, action dispatches, and public API interfaces) without internal module monkeypatching or private state inspection.
- **Hermetic Runtime Simulation**: Standardized shims for Capacitor, DOM, Web Storage, Battery API, Clipboard API, and Web Workers enable deterministic execution under standard Node.js without headless browser overhead or heavy model downloads.
- **Multi-Tier Decomposition**: A structured 4-tier hierarchy covering nominal feature coverage (Tier 1), boundary/corner conditions (Tier 2), cross-feature pairwise interactions (Tier 3), and realistic multi-step application scenarios (Tier 4).
- **Strict Exit Semantics**: Exit code `0` on 100% pass, non-zero (`1`) on any failure, ensuring seamless CI/CD integration and automated release gating.

---

## 2. Directory Layout & File Organization

```text
tests/
├── e2e/
│   ├── runner.mjs                           # Primary CLI test runner & suite orchestrator
│   ├── harness/
│   │   ├── env.mjs                          # Standardized global mock environment & contract APIs
│   │   ├── fixtures.mjs                     # Realistic offline test fixtures (CSV, TSV, XLSX, MD, JSON)
│   │   ├── mock-device-bridge.mjs           # Android DeviceBridgePlugin simulation with state
│   │   └── mock-workers.mjs                 # Deterministic ONNX worker & RAG simulation
│   ├── tier1-feature-coverage.test.mjs      # Tier 1: 141 tests covering all 28 features
│   ├── tier2-boundary-corner.test.mjs       # Tier 2: 140 tests covering edge & boundary stress
│   ├── tier3-cross-feature.test.mjs         # Tier 3: 30 pairwise cross-feature interaction tests
│   └── tier4-application-scenarios.test.mjs # Tier 4: 15 real-world multi-step end-user workflows
├── test-all.mjs                             # Legacy 10-suite regression bundle
└── ... (existing unit test suites)
```

---

## 3. Test Runner CLI & Options

The test runner is executed directly via Node.js ESM:

```bash
node tests/e2e/runner.mjs [options]
```

### Supported Command-Line Flags
| Option | Argument | Description | Default |
|---|---|---|---|
| `--tier` | `1 \| 2 \| 3 \| 4 \| all` | Filter execution to a specific test tier or execute all tiers | `all` |
| `--filter` | `<regex>` | Filter test cases by test title or feature tag pattern | None |
| `--bail` | Flag | Halt test execution immediately upon the first failure | `false` |
| `--verbose` | Flag | Log each passing assertion, duration, and detailed trace | `false` |
| `--json` | Flag | Output structured JSON test results to stdout for machine consumption | `false` |

### Examples
```bash
# Execute the full 326-test E2E suite
node tests/e2e/runner.mjs --tier=all

# Run only Tier 1 Feature Coverage
node tests/e2e/runner.mjs --tier=1

# Run only Tier 2 Boundary & Corner Cases with verbose logging
node tests/e2e/runner.mjs --tier=2 --verbose

# Run specific scenario or feature
node tests/e2e/runner.mjs --tier=4 --filter=T4-01
```

---

## 4. Exit Code & Contract Specifications

- **`0`**: 100% of executed test cases passed with zero assertion errors and zero uncaught exceptions.
- **`1`**: One or more assertions failed, or an unhandled exception occurred during suite setup/execution.

### Console Output Format
When executed in standard mode, the runner prints:
1. Active tier and configuration.
2. Progressive test execution traces.
3. Tabular summary with total test counts, pass/fail counts, execution duration, and a complete Feature Checklist matrix (`[F1]` to `[F28]`).
4. Detailed failure traces (if any) with verbatim error messages and file line numbers.

---

## 5. Comprehensive Test Inventory & Feature Matrix

The E2E test track exercises all **28 features** defined in `PROJECT.md`:

| Feature ID | Feature Name | Tier 1 Tests | Tier 2 Tests | Tier 3 Tests | Tier 4 Scenarios | Total Tests |
|---|---|:---:|:---:|:---:|:---:|:---:|
| **F1** | CSV/TSV Ingestion & Allowlisting | 6 | 5 | T3-01, T3-06, T3-10 | T4-02, T4-09, T4-15 | 14 |
| **F2** | Header-Preserving Tabular Chunking | 5 | 5 | T3-01, T3-23 | T4-01, T4-04, T4-07 | 13 |
| **F3** | Lightweight XLSX Extraction | 5 | 5 | T3-02, T3-07, T3-10 | T4-01, T4-08, T4-14 | 13 |
| **F4** | Section-Aware Markdown Chunking | 5 | 5 | T3-03, T3-06, T3-29 | T4-02, T4-04, T4-06 | 13 |
| **F5** | Structured JSON / Code Chunking | 5 | 5 | T3-18, T3-30 | T4-13 | 12 |
| **F6** | Sub-100ms Tabular/Doc Search | 5 | 5 | T3-14, T3-19 | T4-03, T4-07 | 12 |
| **F7** | Dedicated Document Parser Test Suite | 5 | 5 | T3-10 | T4-01, T4-05 | 12 |
| **F8** | Consolidated Device Bridge Plugin | 5 | 5 | T3-24 | T4-01, T4-07, T4-12 | 13 |
| **F9** | Native Calendar Event Scheduling | 5 | 5 | T3-02, T3-11 | T4-01, T4-07, T4-08 | 13 |
| **F10** | Offline Calendar Web Fallback | 5 | 5 | T3-03, T3-20 | T4-01, T4-14 | 12 |
| **F11** | Native Contacts Lookup Bridge | 5 | 5 | T3-08, T3-11, T3-17 | T4-02, T4-08, T4-11 | 13 |
| **F12** | Web Contacts Fallback | 5 | 5 | T3-17, T3-26 | T4-02, T4-11 | 12 |
| **F13** | Native Battery & Power Status | 5 | 5 | T3-04, T3-05, T3-24 | T4-03, T4-07, T4-15 | 13 |
| **F14** | Web Battery Fallback | 5 | 5 | T3-22 | T4-03, T4-12 | 12 |
| **F15** | Clipboard Read & Write Bridge | 5 | 5 | T3-01, T3-09, T3-12, T3-16 | T4-01, T4-03, T4-05 | 14 |
| **F16** | Device Automation Intents & UI | 5 | 5 | T3-25, T3-26 | T4-04, T4-09, T4-10 | 13 |
| **F17** | Dedicated Device Automation Test Suite | 5 | 5 | T3-08, T3-24 | T4-01, T4-07 | 12 |
| **F18** | Multi-Turn Dialogue Memory Buffer | 5 | 5 | T3-06, T3-16, T3-19, T3-25 | T4-01, T4-06, T4-08 | 14 |
| **F19** | Antecedent / Pronoun Resolution | 5 | 5 | T3-07, T3-12, T3-28 | T4-01, T4-04, T4-06 | 13 |
| **F20** | Multi-File Context Aggregation | 5 | 5 | T3-13, T3-15, T3-28 | T4-02, T4-06, T4-13 | 13 |
| **F21** | Grounded Offline RAG Synthesis | 5 | 5 | T3-04, T3-13, T3-21, T3-23 | T4-02, T4-06, T4-13 | 14 |
| **F22** | Dedicated Multi-Turn Reasoning Test Suite | 5 | 5 | T3-06, T3-28 | T4-01, T4-02 | 12 |
| **F23** | Active-Session Zero-Network Guard | 5 | 5 | T3-08, T3-09, T3-10, T3-27 | T4-03, T4-10 | 13 |
| **F24** | Zero-Network Audit Logging | 5 | 5 | T3-20, T3-27 | T4-03, T4-10 | 12 |
| **F25** | Hardware Memory Governor & Worker Mutex | 5 | 5 | T3-05, T3-14, T3-21 | T4-03, T4-12 | 13 |
| **F26** | Dynamic Context Budget Clamping | 5 | 5 | T3-15, T3-22 | T4-03, T4-12 | 12 |
| **F27** | Dedicated Security & Memory Test Suites | 5 | 5 | T3-27 | T4-03, T4-10 | 11 |
| **F28** | Full Regression & Release Check | 5 | 5 | T3-01..T3-30 | T4-01..T4-15 | 11 |
| **Total**| **All 28 Features** | **141** | **140** | **30** | **15** | **326** |

---

## 6. How to Reproduce & Verify

To run the complete verification suite locally or in CI:

```bash
# 1. Verify that all 10 legacy unit test suites pass cleanly with 0 regressions
npm run test:all

# 2. Execute complete 326-test E2E suite across all 4 tiers
node tests/e2e/runner.mjs --tier=all

# 3. Verify production web bundle build compiles cleanly
npm run build

# 4. Execute release gate check
npm run release:check
```
