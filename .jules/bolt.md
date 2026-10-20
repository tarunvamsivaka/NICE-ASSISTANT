
## 2024-05-18 - Loop Unrolling and Math Function Combination
**Learning:** For performance-critical math operations over large arrays (like vector cosine similarity), manual loop unrolling (processing in batches of 4) and combining repetitive Math function calls (like replacing two Math.sqrt calls with one Math.sqrt(A * B)) can significantly optimize execution time in JavaScript engines.
**Action:** Apply loop unrolling and function combination whenever performing repetitive math calculations over large arrays or vectors.
