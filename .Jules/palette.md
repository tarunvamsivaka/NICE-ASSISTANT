## 2026-10-10 - Focus States for Hidden Native Inputs
**Learning:** When styling custom UI elements (like toggle switches) by visually hiding the native `<input type="checkbox">`, the element loses its default browser focus outline, making keyboard navigation difficult. Furthermore, screen readers need explicit labels when visual text isn't directly associated.
**Action:** Always add a `:focus-visible` CSS rule targeting the visible sibling (e.g., `input:focus-visible + .slider`) and ensure the hidden input has an `aria-label` to maintain both visual and screen reader accessibility.
