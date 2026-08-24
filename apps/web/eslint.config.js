import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

/**
 * The rule that matters here is the storage ban.
 *
 * ADR-0021 decided the access token lives in memory and nowhere else. That decision is one
 * convenient line away from being undone by anybody in a hurry, including a future me — so
 * it is enforced by the linter rather than by review, which is the only enforcement that
 * still works at 2am.
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
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
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
