import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { api, setToken } from "../api/client";
import { load, save, remove } from "../utils/storage";
import { resetGuestPlays } from "../utils/guestLimit";

export const register = createAsyncThunk("auth/register", async (payload, { rejectWithValue }) => {
  try {
    const { data } = await api.post("/auth/register", payload);
    setToken(data.token);
    save("user", data.user);
    // The guest round counter is now meaningless — wipe it so the user
    // never hits the cap again if they ever log out.
    resetGuestPlays();
    return data.user;
  } catch (e) {
    return rejectWithValue(e?.response?.data?.error || "registration failed");
  }
});

export const login = createAsyncThunk("auth/login", async (payload, { rejectWithValue }) => {
  try {
    const { data } = await api.post("/auth/login", payload);
    setToken(data.token);
    save("user", data.user);
    resetGuestPlays();
    return data.user;
  } catch (e) {
    return rejectWithValue(e?.response?.data?.error || "login failed");
  }
});

export const fetchMe = createAsyncThunk("auth/me", async (_, { rejectWithValue }) => {
  try {
    const { data } = await api.get("/auth/me");
    save("user", data);
    return data;
  } catch (e) {
    return rejectWithValue(e?.response?.data?.error || "failed");
  }
});

export const logout = createAsyncThunk("auth/logout", async () => {
  setToken(null);
  remove("user");
  return null;
});

const slice = createSlice({
  name: "auth",
  initialState: {
    user: load("user", null),
    loading: false,
    error: null,
  },
  reducers: {
    clearError: (s) => { s.error = null; },
  },
  extraReducers: (b) => {
    b.addCase(register.pending,  (s) => { s.loading = true; s.error = null; })
     .addCase(register.fulfilled,(s, a) => { s.loading = false; s.user = a.payload; })
     .addCase(register.rejected, (s, a) => { s.loading = false; s.error = a.payload; })
     .addCase(login.pending,     (s) => { s.loading = true; s.error = null; })
     .addCase(login.fulfilled,   (s, a) => { s.loading = false; s.user = a.payload; })
     .addCase(login.rejected,    (s, a) => { s.loading = false; s.error = a.payload; })
     .addCase(logout.fulfilled,  (s) => { s.user = null; })
     .addCase(fetchMe.fulfilled, (s, a) => { s.user = a.payload; });
  },
});

export const { clearError } = slice.actions;
export default slice.reducer;
