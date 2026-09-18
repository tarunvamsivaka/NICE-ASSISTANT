## 2024-05-15 - Missing ARIA label on device intelligence panel close button
**Learning:** Found an icon-only button (close panel) that was missing an ARIA label, reducing accessibility for screen readers.
**Action:** Always ensure any close buttons containing only '&times;' or an icon have an explicit `aria-label` (e.g. `aria-label="Close panel"`).
