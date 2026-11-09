
## 2024-05-24 - V8 Array Iteration Micro-Optimizations for Cosine Similarity
**Learning:** For performance-critical math operations over large arrays (like vector cosine similarity), caching `.length` in a local variable, using local block-scoped vars for array indexing (`const ai = a[i]`), and combining Math function calls (e.g., `Math.sqrt(a * b)` instead of `Math.sqrt(a) * Math.sqrt(b)`) yields a significant speedup in V8, reducing execution time by more than 50%.
**Action:** Apply these specific micro-optimizations consistently for tight mathematical loops over large arrays, while avoiding manual loop unrolling which harms readability without sufficient benefit.
