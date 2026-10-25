## 2024-10-25 - Ensure keyboard accessibility for custom visually-hidden checkboxes
**Learning:** Custom UI elements like toggle switches that hide native inputs (`opacity: 0`) require manual `:focus-visible` styling applied to visible sibling elements (like a slider track). Without this, keyboard navigation loses focus indication entirely.
**Action:** Always add `.custom-input input:focus-visible + .visible-element { outline: ... }` and ensure the hidden input retains descriptive `aria-label` attributes for screen readers.
