## 2024-03-01 - Hidden inputs break focus rings
**Learning:** Custom toggle switches using `opacity: 0` on the native `<input>` element cause the element to lose its focus ring entirely, making the toggle inaccessible to keyboard users unless a custom `:focus-visible` state is applied to the adjacent visible slider element (`.toggle-slider`).
**Action:** Always add `.toggle-switch input:focus-visible + .toggle-slider` styles with an outline when building custom CSS toggle switches that hide the native input.
