const express = require("express");
const { getRandomQuestions, CATEGORIES, getBucketCount, getTotalCount } = require("../questions");

const router = express.Router();

router.get("/", (req, res) => {
  const categoryId = req.query.category ? Number(req.query.category) : null;
  const difficulty = String(req.query.difficulty || "easy");
  const amount = Math.max(1, Math.min(50, Number(req.query.amount || 10)));
  if (!["easy", "medium", "hard"].includes(difficulty)) return res.status(400).json({ error: "invalid difficulty" });
  const results = getRandomQuestions({ categoryId, difficulty, amount });
  res.json({ response_code: 0, results });
});

router.get("/stats", (req, res) => {
  const total = getTotalCount();
  const buckets = {};
  for (const cat of CATEGORIES) {
    buckets[cat.name] = {
      easy: getBucketCount(cat.id, "easy"),
      medium: getBucketCount(cat.id, "medium"),
      hard: getBucketCount(cat.id, "hard"),
    };
  }
  res.json({ total, buckets });
});

module.exports = router;
