
## 2025-05-19 - Manual Loop Unrolling harms readability without significant benefit
**Learning:** Manual loop unrolling (processing in batches, e.g., 4) is a textbook micro-optimization that harms code readability and shouldn't be done, as modern JIT compilers (like V8) automatically handle it.
**Action:** Avoid manual loop unrolling, and focus on algorithmic improvements or clean micro-optimizations like combining Math function calls (`Math.sqrt(a * b)` instead of `Math.sqrt(a) * Math.sqrt(b)`) for large arrays.
