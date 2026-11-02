## 2024-05-18 - Math.sqrt combination in Vector Math
**Learning:** In tight math loops (like cosine similarity), separate `Math.sqrt(a) * Math.sqrt(b)` is noticeably slower than combined `Math.sqrt(a * b)` and avoids two square root operations. Also, V8 optimizes block-scoped array element access better than re-evaluating `a[i]` and `b[i]` repeatedly.
**Action:** Always combine `Math.sqrt` calls for positive numbers and cache array elements/lengths in local variables in hot numeric loops.
