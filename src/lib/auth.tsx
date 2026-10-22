import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, supabaseConfigurado } from "./supabase";
import type { Profile } from "../types";

interface AuthState {
  carregando: boolean;
  session: Session | null;
  perfil: Profile | null;
  erroPerfil: string | null;
  recarregarPerfil: () => Promise<void>;
  sair: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [perfil, setPerfil] = useState<Profile | null>(null);
  const [erroPerfil, setErroPerfil] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(supabaseConfigurado);

  const carregarPerfil = useCallback(async (s: Session | null) => {
    if (!s) {
      setPerfil(null);
      setErroPerfil(null);
      return;
    }
    const { data, error } = await supabase.from("profiles").select("*").eq("id", s.user.id).maybeSingle();
    setPerfil(data ?? null);
    setErroPerfil(error ? error.message : null);
  }, []);

  useEffect(() => {
    if (!supabaseConfigurado) return;
    let ativo = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!ativo) return;
      setSession(data.session);
      // Depois de entrar pelo link, tira o código de uso único do endereço.
      if (data.session && new URLSearchParams(window.location.search).has("code")) {
        window.history.replaceState(null, "", window.location.pathname);
      }
      await carregarPerfil(data.session);
      if (ativo) setCarregando(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evento, s) => {
      setSession(s);
      // Fora do callback para não travar o cliente do Supabase.
      setTimeout(() => {
        void carregarPerfil(s);
      }, 0);
    });
    return () => {
      ativo = false;
      sub.subscription.unsubscribe();
    };
  }, [carregarPerfil]);

  const recarregarPerfil = useCallback(() => carregarPerfil(session), [carregarPerfil, session]);
  const sair = useCallback(async () => {
    await supabase.auth.signOut();
    setPerfil(null);
    window.history.replaceState(null, "", "/");
  }, []);

  return (
    <AuthContext.Provider value={{ carregando, session, perfil, erroPerfil, recarregarPerfil, sair }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth fora do AuthProvider");
  return ctx;
}
