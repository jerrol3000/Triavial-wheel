import { createLogger } from "redux-logger";
import { configureStore } from "@reduxjs/toolkit";
import questionReducer from "./questionSlice";

const store = configureStore({
  reducer: questionReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(createLogger({ collapsed: true })),
});

export default store;
