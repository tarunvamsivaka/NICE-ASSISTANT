## 2024-03-20 - Accessible Toggle Switches
**Learning:** Custom toggle switches using `opacity: 0` on native checkboxes lose default keyboard focus visibility, causing a poor experience for keyboard navigation users.
**Action:** Always add a `:focus-visible` pseudo-class to apply an outline to the visible sibling element and ensure hidden inputs have an `aria-label`.
