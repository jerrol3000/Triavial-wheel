import React from "react";
import { makeStyles } from "@material-ui/core/styles";
import { AppBar, Toolbar, Typography, Switch } from "@material-ui/core";

const useStyles = makeStyles(() => ({
  appBar: {
    backgroundColor: "#3f51b5",
  },
  title: {
    flexGrow: 1,
    textAlign: "center",
    fontSize: "2rem",
    fontWeight: "bold",
  },
  toggleContainer: {
    display: "flex",
    alignItems: "center",
  },
}));

export default function Banner({ toggleTheme, isDarkMode }) {
  const classes = useStyles();
  return (
    <AppBar position="static" className={classes.appBar}>
      <Toolbar>
        <Typography variant="h1" className={classes.title}>
          Trivia Wheel
        </Typography>
        <div className={classes.toggleContainer}>
          <Switch color="default" onChange={toggleTheme} />
          <Typography variant="body1">
            {isDarkMode ? "Dark" : "Light"} Mode
          </Typography>
        </div>
      </Toolbar>
    </AppBar>
  );
}
