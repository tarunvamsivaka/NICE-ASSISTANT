## 2024-05-24 - Optimizing Vector Distance Calculations in JavaScript
**Learning:** For performance-critical math operations over large arrays (like vector cosine similarity), loop unrolling (processing in batches of 4) and combining repetitive Math function calls (`Math.sqrt(normA * normB)` instead of `Math.sqrt(normA) * Math.sqrt(normB)`) significantly optimizes execution time in JavaScript engines.
**Action:** Always apply loop unrolling and combine Math calls when writing low-level array processing algorithms like vector similarity search to minimize loop and function call overhead.
