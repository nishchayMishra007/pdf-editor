# Bundled fallback fonts

These fonts are used only when a PDF’s embedded (often subset) font cannot
render a character the user typed. The UI must show a warning chip in that case.

- `LiberationSans-Regular.ttf` / `LiberationSerif-Regular.ttf` / `LiberationSans-Bold.ttf`
  — [Liberation Fonts](https://github.com/liberationfonts/liberation-fonts) (SIL OFL)

Do not silently substitute fonts without surfacing a warning to the user.
