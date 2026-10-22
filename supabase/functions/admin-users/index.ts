// Função de servidor: gestão de usuários (somente administradores).
//
// Por que existe: criar usuário no Supabase Auth e definir o papel dele exige
// a chave de servidor (service_role), que nunca pode ir para o navegador.
// Esta função confere que quem chama é um administrador ativo e só então age.
//
// Ações (POST JSON):
//   { "acao": "convidar", "email", "nome", "perfil": "admin"|"equipe"|"cliente",
//     "empresas": [{ "client_id", "pode_aprovar" }],      // perfil cliente
//     "clientes_equipe": ["client_id", ...],               // perfil equipe
//     "enviar_link": true, "redirect_to": "https://..." }
//   { "acao": "atualizar", "user_id", "nome"?, "perfil"?, "ativo"? }
//   { "acao": "enviar_link", "user_id", "redirect_to" }

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PERFIS = ["admin", "equipe", "cliente"] as const;
type Perfil = (typeof PERFIS)[number];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BAN_PERMANENTE = "876000h"; // ~100 anos

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });
}

function adminClient(actorId: string): SupabaseClient {
  // O cabeçalho x-actor-id faz a auditoria do banco registrar o admin como autor.
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-actor-id": actorId } },
  });
}

async function quemChama(req: Request): Promise<string> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Sessão ausente. Entre novamente.");
  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await anon.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Sessão inválida ou expirada. Entre novamente.");

  const svc = adminClient(data.user.id);
  const { data: perfil } = await svc
    .from("profiles").select("role, ativo").eq("id", data.user.id).maybeSingle();
  if (!perfil || perfil.role !== "admin" || !perfil.ativo) {
    throw new HttpError(403, "Somente administradores gerenciam usuários.");
  }
  return data.user.id;
}

function texto(v: unknown, max = 200): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

function perfilValido(v: unknown): Perfil {
  if (typeof v === "string" && (PERFIS as readonly string[]).includes(v)) return v as Perfil;
  throw new HttpError(400, "Perfil inválido. Use admin, equipe ou cliente.");
}

function redirectValido(v: unknown): string | undefined {
  const r = texto(v, 500);
  if (!r) return undefined;
  try {
    const u = new URL(r);
    if (u.protocol !== "https:" && u.hostname !== "localhost") return undefined;
    return u.toString();
  } catch {
    return undefined;
  }
}

async function enviarLink(email: string, redirectTo?: string): Promise<string | null> {
  // signInWithOtp com shouldCreateUser=false: só manda para quem já existe.
  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { error } = await anon.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
  });
  return error ? error.message : null;
}

async function convidar(actorId: string, body: Record<string, unknown>) {
  const svc = adminClient(actorId);
  const email = texto(body.email, 254)?.toLowerCase();
  if (!email || !EMAIL_RE.test(email)) throw new HttpError(400, "Informe um e-mail válido.");
  const nome = texto(body.nome, 120);
  const perfil = perfilValido(body.perfil);

  const { data: existente } = await svc.from("profiles").select("id, role").eq("email", email).maybeSingle();
  if (existente) {
    throw new HttpError(409, JSON.stringify({
      mensagem: "Este e-mail já tem cadastro. Edite o usuário existente.",
      user_id: existente.id,
      perfil: existente.role,
    }));
  }

  const empresas = Array.isArray(body.empresas) ? body.empresas : [];
  const clientesEquipe = Array.isArray(body.clientes_equipe) ? body.clientes_equipe : [];
  for (const e of empresas) {
    if (!e || typeof e !== "object" || !UUID_RE.test(String((e as Record<string, unknown>).client_id))) {
      throw new HttpError(400, "Empresa inválida na lista de vínculos.");
    }
  }
  for (const c of clientesEquipe) {
    if (!UUID_RE.test(String(c))) throw new HttpError(400, "Cliente inválido na lista de acesso da equipe.");
  }

  const { data: criado, error } = await svc.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: { role: perfil },
    user_metadata: nome ? { nome } : {},
  });
  if (error || !criado.user) throw new HttpError(400, `Não foi possível criar o usuário: ${error?.message ?? "erro desconhecido"}`);
  const userId = criado.user.id;

  await svc.rpc("log_admin_event", {
    p_action: "usuario.convidado",
    p_entity: "profiles",
    p_entity_id: userId,
    p_details: { email, perfil },
  });

  const avisos: string[] = [];
  if (perfil === "cliente" && empresas.length) {
    const linhas = empresas.map((e) => {
      const r = e as Record<string, unknown>;
      return { client_id: String(r.client_id), user_id: userId, pode_aprovar: r.pode_aprovar !== false };
    });
    const { error: e1 } = await svc.from("client_members").insert(linhas);
    if (e1) avisos.push(`Usuário criado, mas o vínculo com a empresa falhou: ${e1.message}`);
  }
  if (perfil === "equipe" && clientesEquipe.length) {
    const linhas = clientesEquipe.map((c) => ({ user_id: userId, client_id: String(c) }));
    const { error: e2 } = await svc.from("staff_client_access").insert(linhas);
    if (e2) avisos.push(`Usuário criado, mas o acesso aos clientes falhou: ${e2.message}`);
  }

  let linkEnviado = false;
  if (body.enviar_link === true) {
    const falha = await enviarLink(email, redirectValido(body.redirect_to));
    if (falha) avisos.push(`Usuário criado, mas o e-mail de acesso não saiu: ${falha}`);
    else linkEnviado = true;
  }

  return { user_id: userId, link_enviado: linkEnviado, avisos };
}

