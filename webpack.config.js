const path = require("path");
const HTMLWebpackPlugin = require("html-webpack-plugin");
const CopyPlugin = require("copy-webpack-plugin");
const webpack = require("webpack");

module.exports = (env, argv) => {
  const isProd = argv.mode === "production";
  const apiBase = process.env.API_BASE_URL || (isProd ? "/api" : "http://localhost:4000/api");

  return {
    entry: {
      main: "./src/index.js",
      admin: "./src/admin.js",
    },
    output: {
      path: path.join(__dirname, "dist"),
      filename: "[name].[contenthash].js",
      publicPath: "/",
      clean: true,
    },
    devServer: {
      static: { directory: path.join(__dirname, "public") },
      historyApiFallback: {
        rewrites: [{ from: /^\/admin/, to: "/admin.html" }],
      },
      port: 8080,
      hot: true,
    },
    plugins: [
      new HTMLWebpackPlugin({ template: "./src/index.html", filename: "index.html", chunks: ["main"] }),
      new HTMLWebpackPlugin({ template: "./src/admin.html", filename: "admin.html", chunks: ["admin"] }),
      new CopyPlugin({
        patterns: [{ from: "public", to: "." }],
      }),
      new webpack.DefinePlugin({
        "process.env.API_BASE_URL": JSON.stringify(apiBase),
      }),
    ],
    module: {
      rules: [
        {
          test: /\.jsx?$/,
          exclude: /node_modules/,
          use: {
            loader: "babel-loader",
            options: {
              presets: ["@babel/preset-env", "@babel/preset-react"],
            },
          },
        },
        {
          test: /\.css$/,
          use: ["style-loader", "css-loader"],
        },
        {
          test: /\.(png|jpg|jpeg|svg|gif|webp)$/i,
          type: "asset/resource",
        },
      ],
    },
    resolve: {
      extensions: [".js", ".jsx"],
    },
  };
};
