import TerserPlugin from "terser-webpack-plugin";
import { Configuration } from "webpack";


const config: Configuration = {
    entry: "./src/lib.ts",
    output: {
        clean: true,
        filename: "tw-nhi-icc.min.js",
        libraryTarget: "umd",
    },
    plugins: [],
    module: {
        rules: [
            {
                test: /\.ts$/i,
                use: [
                    {
                        loader: "babel-loader",
                        options: { presets: ["@babel/preset-env", "@babel/preset-typescript"] },
                    },
                ],
            },
            {
                test: /\.js$/i,
                use: [
                    {
                        loader: "babel-loader",
                        options: { presets: ["@babel/preset-env"] },
                    },
                ],
            },
        ],
    },
    resolve: { extensionAlias: { ".js": [".ts", ".js"] } },
    optimization: {
        minimizer: [
            new TerserPlugin({
                extractComments: false,
                terserOptions: { format: { comments: false } },
            }),
        ],
    },
};
 
export default config;
