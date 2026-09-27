## 2024-05-14 - Map/Filter Object Allocation Overhead on Large Arrays
**Learning:** Chaining `.map().filter()` over large arrays (like `fileIndex` which can have up to 50,000 items) allocates a massive number of temporary intermediate objects (`{...f, score}`), causing severe memory pressure and GC pauses on low-end devices.
**Action:** When iterating over potentially large lists in critical paths (like instant search), use a single `for` loop and push only the matched results directly to an array to avoid unnecessary object allocations.
