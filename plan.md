1. **Add `aria-label` to custom toggle switches in `index.html`**
   - Use `sed` or inline node script to add appropriate `aria-label` attributes to the hidden checkbox inputs inside `.toggle-switch` containers.
2. **Add `:focus-visible` styles in `src/style.css`**
   - Add a CSS rule for `.toggle-switch input:focus-visible + .toggle-slider` to render an outline, ensuring custom toggles are keyboard-accessible.
3. **Verify `index.html` and `src/style.css` updates**
   - Run `cat` on `index.html` and `src/style.css` to visually confirm the code has been updated successfully.
4. **Document learning in `.jules/palette.md`**
   - Create and append a journal entry about ensuring screen reader and keyboard accessibility for hidden inputs in custom UI elements like toggle switches.
5. **Install dependencies and verify local tests pass**
   - Run `pnpm install` then verify `node_modules` exists.
   - Run `pnpm test:all` to ensure no existing logic is broken.
6. **Capture verification media with Playwright**
   - Create a temporary directory `/home/jules/verification`, initialize a new project, install Playwright (`npm install playwright`), and download browsers (`npx playwright install chromium`). Verify installation with `ls -l`.
   - Start the Vite dev server in the background, run a Playwright script to focus a toggle switch, and capture a screenshot to `/home/jules/verification/screenshots/toggle-focus.png`.
7. **Complete pre-commit steps**
   - Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.
