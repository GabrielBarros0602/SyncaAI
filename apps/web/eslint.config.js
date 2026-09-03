import js from "@eslint/js";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

/**
 * Two rules here are load-bearing, and they are load-bearing for the same reason: both
 * enforce a decision that a reviewer reading a diff would have to remember to check.
 *
 * The storage ban comes from ADR-0021 — the access token lives in memory and nowhere else,
 * which is one convenient line away from being undone by anybody in a hurry.
 *
 * The accessibility rules came later, and the gap they close was found the hard way. The week
 * screen's task row was rewritten from a `<button>` into a `role="group"` container, and
 * `npm run lint` reported nothing — not because the markup was sound but because nothing in
 * the chain had an opinion about `role` or `aria-*` at all. A green run that had no rule
 * capable of failing is not evidence, and this screen is largely keyboard-driven.
 */
const NO_STORAGE = "ADR-0021: no credential is written to browser storage. Keep it in memory.";

export default tseslint.config(
  { ignores: ["dist", "node_modules"] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { "react-hooks": reactHooks, "jsx-a11y": jsxA11y },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      "no-restricted-globals": [
        "error",
        { name: "localStorage", message: NO_STORAGE },
        { name: "sessionStorage", message: NO_STORAGE },
      ],
      // The bare identifier and the `window.` spelling are different rules, and banning
      // only the first would leave the obvious workaround open.
      "no-restricted-properties": [
        "error",
        { object: "window", property: "localStorage", message: NO_STORAGE },
        { object: "window", property: "sessionStorage", message: NO_STORAGE },
        { object: "globalThis", property: "localStorage", message: NO_STORAGE },
        { object: "globalThis", property: "sessionStorage", message: NO_STORAGE },
      ],
    },
  },
  {
    files: ["eslint.config.js", "vite.config.ts"],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
