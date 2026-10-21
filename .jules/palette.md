## 2024-05-14 - Custom UI Toggle Accessibility
**Learning:** Custom UI elements that hide native inputs (like `.toggle-switch` checkboxes with `opacity: 0`) lose their default focus and screen reader context, making them inaccessible to keyboard users and screen reader users.
**Action:** Always manually add a `:focus-visible` CSS outline to the visible sibling element (e.g., `.toggle-slider`) and ensure the hidden input has a descriptive `aria-label` attribute.
