## 2024-09-26 - Explicit focus for hidden inputs
**Learning:** When hiding native inputs (like checkboxes for `.toggle-switch`) to style custom UI elements, screen readers and keyboard navigation can lose visible focus indicators if not explicitly handled via sibling combinators (`:focus-visible + .styled-element`).
**Action:** Always ensure that custom styled controls tied to hidden inputs apply `:focus-visible` styles to their visual counterparts so keyboard users can track focus.
