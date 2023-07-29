import React, { useState } from "react";
import WheelComponent from "../helper/Wheel";
import { lightTheme, darkTheme } from "./theme/theme.js";
import { ThemeProvider } from "@mui/material/styles";
import Banner from "./Banner";
import { Paper } from "@mui/material";

const App = () => {
  const [isDarkMode, setIsDarkMode] = useState(false);

  const theme = isDarkMode ? darkTheme : lightTheme;

  const toggleTheme = () => {
    setIsDarkMode(!isDarkMode);
  };

  return (
    <ThemeProvider theme={theme}>
      <Paper
        className="app-container"
        // style={{
        //   backgroundImage:
        //     "url(https://images.unsplash.com/photo-1495195129352-aeb325a55b65?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1476&q=80)",
        //   backgroundSize: "contain",
        //   backgroundPosition: "center top 4.25em",
        //   backgroundRepeat: "no-repeat",
        //   height: "100vh",
        //   margin: 0,
        //   padding: 0,
        // }}
      >
        <Banner toggleTheme={toggleTheme} isDarkMode={isDarkMode} />
        <WheelComponent />
      </Paper>
    </ThemeProvider>
  );
};

export default App;
