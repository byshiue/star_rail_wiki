import { defineConfig, globalIgnores } from "eslint/config";
import babelParser from "@babel/eslint-parser";

export default defineConfig([
  globalIgnores(["dist/**", "node_modules/**"]),
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      "no-undef": "error",
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          plugins: ["@babel/plugin-syntax-jsx"],
          presets: ["@babel/preset-typescript"],
        },
      },
      sourceType: "module",
    },
    rules: {
      "no-constant-condition": "error",
      "no-debugger": "error",
      "no-duplicate-imports": "error",
      "no-restricted-syntax": [
        "error",
        { selector: "TSAnyKeyword", message: "Unexpected any type." },
      ],
      "no-unreachable": "error",
      "prefer-const": "error",
    },
  },
]);
