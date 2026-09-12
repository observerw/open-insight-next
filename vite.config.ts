import { defineConfig } from "vite-plus";

export default defineConfig({
  create: {
    templates: [
      {
        name: "@open-insight/template-base",
        description: "Generate a basic packages",
        template: "./generators/template-base",
      },
    ],
  },
  staged: {
    "*": "vp check --fix",
  },
  fmt: {},
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  run: {
    cache: true,
  },
});
