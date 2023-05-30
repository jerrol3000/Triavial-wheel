import React, { useState } from "react";
import { data } from "./data";

import { Wheel } from "react-custom-roulette";

const WheelComponent = () => {
  const [mustSpin, setMustSpin] = useState(false);
  const [prizeNumber, setPrizeNumber] = useState(0);
  const [spinCompleted, setSpinCompleted] = useState(false);

  const handlepinClick = () => {
    if (!mustSpin) {
      const newPrizeNumber = Math.floor(Math.random() * data.length);
      setPrizeNumber(newPrizeNumber);
      setMustSpin(true);
      setSpinCompleted(false);
    }
  };

  return (
    <>
      <Wheel
        mustStartSpinning={mustSpin}
        prizeNumber={prizeNumber}
        data={data}
        backgroundColors={["#3e3e3e", "#df3428"]}
        textColors={["#ffffff"]}
        onStopSpinning={() => {
          setMustSpin(false);
          setSpinCompleted(true);
        }}
      />
      <button onClick={handlepinClick}>SPIN</button>

      {spinCompleted && <h3>Your category is {data[prizeNumber].option}</h3>}
    </>
  );
};

export default WheelComponent;
