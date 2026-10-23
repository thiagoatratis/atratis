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

/** Provedores de login ligados no painel do Supabase (ex.: Google). */
export async function provedoresAtivos(): Promise<{ google: boolean }> {
  if (!url || !anonKey) return { google: false };
  try {
    const r = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: anonKey } });
    const j = (await r.json()) as { external?: Record<string, boolean> };
    return { google: !!j.external?.google };
  } catch {
    return { google: false };
  }
}
