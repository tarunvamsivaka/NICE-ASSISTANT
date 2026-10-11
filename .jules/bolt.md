## 2024-05-15 - Loop Unrolling for Vector Search
**Learning:** For performance-critical math operations over large arrays (like vector cosine similarity in search-engine.js and vector-store.js), using loop unrolling and combining Math operations significantly optimizes execution time in JavaScript engines compared to a standard for-loop.
**Action:** When working on math-intensive loops over arrays with known lengths or structures, prioritize loop unrolling (e.g., batches of 4) and minimizing redundant Math API calls to extract maximum performance.
