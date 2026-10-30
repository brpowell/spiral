import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "src-tauri/**",
      "node_modules/**",
      "packs/**",
      "wmp-skins/**",
      "tools/**",
      "src/vendor/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      // Classic hooks only — React Compiler rules in v7 `recommended` would
      // force a large refactor across intentional patterns.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "no-useless-assignment": "off",
      "preserve-caught-error": "off",
      "prefer-const": "warn",
    },
  },
  {
    // Skin primitives early-return when presentation.kind mismatches, then call
    // hooks. Restructuring those call sites is a separate follow-up.
    files: ["src/components/playback/skin/**/*.{ts,tsx}"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
  {
    files: ["src/lib/playback/pcmStreamProcessor.ts"],
    rules: {
      // Worklet ambient types; import style is awkward here.
      "@typescript-eslint/triple-slash-reference": "off",
    },
  },
  {
    files: ["*.config.{js,ts,mjs,cjs}", "scripts/**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: globals.node,
    },
  },
  eslintConfigPrettier,
);
