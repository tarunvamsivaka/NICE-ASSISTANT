
## 2026-10-18 - Loop Unrolling and Math Combining in Vector Similarity
**Learning:** Math.sqrt and loop iterations introduce noticeable overhead in JavaScript for mathematically intensive algorithms like vector cosine similarity (where vector sizes are large, often 384+ elements).
**Action:** Unroll loops by processing in batches (e.g., of 4) and combine repetitive mathematical function calls (like replacing `Math.sqrt(a) * Math.sqrt(b)` with `Math.sqrt(a * b)`) when running identical calculations over large uniform structures.
