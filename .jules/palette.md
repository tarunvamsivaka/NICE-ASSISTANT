## 2024-05-14 - Toggle Switch Accessibility
**Learning:** Custom UI elements like toggle switches that hide their native `<input>` (using `opacity: 0`) often lose default focus indicators and screen reader context.
**Action:** Always add an `aria-label` to the hidden input and map a `:focus-visible` outline to its visible sibling element to ensure full keyboard and screen reader support.
