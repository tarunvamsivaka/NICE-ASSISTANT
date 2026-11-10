## 2024-03-24 - Accessible Toggle Switches
**Learning:** Custom toggle switches using `opacity: 0` on native checkboxes break keyboard accessibility because the focus indicator is hidden, and they are invisible to screen readers without an explicit `aria-label`.
**Action:** Always add a `:focus-visible` outline to the visible sibling element (e.g., `.toggle-slider`) when focusing the hidden input, and ensure the hidden input has an `aria-label`.
