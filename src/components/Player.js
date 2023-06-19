import React, { useState } from "react";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";

const Players = () => {
  const [player, setPlayer] = useState("");
  const [nameList, setNameList] = useState([]);

  const handleNameChange = (e) => {
    setPlayer(e.target.value);
  };

  const handleAddName = () => {
    if (player.trim() !== "") {
      setNameList([...nameList, player]);
      setPlayer("");
    }
  };

  return (
    <Box
      component="form"
      sx={{
        "& > :not(style)": { m: 1, width: "25ch" },
      }}
      noValidate
      autoComplete="off"
    >
      <TextField
        id="standard-basic"
        label="Player name"
        variant="standard"
        value={player}
        onChange={handleNameChange}
      />
      <Button variant="contained" onClick={handleAddName}>
        Add Name
      </Button>
      {nameList.length > 0 && (
        <Typography variant="body1">
          {nameList.map((name, index) => (
            <span
              key={index}
              style={{ fontWeight: "bold", marginRight: "5px" }}
            >
              {name}
            </span>
          ))}
        </Typography>
      )}
    </Box>
  );
};

export default Players;
