import React, { useEffect, useState } from "react";
import { data } from "./data";
import { useDispatch, useSelector } from "react-redux";
import { Wheel } from "react-custom-roulette";
import { fetchQuestion } from "../store/questionSlice";
import {
  Typography,
  Button,
  Grid,
  Radio,
  RadioGroup,
  FormControlLabel,
  Box,
} from "@material-ui/core";
import { makeStyles } from "@material-ui/core/styles";
import { decode } from "html-entities";
import Players from "./Player";

const useStyles = makeStyles((theme) => ({
  answerButton: {
    marginBottom: theme.spacing(1),
  },
  correctAnswer: {
    backgroundColor: theme.palette.success.main,
  },
  incorrectAnswer: {
    backgroundColor: theme.palette.error.main,
  },
}));

const WheelComponent = () => {
  const classes = useStyles();

  const [mustSpin, setMustSpin] = useState(false);
  const [prizeNumber, setPrizeNumber] = useState(0);
  const [spinCompleted, setSpinCompleted] = useState(false);
  const [selected, setSelected] = useState({});
  const [answers, setAnswers] = useState([]);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [mode, setMode] = useState("easy");

  const dispatch = useDispatch();
  const { results } = useSelector((state) => state);
  useEffect(() => {
    if (spinCompleted && results && results.length > 0) {
      const randomIndex = Math.floor(Math.random() * results.length);
      setSelected(results[randomIndex]);

      const { correct_answer, incorrect_answers } = results[randomIndex];
      let shuffledAnswers = [];

      if (Array.isArray(incorrect_answers)) {
        shuffledAnswers = [...incorrect_answers, correct_answer];
      } else {
        shuffledAnswers = [incorrect_answers, correct_answer];
      }

      shuffledAnswers.sort(() => Math.random() - 0.5);

      setAnswers(shuffledAnswers);
    }
  }, [spinCompleted, results]);

  const handleSpinClick = () => {
    if (!mustSpin) {
      const newPrizeNumber = Math.floor(Math.random() * data.length);
      setPrizeNumber(newPrizeNumber);
      setMustSpin(true);

      dispatch(fetchQuestion({ id: data[newPrizeNumber].id, mode }));

      setSpinCompleted(false);
      setSelectedAnswer(null);
    }
  };

  const handleAnswerClick = (answer) => {
    setSelectedAnswer(answer);
  };
  const handleModeChange = (event) => {
    setMode(event.target.value);
  };

  return (
    <>
      <Box display="flex" justifyContent="flex-end" marginBottom={2}>
        <RadioGroup
          row
          aria-label="mode"
          name="mode"
          value={mode}
          onChange={handleModeChange}
        >
          <FormControlLabel value="easy" control={<Radio />} label="Easy" />
          <FormControlLabel value="medium" control={<Radio />} label="Medium" />
          <FormControlLabel value="hard" control={<Radio />} label="Hard" />
        </RadioGroup>
      </Box>
      <Box display="flex" justifyContent="flex-end" marginBottom={2}>
        <Players />
      </Box>

      <Wheel
        mustStartSpinning={mustSpin}
        prizeNumber={prizeNumber}
        data={data}
        fontSize={13}
        backgroundColors={["#3e3e3e", "#df3428"]}
        textColors={["#ffffff"]}
        onStopSpinning={() => {
          setMustSpin(false);
          setSpinCompleted(true);
        }}
      />
      <Button
        variant="contained"
        color="primary"
        onClick={handleSpinClick}
        disabled={mustSpin}
      >
        SPIN
      </Button>

      {spinCompleted && (
        <div>
          <Typography variant="h3">{data[prizeNumber].option}</Typography>
          <Typography variant="h6">{decode(selected.question)}</Typography>
          <Grid container spacing={1}>
            {answers.map((answer, index) => (
              <Grid item xs={12} key={index}>
                <Button
                  className={`${classes.answerButton} ${
                    selectedAnswer === answer
                      ? answer === selected.correct_answer
                        ? classes.correctAnswer
                        : classes.incorrectAnswer
                      : ""
                  }`}
                  fullWidth
                  variant="contained"
                  onClick={() => handleAnswerClick(answer)}
                >
                  {answer}
                </Button>
              </Grid>
            ))}
          </Grid>
        </div>
      )}
    </>
  );
};

export default WheelComponent;
