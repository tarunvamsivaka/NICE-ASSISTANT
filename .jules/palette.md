## 2024-11-07 - Toggle Switch Accessibility
**Learning:** Custom toggle switches using visually hidden native checkboxes (`opacity: 0`) require manual `:focus-visible` styling on their visible sibling (`.toggle-slider`) and `aria-label`s to be keyboard-accessible and screen-reader friendly.
**Action:** Add `:focus-visible` rules to the stylesheet for custom checkbox elements and ensure native inputs have descriptive `aria-label`s.
