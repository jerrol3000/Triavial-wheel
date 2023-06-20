import React, { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { startCountdown, revealAnswer } from "../store/questionSlice";

const Countdown = () => {
  const dispatch = useDispatch();
  const countdown = useSelector((state) => state.countdown);
  useEffect(() => {
    let timer = null;

    if (countdown > 0) {
      timer = setInterval(() => {
        dispatch(startCountdown());
      }, 1000);
    } else {
      dispatch(revealAnswer());
    }

    return () => {
      clearInterval(timer);
    };
  }, [countdown, dispatch]);

  // if (countdown === 0) {
  //   return null;
  // }

  return (
    <div>
      <h2>Countdown: {countdown}</h2>
    </div>
  );
};

export default Countdown;
