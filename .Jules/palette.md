## 2024-05-18 - Missing Outline on Hidden Native Inputs
**Learning:** In custom toggle components that set `opacity: 0` on the native input element, keyboard focus state is completely hidden from the user unless manually delegated to the visible element. Keyboard users cannot tell which control is focused.
**Action:** Use `:focus-visible` to add an outline or glow to the `.toggle-slider` sibling when the hidden input receives focus via keyboard interaction. Additionally, ARIA labels or `aria-labelledby` should be applied to the inputs to ensure screen reader context.
