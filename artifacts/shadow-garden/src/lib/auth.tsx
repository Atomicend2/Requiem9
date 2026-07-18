import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { UserProfile } from "@workspace/api-client-react/src/generated/api.schemas";
import { setAuthTokenGetter } from "@workspace/api-client-react/src/custom-fetch";

interface AuthContextType {
  user: UserProfile | null;
  token: string | null;
  login: (token: string, user: UserProfile) => void;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const storedToken = localStorage.getItem("sg_token");
    const storedUser = localStorage.getItem("sg_user");

    if (storedToken && storedUser) {
      try {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));
        setAuthTokenGetter(() => storedToken);
      } catch (e) {
        localStorage.removeItem("sg_token");
        localStorage.removeItem("sg_user");
      }
    }
    setIsLoaded(true);
  }, []);

  const login = (newToken: string, newUser: UserProfile) => {
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem("sg_token", newToken);
    localStorage.setItem("sg_user", JSON.stringify(newUser));
    setAuthTokenGetter(() => newToken);
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem("sg_token");
    localStorage.removeItem("sg_user");
    setAuthTokenGetter(null);
  };

  if (!isLoaded) {
    return null; // Or a loading screen
  }

  return (
    <AuthContext.Provider value={{ user, token, login, logout, isAuthenticated: !!token }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
