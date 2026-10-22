import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** false quando as variáveis de ambiente ainda não foram configuradas. */
export const supabaseConfigurado = Boolean(url && anonKey);

export const supabase: SupabaseClient = createClient(
  url ?? "https://nao-configurado.supabase.co",
  anonKey ?? "nao-configurado",
  {
    auth: {
      // "implicit": o link do e-mail funciona em qualquer navegador ou aparelho.
      // Com "pkce" ele só completa a entrada no navegador em que foi pedido,
      // o que falha quando a pessoa abre o e-mail no celular.
      flowType: "implicit",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);
