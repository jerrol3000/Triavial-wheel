import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { api } from "../api/client";

// Catalog is the full store inventory, owned is what the user has
// purchased (with qty for consumables), equipped maps category → id of
// the currently-active item per category (frame/pointer/celebration/title).
const initialState = {
  catalog: [],
  owned: [],
  equipped: {},
  loaded: false,
  busy: false,
};

export const fetchCatalog = createAsyncThunk("cosmetics/fetchCatalog", async () => {
  const { data } = await api.get("/store/catalog");
  return data;
});

export const buyCosmetic = createAsyncThunk("cosmetics/buy", async (id, { rejectWithValue }) => {
  try {
    const { data } = await api.post("/store/buy", { id });
    return { id, ...data };
  } catch (e) {
    return rejectWithValue(e?.response?.data || { error: "buy_failed" });
  }
});

export const equipCosmetic = createAsyncThunk("cosmetics/equip", async (id, { rejectWithValue }) => {
  try {
    const { data } = await api.post("/store/equip", { id });
    return data;
  } catch (e) {
    return rejectWithValue(e?.response?.data || { error: "equip_failed" });
  }
});

export const unequipCategory = createAsyncThunk("cosmetics/unequip", async (category, { rejectWithValue }) => {
  try {
    const { data } = await api.post("/store/unequip", { category });
    return data;
  } catch (e) {
    return rejectWithValue(e?.response?.data || { error: "unequip_failed" });
  }
});

export const useBoost = createAsyncThunk("cosmetics/use", async (id, { rejectWithValue }) => {
  try {
    const { data } = await api.post("/store/use", { id });
    return { id, ...data };
  } catch (e) {
    return rejectWithValue(e?.response?.data || { error: "use_failed" });
  }
});

const slice = createSlice({
  name: "cosmetics",
  initialState,
  reducers: {
    resetCosmetics: () => initialState,
  },
  extraReducers: (b) => {
    b.addCase(fetchCatalog.pending, (s) => { s.busy = true; });
    b.addCase(fetchCatalog.fulfilled, (s, a) => {
      s.catalog = a.payload.catalog || [];
      s.owned = a.payload.owned || [];
      s.equipped = a.payload.equipped || {};
      s.loaded = true;
      s.busy = false;
    });
    b.addCase(fetchCatalog.rejected, (s) => { s.busy = false; });

    b.addCase(buyCosmetic.fulfilled, (s, a) => {
      const id = a.payload.id;
      const existing = s.owned.find((o) => o.cosmetic_id === id);
      if (existing) existing.qty += 1;
      else s.owned.push({ cosmetic_id: id, qty: 1, purchased_at: Date.now() });
      // NOTE: client-side auto-equip removed. Server stopped
      // auto-equipping on purchase (everything goes to inventory; the
      // player decides when to equip). If the client kept auto-equipping
      // locally, the very next fetchStats would clear the equip back
      // out to match the server — looked like a flicker bug. Bundles
      // get the same treatment: each granted item lands in inventory
      // only.
      const granted = a.payload.granted || [];
      for (const g of granted) {
        if (g.id === id) continue; // already handled above
        const has = s.owned.find((o) => o.cosmetic_id === g.id);
        if (has && g.consumable) has.qty += 1;
        else if (!has) s.owned.push({ cosmetic_id: g.id, qty: 1, purchased_at: Date.now() });
      }
    });

    b.addCase(equipCosmetic.fulfilled, (s, a) => {
      s.equipped[a.payload.category] = a.payload.cosmetic_id;
    });

    b.addCase(unequipCategory.fulfilled, (s, a) => {
      delete s.equipped[a.payload.category];
    });

    b.addCase(useBoost.fulfilled, (s, a) => {
      const id = a.payload.id;
      const existing = s.owned.find((o) => o.cosmetic_id === id);
      if (existing) {
        existing.qty -= 1;
        if (existing.qty <= 0) s.owned = s.owned.filter((o) => o.cosmetic_id !== id);
      }
    });
  },
});

export const { resetCosmetics } = slice.actions;
export default slice.reducer;

// ── Selectors ────────────────────────────────────────────────────────────
export const selectEquippedItem = (state, category) => {
  const id = state.cosmetics.equipped[category];
  if (!id) return null;
  return state.cosmetics.catalog.find((c) => c.id === id) || null;
};

export const selectOwnedQty = (state, id) => {
  const o = state.cosmetics.owned.find((x) => x.cosmetic_id === id);
  return o ? o.qty : 0;
};

export const isOwned = (state, id) => {
  const item = state.cosmetics.catalog.find((c) => c.id === id);
  if (!item) return false;
  // Free items are "owned" by everyone for equip purposes.
  if (item.price_coins === 0 && !item.pro_only) return true;
  return !!state.cosmetics.owned.find((o) => o.cosmetic_id === id);
};
