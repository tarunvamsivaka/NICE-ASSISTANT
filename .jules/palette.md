## 2024-05-15 - Focus Visibility on Custom Toggles
**Learning:** When using custom toggle switches that hide the native checkbox input (e.g., `opacity: 0`), native browser focus rings are suppressed, breaking keyboard navigation feedback for users who rely on tab navigation.
**Action:** Always manually re-attach an explicitly defined `:focus-visible` outline to the visible sibling element (like a slider or pill) when the hidden native input receives focus.
