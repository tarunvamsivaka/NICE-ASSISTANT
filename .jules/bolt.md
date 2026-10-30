## 2025-02-19 - Vector Math Loop Micro-Optimizations
**Learning:** For performance-critical math operations over large arrays (like vector cosine similarity), manual loop unrolling harms readability and is automatically handled by modern JIT compilers (like V8), sometimes resulting in worse performance.
**Action:** Focus on clean micro-optimizations like caching `.length` in a local variable, using local block-scoped vars for array indexing (`const ai = a[i]`), and combining Math function calls (e.g., `Math.sqrt(a * b)` instead of `Math.sqrt(a) * Math.sqrt(b)`).
