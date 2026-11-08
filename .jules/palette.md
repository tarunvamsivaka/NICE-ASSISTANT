## 2024-05-18 - Accessible Toggle Switches
**Learning:** Custom toggle switches using `opacity: 0` on native checkboxes lose their default focus ring and screen reader context, making them inaccessible to keyboard and assistive technology users.
**Action:** Always add an `aria-label` to the hidden input and map `:focus-visible` from the input to an outline on the visible custom slider element.
