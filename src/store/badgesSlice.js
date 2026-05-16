import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { api } from "../api/client";

const initialState = {
  catalog: [],   // all badges in the system
  earned: [],    // [{ badge_id, earned_at, equipped_slot }]
  equipped: [],  // [{ badge_id, name, icon, tier, category, equipped_slot }]
  loaded: false,
};

export const fetchBadges = createAsyncThunk("badges/fetch", async () => {
  const { data } = await api.get("/badges/catalog");
  return data;
});

export const equipBadge = createAsyncThunk("badges/equip", async ({ id, slot }, { rejectWithValue }) => {
  try {
    const { data } = await api.post("/badges/equip", { id, slot });
    return { id, slot, ...data };
  } catch (e) {
    return rejectWithValue(e?.response?.data || { error: "equip_failed" });
  }
});

export const unequipBadge = createAsyncThunk("badges/unequip", async (id, { rejectWithValue }) => {
  try {
    const { data } = await api.post("/badges/unequip", { id });
    return { id, ...data };
  } catch (e) {
    return rejectWithValue(e?.response?.data || { error: "unequip_failed" });
  }
});

const slice = createSlice({
  name: "badges",
  initialState,
  reducers: {
    // Called by the post-game / post-purchase flows when the server
    // returns new_badges. Adds them to earned so they show as unlocked
    // without an extra round-trip.
    awardLocal(state, action) {
      const newBadges = action.payload || [];
      const now = Date.now();
      for (const b of newBadges) {
        if (!state.earned.find((e) => e.badge_id === b.id)) {
          state.earned.push({ badge_id: b.id, earned_at: now, equipped_slot: null });
        }
      }
    },
    resetBadges: () => initialState,
  },
  extraReducers: (b) => {
    b.addCase(fetchBadges.fulfilled, (s, a) => {
      s.catalog = a.payload.catalog || [];
      s.earned = a.payload.earned || [];
      s.equipped = a.payload.equipped || [];
      s.loaded = true;
    });
    b.addCase(equipBadge.fulfilled, (s, a) => {
      const slot = a.payload.slot;
      const id = a.payload.id;
      // Clear whoever was in this slot, and clear this badge's old slot.
      s.earned = s.earned.map((e) => {
        if (e.equipped_slot === slot) return { ...e, equipped_slot: null };
        if (e.badge_id === id) return { ...e, equipped_slot: slot };
        return e;
      });
      s.equipped = s.earned
        .filter((e) => e.equipped_slot != null)
        .map((e) => {
          const cat = s.catalog.find((c) => c.id === e.badge_id);
          return { badge_id: e.badge_id, equipped_slot: e.equipped_slot, name: cat?.name, icon: cat?.icon, tier: cat?.tier, category: cat?.category };
        })
        .sort((a, b) => a.equipped_slot - b.equipped_slot);
    });
    b.addCase(unequipBadge.fulfilled, (s, a) => {
      s.earned = s.earned.map((e) => e.badge_id === a.payload.id ? { ...e, equipped_slot: null } : e);
      s.equipped = s.equipped.filter((e) => e.badge_id !== a.payload.id);
    });
  },
});

export const { awardLocal, resetBadges } = slice.actions;
export default slice.reducer;
