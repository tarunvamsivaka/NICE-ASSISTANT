## 2024-10-06 - Accessible Toggle Switches
**Learning:** When using custom toggle switch components with visually hidden native inputs (`opacity: 0`), screen readers and keyboard users lose context because the native element can't be seen or isn't labeled.
**Action:** Always add an `aria-label` to the hidden `<input type="checkbox">` and ensure there is a `:focus-visible` CSS rule applied to the visible sibling element (e.g. `.toggle-slider`) to clearly indicate keyboard focus.
