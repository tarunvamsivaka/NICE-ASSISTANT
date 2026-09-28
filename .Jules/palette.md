## 2024-05-24 - Accessibility for visually hidden native inputs
**Learning:** When using visually hidden native inputs (like checkboxes in custom toggle switches with `opacity: 0`), standard focus outlines (`:focus-visible`) on the input won't be visible.
**Action:** Always apply the focus outline to the adjacent visible sibling element (e.g., `.toggle-switch input:focus-visible + .toggle-slider { outline: ... }`) to ensure keyboard navigators can see which custom control has focus.
