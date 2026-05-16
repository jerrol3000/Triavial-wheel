const express = require("express");
const { getRandomQuestions, CATEGORIES, getBucketCount, getTotalCount } = require("../questions");
const { optionalAuth } = require("../auth");

const router = express.Router();

// optionalAuth populates req.user when a valid token is sent, otherwise
// the request proceeds anonymously. Logged-in callers get per-user
// no-repeat filtering; anonymous callers keep the pure-random behavior.
router.get("/", optionalAuth, (req, res) => {
  const categoryId = req.query.category ? Number(req.query.category) : null;
  const difficulty = String(req.query.difficulty || "easy");
  const amount = Math.max(1, Math.min(50, Number(req.query.amount || 10)));
  if (!["easy", "medium", "hard"].includes(difficulty)) return res.status(400).json({ error: "invalid difficulty" });
  const userId = req.user && req.user.id ? req.user.id : null;
  const results = getRandomQuestions({ categoryId, difficulty, amount, userId });
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
