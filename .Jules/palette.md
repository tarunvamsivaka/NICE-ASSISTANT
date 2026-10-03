## 2023-10-24 - Accessible Custom Toggle Switches
**Learning:** Custom UI elements like toggle switches that use visually hidden native inputs (`opacity: 0`) lose their default browser focus ring, making them invisible to keyboard users. Furthermore, without `aria-label` or `aria-labelledby`, screen readers only announce them as "checkbox".
**Action:** When creating custom toggles or hiding native inputs, always manually add a `:focus-visible` outline to the visible sibling element and ensure the hidden input has an `aria-label` providing context.
