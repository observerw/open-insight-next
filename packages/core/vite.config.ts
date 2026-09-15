import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    dts: {
      tsgo: true,
    },
    exports: {
      devExports: true,
      customExports: {
        ".": "./src/index.ts",
        "./*": "./src/*.ts",
        "./internal/*": null,
      },
      exclude: ["cli", "**\/*.test", /internal/],
    },
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
