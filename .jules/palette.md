## 2024-10-27 - Palette Journal Initialized
**Learning:** Initializing journal to track UX/a11y learnings.
**Action:** Document critical learnings here.
## 2024-10-27 - Toggle Switch Accessibility
**Learning:** Custom UI elements that hide native inputs (like .toggle-switch checkboxes with opacity: 0) lose default keyboard focus outlines and screen reader context when separated from their descriptive labels.
**Action:** Manually add a :focus-visible CSS outline to the visible sibling element and ensure the hidden input has an aria-label attribute.