async function atualizar(actorId: string, body: Record<string, unknown>) {
  const svc = adminClient(actorId);
  const userId = String(body.user_id ?? "");
  if (!UUID_RE.test(userId)) throw new HttpError(400, "Usuário inválido.");

  const { data: atual } = await svc.from("profiles").select("id, role, ativo").eq("id", userId).maybeSingle();
  if (!atual) throw new HttpError(404, "Usuário não encontrado.");

  const mudancas: Record<string, unknown> = {};
  if ("nome" in body) mudancas.nome = texto(body.nome, 120);
  if ("perfil" in body) mudancas.role = perfilValido(body.perfil);
  if ("ativo" in body) mudancas.ativo = body.ativo === true;

  if (userId === actorId && (mudancas.ativo === false || (mudancas.role && mudancas.role !== "admin"))) {
    throw new HttpError(400, "Você não pode desativar nem rebaixar o seu próprio acesso.");
  }
  if (!Object.keys(mudancas).length) return { ok: true };

  const { error } = await svc.from("profiles").update(mudancas).eq("id", userId);
  if (error) throw new HttpError(400, error.message);

  // Mantém o Auth coerente: papel no app_metadata e bloqueio de login se inativo.
  const authUpdate: Record<string, unknown> = {};
  if (mudancas.role) authUpdate.app_metadata = { role: mudancas.role };
  if ("ativo" in mudancas) authUpdate.ban_duration = mudancas.ativo ? "none" : BAN_PERMANENTE;
  if (Object.keys(authUpdate).length) {
    const { error: eAuth } = await svc.auth.admin.updateUserById(userId, authUpdate);
    if (eAuth) {
      return { ok: true, avisos: [`Perfil atualizado, mas o login não foi ajustado: ${eAuth.message}`] };
    }
  }
  return { ok: true };
}

async function reenviar(actorId: string, body: Record<string, unknown>) {
  const svc = adminClient(actorId);
  const userId = String(body.user_id ?? "");
  if (!UUID_RE.test(userId)) throw new HttpError(400, "Usuário inválido.");
  const { data: p } = await svc.from("profiles").select("email, ativo").eq("id", userId).maybeSingle();
  if (!p) throw new HttpError(404, "Usuário não encontrado.");
  if (!p.ativo) throw new HttpError(400, "Usuário inativo. Reative antes de enviar o link.");
  const falha = await enviarLink(p.email, redirectValido(body.redirect_to));
  if (falha) throw new HttpError(502, `O e-mail não saiu: ${falha}`);
  await svc.rpc("log_admin_event", {
    p_action: "usuario.link_enviado", p_entity: "profiles", p_entity_id: userId, p_details: {},
  });
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { erro: "Método não permitido." });

  try {
    const actorId = await quemChama(req);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    switch (body.acao) {
      case "convidar":
        return json(200, await convidar(actorId, body));
      case "atualizar":
        return json(200, await atualizar(actorId, body));
      case "enviar_link":
        return json(200, await reenviar(actorId, body));
      default:
        return json(400, { erro: "Ação desconhecida." });
    }
  } catch (e) {
    if (e instanceof HttpError) {
      let corpo: Record<string, unknown> = { erro: e.message };
      try {
        const parsed = JSON.parse(e.message);
        if (parsed && typeof parsed === "object") corpo = { erro: parsed.mensagem, ...parsed };
      } catch { /* mensagem simples */ }
      return json(e.status, corpo);
    }
    console.error(e);
    return json(500, { erro: "Erro inesperado no servidor." });
  }
});
