import React from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { CssBaseline, ThemeProvider, createTheme } from "@mui/material";
import App from "./components/App";
import store from "./store";

const theme = createTheme({
  palette: {
    mode: "dark",
    primary: { main: "#7c3aed" },
    secondary: { main: "#ec4899" },
    background: { default: "transparent", paper: "rgba(255,255,255,0.06)" },
  },
  typography: {
    fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  shape: { borderRadius: 14 },
});

const container = document.getElementById("root");
const root = createRoot(container);
root.render(
  <Provider store={store}>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  </Provider>
);
