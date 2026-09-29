
## 2023-10-24 - Focus Visible Styles for Custom Form Controls
**Learning:** Custom form controls (like `.toggle-switch`) that visually hide their native input elements (`opacity: 0`) lose default browser focus outlines. When the hidden input receives focus via keyboard navigation, the visual replacement element (`.toggle-slider`) needs an explicit `:focus-visible` style applied using adjacent sibling combinators (e.g., `input:focus-visible + .toggle-slider`).
**Action:** Always apply explicitly delegated `:focus-visible` styles to the visual sibling elements of custom or visually-hidden native form controls to maintain keyboard accessibility.
