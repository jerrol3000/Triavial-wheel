import React, { useEffect, useState } from "react";
import { data } from "./data";
import { useDispatch, useSelector } from "react-redux";
import { Wheel } from "react-custom-roulette";
import {
  fetchQuestion,
  resetCountdown,
  hideAnswer,
} from "../store/questionSlice";
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
import Countdown from "./Countdown";
import { Reveal } from "semantic-ui-react";

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
  const { results } = useSelector((state) => state.questions);
  const { revealAnswer } = useSelector((state) => state);

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
      dispatch(resetCountdown());
      dispatch(fetchQuestion({ id: data[newPrizeNumber].id, mode }));

      setSpinCompleted(false);
      setSelectedAnswer(null);
    }
  };

  const showAllAnswers = (isAnswer) => {
    if (selected && selected.correct_answer !== isAnswer) {
      const answerButtons = document.getElementsByClassName(
        classes.answerButton
      );
      for (let i = 0; i < answerButtons.length; i++) {
        const button = answerButtons[i];
        const buttonText = button.textContent;
        if (buttonText === selected.correct_answer) {
          button.classList.add(classes.correctAnswer);
        } else {
          button.classList.add(classes.incorrectAnswer);
        }
      }
    }
  };

  const handleAnswerClick = (answer) => {
    setSelectedAnswer(answer);
    showAllAnswers(answer);
  };

  if (revealAnswer) {
    answers.map((answer) => {
      showAllAnswers(answer);
    });
    dispatch(hideAnswer());
  }

  const handleModeChange = (event) => {
    setMode(event.target.value);
  };

  return (
    <Box
      display="flex"
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      minHeight="100vh"
    >
      {spinCompleted && <Countdown />}
      <Box marginBottom={2}>
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

      {/* <Box display="flex" justifyContent="flex-end" marginBottom={2}>
        <Players />
      </Box> */}
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

      {spinCompleted ? (
        results && results.length > 0 ? (
          <div>
            <Typography variant="h3">{data[prizeNumber].option}</Typography>
            <Typography variant="h6">{decode(selected.question)}</Typography>
            <Grid container spacing={1}>
              {answers.map((answer, index) => (
                <Grid item xs={12} key={index}>
                  <Button
                    className={`${classes.answerButton} ${
                      answer === selected.correct_answer
                        ? selectedAnswer === answer
                          ? classes.correctAnswer
                          : ""
                        : selectedAnswer === answer
                        ? classes.incorrectAnswer
                        : ""
                    }`}
                    fullWidth
                    variant="contained"
                    onClick={() => handleAnswerClick(answer)}
                  >
                    {decode(answer)}
                  </Button>
                </Grid>
              ))}
            </Grid>
          </div>
        ) : (
          <Typography variant="h6">
            No questions available. Spin again!
          </Typography>
        )
      ) : null}
    </Box>
  );
};

export default WheelComponent;
