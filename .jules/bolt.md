
## 2024-06-25 - Optimize Regex Creation and String Search in hasStrongQuerySignal
**Learning:** Instantiating `RegExp` repeatedly inside a tight loop like `hasStrongQuerySignal` (which gets called on every search paragraph) creates significant GC pressure and CPU overhead. Word boundaries (`\b`) are unsafe for C++ or C# tokens.
**Action:** Use a `WeakMap` linked to the `query` object to cache parsed signals (`targetPhrase`, `fallbackPool`) to avoid mutating the original `query` object, which is an anti-pattern. Cache `fallbackPool` tokens and use simple string operations and boundary-safe regex caching where possible.
