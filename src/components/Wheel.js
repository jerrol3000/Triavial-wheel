import React, { useRef, useEffect, useState } from "react";
import { useSpring, animated } from "@react-spring/web";

const segments = [
  { label: "Segment 1", color: "#FFCC00", value: 10 },
  { label: "Segment 2", color: "#FF6666", value: 5 },
  { label: "Segment 3", color: "#99CC33", value: 20 },
  { label: "Segment 4", color: "#6699FF", value: 15 },
  { label: "Segment 5", color: "#FF9966", value: 25 },
  { label: "Segment 6", color: "#FF66CC", value: 30 },
];

const Wheel = () => {
  const canvasRef = useRef(null);
  const canvasRef2 = useRef(null);

  const [selectedSegment, setSelectedSegment] = useState(null);
  const [isWheelSpinning, setIsWheelSpinning] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    drawWheel(ctx, canvas);
  }, []);

  useEffect(() => {
    const canvas = canvasRef2.current;
    const ctx = canvas.getContext("2d");
    drawInner(ctx, canvas);
  }, []);

  const drawWheel = (ctx, canvas) => {
    // draw wheel segments
    const segmentAngle = (2 * Math.PI) / segments.length;
    segments.forEach((segment, index) => {
      ctx.beginPath();
      ctx.moveTo(canvas.width / 2, canvas.height / 2);
      ctx.arc(
        canvas.width / 2,
        canvas.height / 2,
        canvas.width / 2,

        index * segmentAngle,
        (index + 1) * segmentAngle
      );
      ctx.fillStyle = segment.color;
      ctx.fill();
      ctx.strokeStyle = "#333";
      ctx.stroke();

      // draw segment label
      const textRadius = canvas.width / 3;
      const segmentMiddleAngle = index * segmentAngle + segmentAngle / 2;
      const x = canvas.width / 2 + textRadius * Math.cos(segmentMiddleAngle);
      const y = canvas.height / 2 + textRadius * Math.sin(segmentMiddleAngle);
      ctx.font = "bold 20px Arial";
      ctx.fillStyle = "white";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(segment.value, x, y);
    });
  };

  const drawInner = (ctx, canvas) => {
    // draw small wheel
    const smallWheelSize = canvas.width / 3;
    ctx.beginPath();
    ctx.arc(
      canvas.width / 2,
      canvas.height / 2,
      smallWheelSize / 2,
      0,
      2 * Math.PI
    );
    ctx.fillStyle = "#ddd";
    ctx.fill();
    ctx.strokeStyle = "#333";
    ctx.stroke();

    // Draw outer circle
    ctx.beginPath();
    const PI2 = Math.PI * 2;
    ctx.arc(200, 200, 69, 0, PI2, false);
    ctx.closePath();
    ctx.lineWidth = 10;
    ctx.strokeStyle = "white" || "black";
    ctx.stroke();

    //draw needle
    ctx.lineWidth = 10;
    ctx.fileStyle = "white";
    ctx.beginPath();
    ctx.moveTo(200 + 20, 200 - 70);
    ctx.lineTo(200 - 20, 200 - 70);
    ctx.lineTo(200, 200 - 90);
    ctx.closePath();
    ctx.strokeStyle = "white";
    ctx.stroke();
    ctx.fill();
  };

  const [animationProps, setAnimationProps] = useSpring(() => ({
    from: { rotate: 0, innerRotate: 0 },
    to: { rotate: 0, innerRotate: 0 },

    config: {
      tension: 100,
      friction: 100,
    },
    onRest: () => {
      // calculate selected segment
      const segmentAngle = (2 * Math.PI) / segments.length;
      const normalizedAngle =
        ((animationProps.rotate % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const selectedSegmentIndex = Math.floor(normalizedAngle / segmentAngle);
      setSelectedSegment(segments[selectedSegmentIndex]);
      setIsWheelSpinning(false);
    },
  }));

  const handleSpinButtonClick = () => {
    if (!isWheelSpinning) {
      setIsWheelSpinning(true);
      setAnimationProps({
        to: { rotate: Math.floor(Math.random() * 3600 + 360) },
        onRest: () => {
          // calculate selected segment
          const segmentAngle = (2 * Math.PI) / segments.length;
          console.log("animationProps.value", animationProps.value);
          const normalizedAngle =
            ((animationProps.rotate % (2 * Math.PI)) + 2 * Math.PI) %
            (2 * Math.PI);
          console.log("animationProps.rotate", animationProps.rotate);
          const selectedSegmentIndex = Math.floor(
            normalizedAngle / segmentAngle
          );
          setSelectedSegment(segments[selectedSegmentIndex]);
          console.log("selectedSegmentIndex", segments[selectedSegmentIndex]);
          setIsWheelSpinning(false);
        },
      });
    }
  };
  console.log("selectedSegment", selectedSegment);

  return (
    <div>
      <animated.canvas
        ref={canvasRef}
        width="400"
        height="400"
        style={{ rotate: animationProps.rotate.to((x) => `${x}rad`) }}
      />
      <button onClick={handleSpinButtonClick}>Spin</button>
      <canvas
        ref={canvasRef2}
        width="400"
        height="400"
        style={{ position: "absolute", top: 0, left: 0 }}
      />

      {selectedSegment && (
        <div>
          <p>Selected segment: {selectedSegment.label}</p>
          <p>Value: {selectedSegment.value}</p>
        </div>
      )}
    </div>
  );
};

export default Wheel;
