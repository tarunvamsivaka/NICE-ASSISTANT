## 2023-10-25 - Custom Input Keyboard Focus Visibility
**Learning:** When building custom toggle switches or checkboxes by hiding the native input with `opacity: 0`, the browser's default keyboard focus ring (`outline`) is also hidden, making the control completely inaccessible to keyboard users as they cannot see their focus state.
**Action:** Always add a `:focus-visible` pseudo-class rule to the hidden native input that applies a visible focus style (e.g., using `box-shadow` or `outline`) to its adjacent visible styling element (e.g., `input:focus-visible + .slider { ... }`).
