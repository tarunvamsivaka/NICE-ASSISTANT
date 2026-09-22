## 2024-10-24 - Custom interactive elements lacking focus rings
**Learning:** Custom interactive elements (like glassmorphic toggle switches and icon buttons) often lose clear focus indications when using complex theme styling unless a global `:focus-visible` ring is explicitly defined and styled for dark/light themes.
**Action:** Always verify custom component implementations have a robust focus outline specifically for `:focus-visible` to keep it accessible for keyboard users without penalizing mouse users.
