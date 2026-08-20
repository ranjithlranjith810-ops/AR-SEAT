import { createContext } from "react";
import type { PublicUser } from "../lib/types";

export interface AuthContextValue {
  user: PublicUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);