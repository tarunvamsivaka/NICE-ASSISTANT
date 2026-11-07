## 2024-05-15 - [Initial Setup]
**Learning:** Initial project setup.
**Action:** Created .jules/bolt.md for tracking performance learnings.

## 2026-09-12 - [Cosine Similarity Micro-optimizations]
**Learning:** For performance-critical math operations over large arrays (like vector cosine similarity), manual loop unrolling harms readability and is automatically handled by V8. Focus on clean micro-optimizations like caching \`.length\`, using local block-scoped vars for array indexing (\`const ai = a[i]\`), and combining Math function calls (\`Math.sqrt(a * b)\`).
**Action:** Always apply these clean micro-optimizations to dense mathematical loops instead of attempting manual loop unrolling.
