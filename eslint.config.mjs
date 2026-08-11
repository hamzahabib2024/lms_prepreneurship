import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * The linter — the one quality gap that could be closed without waiting on
 * anybody.
 *
 * `npm run lint` has run `tsc --noEmit` for months. That is a real check and
 * it stays, but it only answers "do the types agree". It says nothing about a
 * promise nobody awaited, a variable nobody reads, or a `catch` that swallows
 * an error — and a floating promise is exactly the shape of several defects
 * this project has already had.
 *
 * TYPE-AWARE, deliberately. The cheap rules that need no type information are
 * the ones tsc mostly covers already; the ones worth having — no-floating-
 * promises, no-misused-promises, require-await — all need the checker, and
 * they are the ones that catch the class of bug that reaches a user.
 *
 * WHAT IS TURNED OFF is as considered as what is on. Anything stylistic is
 * off: this codebase has a voice, and a linter arguing about it produces noise
 * that trains people to run `--fix` without reading. Only rules that describe
 * a DEFECT are errors.
 */
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "pgdata/**",
      "storage/**",
      "backups/**",
      "apps/api/prisma/migrations/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        // A dedicated project, because the build tsconfig excludes spec files
        // and the linter must see them: a floating promise inside a probe is a
        // check that passes without checking.
        project: ["./tsconfig.eslint.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },

    rules: {
      // ---- the ones worth having ------------------------------------------

      // A promise nobody waits for fails silently. The audit write that never
      // happened, the notification that never went — this is that shape.
      "@typescript-eslint/no-floating-promises": "error",
      // An async function passed where a sync one is expected: the caller
      // returns immediately and the work happens later, if at all.
      "@typescript-eslint/no-misused-promises": "error",
      // `catch {}` that discards the error. There are legitimate ones here and
      // they are marked; the rest hide faults.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      // ---- turned down, with reasons --------------------------------------

      // `any` is already banned by tsconfig's strictness where it matters, and
      // the remaining uses are at boundaries — Prisma's JSON columns, Express
      // request bodies — where the value genuinely is unknown until checked.
      "@typescript-eslint/no-explicit-any": "warn",
      // Template literals interpolating a typed value are how every message in
      // this System is built, and the rule fires on all of them.
      "@typescript-eslint/restrict-template-expressions": "off",
      // Reads worse than it is: `?? ""` on a value that is already a string is
      // defensive, not redundant, at an API boundary.
      "@typescript-eslint/no-unnecessary-condition": "off",
      // Stylistic. This codebase is consistent by hand.
      "@typescript-eslint/consistent-type-definitions": "off",
      "@typescript-eslint/no-inferrable-types": "off",

      // OFF, AND THIS ONE WAS LEARNED THE HARD WAY. Running --fix with it on
      // stripped `as InputJsonValue` from four Prisma writes: the rule judges
      // an assertion by what the RECEIVER accepts, and Prisma's JSON input
      // type is exactly the case it gets wrong. The build broke and five tests
      // failed. An autofixable rule that removes load-bearing code is worse
      // than no rule — it is a rule that damages a codebase on a command
      // people run without reading the diff.
      "@typescript-eslint/no-unnecessary-type-assertion": "off",

      // OFF, after looking at all six it fired on. It cannot distinguish three
      // different things: a method that MUST return a Promise because it
      // implements the storage or classroom provider interface (removing
      // `async` there breaks the contract); a method doing synchronous file
      // work today that is async because it reads as I/O and will be; and a
      // test arrow. None of those is a defect, and rewriting them to satisfy
      // the rule would make the code worse to read in exchange for nothing.
      "@typescript-eslint/require-await": "off",

      // The `unsafe` family fires at boundaries this System cannot type: a
      // Prisma JSON column, an Express body, a CSV cell. Every one of them is
      // validated by Zod or checked by hand immediately afterwards. Left as
      // warnings so a genuinely new one is visible without the whole run
      // failing on the ones that are deliberate.
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
    },
  },

  {
    // Tests may reach for `any` and may leave a promise dangling in a
    // deliberately awkward case; they are not what reaches a user.
    files: ["**/*.spec.ts", "**/*.int-spec.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },
);
