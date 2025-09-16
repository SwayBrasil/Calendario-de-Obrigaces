// src/AuthContext.jsx
import React, { createContext, useState, useEffect, useContext } from "react";
import { useNavigate } from "react-router-dom";
import api from "./utils/axiosConfig"; // usa o axiosInstance central

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    // Restaura sessão do localStorage
    const savedUser = localStorage.getItem("user");
    const savedToken = localStorage.getItem("authToken");

    if (savedUser && savedToken) {
      try {
        const userData = JSON.parse(savedUser);
        if (
          userData?.uid &&
          userData?.email &&
          (savedToken.startsWith("mock-token-") || savedToken.length > 20)
        ) {
          setUser(userData);
          console.log("[Auth] sessão restaurada");
        } else {
          console.warn("[Auth] dados/token inválidos – limpando");
          localStorage.removeItem("user");
          localStorage.removeItem("authToken");
        }
      } catch {
        localStorage.removeItem("user");
        localStorage.removeItem("authToken");
      }
    }
    setLoading(false);
  }, []);

  const login = async (email, password) => {
    try {
      console.log("[Login] chamando /api/login");
      const { data } = await api.post("/api/login", { email, password }); // <- caminho correto
      const { token, user: u } = data;
      if (!token || !u) throw new Error("Resposta inválida do servidor");

      const userData = {
        uid: u.uid,
        email: u.email,
        nomeCompleto: u.nomeCompleto,
        cargo: u.cargo || "usuario",
      };

      localStorage.setItem("authToken", token);
      localStorage.setItem("user", JSON.stringify(userData));
      setUser(userData);

      navigate("/home");
    } catch (error) {
      console.error("[Login] erro:", error);
      if (error.response) {
        throw new Error(error.response.data?.error || "Erro no servidor");
      } else if (error.request) {
        throw new Error("Erro de conexão com o servidor");
      } else {
        throw new Error(error.message || "Erro desconhecido");
      }
    }
  };

  const logout = () => {
    console.log("[Logout] limpando sessão");
    setUser(null);
    localStorage.removeItem("authToken");
    localStorage.removeItem("user");
    localStorage.removeItem("rememberedEmail");
    localStorage.removeItem("rememberedPassword");
    navigate("/");
  };

  const clearStorageAndRefresh = () => {
    console.log("[Auth] limpando tudo e recarregando");
    localStorage.clear();
    setUser(null);
    navigate("/");
    window.location.reload();
  };

  const isAdmin = user?.cargo === "admin";

  if (loading) {
    return <div className="flex items-center justify-center h-screen">Carregando...</div>;
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, isAdmin, clearStorageAndRefresh }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de um AuthProvider");
  return ctx;
};
