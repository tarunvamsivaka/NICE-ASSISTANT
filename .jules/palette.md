## 2024-03-20 - Toggle Switch Accessibility
**Learning:** Custom UI elements like toggle switches that hide native inputs (`opacity: 0`) lose keyboard accessibility outlines, making them invisible to keyboard users and often missing proper screen reader labeling.
**Action:** Always add a `:focus-visible` CSS outline to the visible sibling element (`.toggle-slider`) when the hidden input receives focus, and ensure the hidden input has an appropriate `aria-label` attribute linked to its function to maintain keyboard and screen reader accessibility.
