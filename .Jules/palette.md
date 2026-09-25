## 2024-10-24 - Missing Keyboard Focus Indicators
**Learning:** The application lacked keyboard focus indicators (`:focus-visible`) across all interactive elements (buttons, toggles, icon buttons). Since many buttons had `outline: none` set (or generic resets applied), keyboard users couldn't tell which element was currently focused.
**Action:** Added global `:focus-visible` styles in `style.css` using `var(--accent-secondary)` and `outline-offset` to ensure clear, accessible focus states that match the app's design system without interfering with mouse click states.
