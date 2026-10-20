import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

// Option B design-system guard: raw Tailwind palette classes (bg-red-500,
// text-emerald-700, …) and arbitrary sub-12px font sizes (text-[10px]) are
// banned outside src/components/ui — pages and shared components reach for
// the semantic tokens (success/warning/destructive/info/neutral, heading,
// label, muted-foreground) instead, so a new screen can't quietly
// reintroduce the colors this pass just removed. src/components/ui is where
// those tokens themselves get wired up, so it's exempt.
// Scoped to the families this pass actually mapped to tokens (see the
// Phase 7 table: red/rose, amber/yellow, emerald/green, sky/blue, slate).
// purple/orange/indigo/violet/pink/cyan/gray/teal/etc. still have raw
// uses left in the codebase (flagged in the Phase 9 report, not yet
// mapped to a token) — banning them here too would fail the existing
// build rather than catch new regressions, so they're left out of this
// rule until that follow-up cleanup happens.
const RAW_PALETTE_RE =
  "\\b(bg|text|border|ring|divide|from|to|via|fill|stroke|outline|decoration|caret|accent)-" +
  "(red|rose|amber|yellow|green|emerald|sky|blue|slate)-[0-9]{2,3}\\b";
const ARBITRARY_SMALL_TEXT_RE = "text-\\[(?:[0-9]|1[01])px\\]";
const CLASSNAME_BAN_PATTERN = `${RAW_PALETTE_RE}|${ARBITRARY_SMALL_TEXT_RE}`;

const noRestrictedClassNameSyntax = [
  {
    selector: `JSXAttribute[name.name="className"] Literal[value=/${CLASSNAME_BAN_PATTERN}/]`,
    message:
      "Raw Tailwind palette classes and sub-12px arbitrary text sizes are banned here — use the semantic tokens (success/warning/destructive/info/neutral, heading, label, muted-foreground) instead. See src/index.css.",
  },
  {
    selector: `TemplateElement[value.raw=/${CLASSNAME_BAN_PATTERN}/]`,
    message:
      "Raw Tailwind palette classes and sub-12px arbitrary text sizes are banned here — use the semantic tokens (success/warning/destructive/info/neutral, heading, label, muted-foreground) instead. See src/index.css.",
  },
];

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    files: ["src/pages/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
    ignores: ["src/components/ui/**"],
    rules: {
      "no-restricted-syntax": ["error", ...noRestrictedClassNameSyntax],
    },
  },
);
