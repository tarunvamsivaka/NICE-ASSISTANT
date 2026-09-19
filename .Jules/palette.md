## 2024-11-20 - Custom Toggle Switch Focus State
**Learning:** Visually hidden inputs for custom toggle switches lose their native keyboard focus outline, making it impossible for keyboard-only users to see which setting they are currently focused on in the settings drawer.
**Action:** Always add manual `:focus-visible` styles to the visible sibling element (e.g., the `.toggle-slider`) when visually hiding inputs for custom styling.
