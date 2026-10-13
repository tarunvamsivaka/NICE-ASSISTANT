## 2024-10-24 - Custom Toggle Switch Accessibility
**Learning:** Custom UI elements like toggle switches that hide native inputs (e.g., using `opacity: 0`) lose their default focus outline and can be invisible to screen readers if not properly labelled.
**Action:** When creating or modifying custom UI elements that hide native inputs, manually add a `:focus-visible` CSS outline to the visible sibling element and ensure the hidden input has an `aria-label` attribute to maintain keyboard and screen reader accessibility.
