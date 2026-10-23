## 2023-10-23 - Accessibility of Hidden Inputs in Custom Controls
**Learning:** Custom UI elements like toggle switches that use `opacity: 0` on native `<input type="checkbox">` elements lose their default keyboard focus indicators and are not announced correctly by screen readers if they lack labels.
**Action:** Always add `aria-label` attributes to the hidden native inputs and use the `:focus-visible` pseudo-class (e.g. `input:focus-visible + .slider`) to apply a visual focus outline to the visible sibling element.
