## 2024-05-24 - Accessibility for hidden inputs in custom UI components
**Learning:** When building custom toggle switches or other UI elements that visually hide the native `<input type="checkbox">` (e.g., using `opacity: 0`), they can become invisible to keyboard users and screen readers unless explicitly handled.
**Action:** Always add an `aria-label` to the hidden input, and ensure keyboard focus is visible by adding a `:focus-visible` state to the visible sibling element (like `.toggle-slider`).
