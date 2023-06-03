import React, { useEffect, useState } from "react";
import { data } from "./data";
import { useDispatch, useSelector } from "react-redux";
import { Wheel } from "react-custom-roulette";
import { fetchQuestion } from "../store/questionSlice";
import { Typography, Button, Grid } from "@material-ui/core";
import { makeStyles } from "@material-ui/core/styles";

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

  const handlepinClick = () => {
    if (!mustSpin) {
      const newPrizeNumber = Math.floor(Math.random() * data.length);
      setPrizeNumber(newPrizeNumber);
      setMustSpin(true);

      dispatch(fetchQuestion(data[newPrizeNumber].id));

      setSpinCompleted(false);
      setSelectedAnswer(null);
    }
  };

  const handleAnswerClick = (answer) => {
    setSelectedAnswer(answer);
  };

  return (
    <>
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
        onClick={handlepinClick}
        disabled={mustSpin}
      >
        SPIN
      </Button>

      {spinCompleted && (
        <div>
          <Typography variant="h3">{data[prizeNumber].option}</Typography>
          <Typography variant="h6">{selected.question}</Typography>
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
