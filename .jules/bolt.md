## 2024-09-22 - Optimize tight loop array lookups in cosineSimilarity
**Learning:** In hot path mathematical operations like calculating `cosineSimilarity` over 384-dimension vector arrays, accessing array indices multiple times (`a[i] * a[i]`) causes repeated V8 bounds checks and property lookups. This creates measurable CPU overhead during semantic search over hundreds of vectors.
**Action:** Extract array values into local block-scoped constants (`const valA = a[i]`) and cache array lengths (`const len = a.length`) inside hot `for` loops to minimize lookups and maximize JIT optimization.
