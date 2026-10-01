## 2024-10-24 - Hidden Input Focus Accessibility
**Learning:** When using visually hidden native inputs (like `opacity: 0` checkboxes) for custom UI controls (e.g., toggle switches), default browser focus rings are not visible. Screen reader and keyboard users lose their place on the page when these inputs receive focus.
**Action:** Always add explicit `:focus-visible` styling to the visible sibling element (e.g., `.toggle-switch input:focus-visible + .toggle-slider`) to ensure keyboard navigability is maintained for custom controls.
