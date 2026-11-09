## 2024-05-23 - Custom Toggle Switch Accessibility
**Learning:** Custom UI elements that hide native inputs (like opacity:0 checkboxes) lose native focus outlines and screen reader context.
**Action:** Always add :focus-visible outlines to the visible sibling and aria-labels to the hidden input for custom form controls.
