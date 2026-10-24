## 2024-03-24 - Array Micro-optimizations for Vector Operations
**Learning:** For performance-critical math operations over large arrays (like vector cosine similarity), manual loop unrolling harms readability and is automatically handled by modern JIT compilers (like V8).
**Action:** Instead of unrolling loops, focus on clean micro-optimizations: cache `.length` in a local variable, use local block-scoped vars for array indexing (`const ai = a[i]`), and combine Math function calls (e.g., `Math.sqrt(a * b)` instead of `Math.sqrt(a) * Math.sqrt(b)`).
