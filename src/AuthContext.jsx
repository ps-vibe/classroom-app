import { createContext, useContext, useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "./firebase";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [claims, setClaims] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (u) {
        const result = await u.getIdTokenResult();
        setClaims(result.claims);
      } else {
        setClaims(null);
      }
      setUser(u);
      setLoading(false);
    });
    return unsub;
  }, []);

  const logout = () => signOut(auth);

  // role เป็น "student" เฉพาะนักเรียน ครูจะไม่มีค่านี้ (undefined)
  const isStudent = claims?.role === "student";
  const isTeacher = !!user && !isStudent;

  return (
    <AuthContext.Provider value={{ user, claims, loading, logout, isStudent, isTeacher }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);