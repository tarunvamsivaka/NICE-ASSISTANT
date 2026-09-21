## 2024-09-21 - Custom Focus Indicators Needed for Custom Themes
**Learning:** When relying entirely on custom backgrounds and themes, the browser's default focus ring often provides poor contrast and visibility for keyboard navigation, making the app inaccessible to keyboard users.
**Action:** Always add explicit `:focus-visible` styles with sufficient outline thickness and offset using the app's existing accent colors (like `--accent-secondary`) to ensure clear visual feedback for focused interactive elements.
