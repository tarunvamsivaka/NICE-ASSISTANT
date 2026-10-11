## 2024-05-15 - [Initial]
**Learning:** Found that custom toggle switches hide the native input, breaking keyboard accessibility (no focus indicator) and screen reader support (no aria-labels on inputs).
**Action:** Add `:focus-visible` styles to the visible sibling elements when the hidden input is focused, and ensure the hidden input has an `aria-label`.
