import { defineConfig } from "@rslib/core";

const browserFilename = "tw-nhi-icc.min.js";
const browserGlobalName = "TWNHIICC";

export default defineConfig({
    source: {
        entry: {
            index: "./src/index.ts",
        },
        tsconfigPath: "./tsconfig.build.json",
    },
    lib: [
        {
            id: "esm",
            format: "esm",
            dts: true,
            output: {
                distPath: {
                    root: "./lib",
                },
                minify: false,
            },
        },
        {
            id: "browser",
            format: "umd",
            umdName: browserGlobalName,
            output: {
                target: "web",
                distPath: {
                    root: "./dist",
                },
                filename: {
                    js: browserFilename,
                },
                minify: true,
            },
        },
    ],
});
