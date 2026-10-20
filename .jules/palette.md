## 2025-02-28 - Adding Keyboard Accessibility to Visually Hidden Native Inputs
**Learning:** When creating custom UI controls like `.toggle-switch` that hide native inputs (`opacity: 0`), default focus styling is lost, rendering the control inaccessible via keyboard navigation.
**Action:** Always add a `:focus-visible` CSS rule targeting the custom visible sibling when the hidden input is focused (e.g., `input:focus-visible + .toggle-slider`). Pair this with an `aria-label` on the hidden input to ensure it is both keyboard accessible and screen reader friendly.
