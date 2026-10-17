## 2024-05-15 - Vector Cosine Similarity Optimization
**Learning:** For performance-critical math operations over large arrays (like vector cosine similarity), processing the arrays via loop unrolling (e.g., in batches of 4) and combining repetitive Math function calls (like `Math.sqrt(a) * Math.sqrt(b)` into `Math.sqrt(a * b)`) significantly optimizes execution time in JavaScript engines.
**Action:** Always apply loop unrolling and combine identical Math operations when writing performance-critical loops over typed or standard arrays.
