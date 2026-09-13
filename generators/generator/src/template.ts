import { createTemplate } from "bingo";
import { z } from "zod";
import path from "node:path";
import pkgJson from "../package.json" with { type: "json" };
import { Eta } from "eta";

const eta = new Eta({ views: path.join(import.meta.dirname, "templates") });

export default createTemplate({
  about: {
    name: pkgJson.name,
    description: pkgJson.description,
  },

  // Define your options using Zod schemas
  options: {
    name: z.string().describe("Package name, without organization name"),
    // TODO: Add more options as needed
    description: z.string().optional().describe("Package description"),
  },

  // Generate files based on options
  async produce({ options }) {
    return {
      // see https://www.create.bingo/build/concepts/creations#files
      files: {
        "package.json": eta.render("package.json.eta", {
          name: options.name,
          description: options.description,
        }),
        "tsconfig.json": eta.render("tsconfig.json", {}),
        "vite.config.ts": eta.render("vite.config.ts", {}),
        "README.md": eta.render("README.md", {
          name: options.name,
        }),
        src: { "index.ts": "" },
        tests: { "index.test.ts": "" },
        // TODO: Add more files
      },
      // see https://www.create.bingo/build/concepts/creations#scripts
      scripts: [
        // Optional: Add scripts to run after generation
      ],
      // see https://www.create.bingo/build/concepts/creations#suggestions
      suggestions: [
        // Optional: Add suggestions for users
      ],
    };
  },
});
