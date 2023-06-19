import React from "react";
import { makeStyles } from "@material-ui/core/styles";
import { AppBar, Toolbar, Typography } from "@material-ui/core";

const useStyles = makeStyles(() => ({
  appBar: {
    backgroundColor: "#3f51b5", // Set your desired background color
  },
  title: {
    flexGrow: 1,
    textAlign: "center",
    fontSize: "2rem", // Set your desired font size
    fontWeight: "bold", // Set your desired font weight
  },
}));

export default function Banner() {
  const classes = useStyles();

  return (
    <AppBar position="static" className={classes.appBar}>
      <Toolbar>
        <Typography variant="h1" className={classes.title}>
          Triva Wheel
        </Typography>
      </Toolbar>
    </AppBar>
  );
}
