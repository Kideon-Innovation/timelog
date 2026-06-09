// Tiny shared DOM helper. `$` is the `document.getElementById` shorthand the
// whole app uses; it lived inline in main.js. Now that the render cluster moved
// into src/ui/calendar.js, both modules need it — exporting it from one place
// avoids two copies drifting apart. DOM-only, no app state.
export const $ = (id) => document.getElementById(id);
