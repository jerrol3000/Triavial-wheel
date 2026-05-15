import axios from "axios";
import { load, save, remove } from "../utils/storage";

const baseURL = process.env.API_BASE_URL || "http://localhost:4000/api";

export const api = axios.create({ baseURL, timeout: 10000 });

let token = load("token", null);
export function getToken() { return token; }
export function setToken(t) {
  token = t;
  if (t) save("token", t);
  else remove("token");
}

api.interceptors.request.use((cfg) => {
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});
