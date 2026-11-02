## 2026-11-02 - Custom UI Element Accessibility
**Learning:** Custom UI elements like toggle switches with visually hidden native inputs (`opacity: 0`) lose out-of-the-box keyboard accessibility and screen reader support.
**Action:** Manually add a `:focus-visible` CSS outline to the visible sibling element and ensure the hidden input has an `aria-label` attribute to maintain accessibility.
