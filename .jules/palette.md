## 2026-03-05 - Accessible Labels and Keyboard Navigation for Visually Hidden Inputs

**Learning:** When using visually hidden native inputs (e.g. `opacity: 0`) under custom UI wrappers (like `.toggle-switch` or `.settings-slider`), screen readers cannot inherently read a descriptive `<label>` unless it wraps the entire input block or uses a matching `for` attribute. Furthermore, setting `opacity: 0` makes standard focus states invisible.
**Action:** When creating or modifying custom UI elements that hide native inputs, ensure you: 1) Add an explicit `aria-label` to the hidden input so screen readers read an accessible name, and 2) Manually add a `:focus-visible` CSS outline to the visible sibling element to maintain keyboard navigation visibility.
