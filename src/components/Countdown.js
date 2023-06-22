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
    countdown > 0 && (
      <div
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          padding: "10px",
          borderRadius: "5px",
          backgroundColor: "rgba(0, 0, 0, 0.8)",
          color: "#fff",
          zIndex: 9999,
        }}
      >
        <h1>Countdown: {countdown}</h1>
      </div>
    )
  );
};

export default Countdown;
