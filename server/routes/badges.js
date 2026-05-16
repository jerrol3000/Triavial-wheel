const express = require("express");
const { requireAuth, optionalAuth } = require("../auth");
const badges = require("../badges");

const router = express.Router();

// Public catalog — anyone can browse. When authed, response also includes
// what the caller has earned + which 3 are equipped in their badge case.
router.get("/catalog", optionalAuth, (req, res) => {
  const catalog = badges.listCatalog();
  let earned = [], equipped = [];
  if (req.user && req.user.id) {
    earned = badges.listEarned(req.user.id);
    equipped = badges.listEquipped(req.user.id);
  }
  res.json({ catalog, earned, equipped });
});

// Equip a badge into slot 1, 2, or 3 of the badge case. Slot 1 is the
// primary one rendered next to username in compact contexts.
router.post("/equip", requireAuth, (req, res) => {
  const id = String(req.body && req.body.id || "");
  const slot = Number(req.body && req.body.slot);
  if (!id) return res.status(400).json({ error: "missing id" });
  const result = badges.equipBadge(req.user.id, id, slot);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

router.post("/unequip", requireAuth, (req, res) => {
  const id = String(req.body && req.body.id || "");
  if (!id) return res.status(400).json({ error: "missing id" });
  res.json(badges.unequipBadge(req.user.id, id));
});

module.exports = router;
