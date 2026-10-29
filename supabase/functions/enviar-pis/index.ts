// Função de servidor: envia os P.I.s por e-mail, com os PDFs anexos.
//
// Por que existe: o e-mail sai da conta Gmail da Atratis (senha de app), que
// nunca pode ir para o navegador. A função confere que quem chama é da equipe
// e tem acesso ao cliente, junta os PDFs já gerados e envia.
//
// Configuração (Supabase → Edge Functions → Secrets), colada pelo Thiago:
//   GMAIL_USER          e-mail que envia (ex.: thiago@atratis.com.br)
//   GMAIL_APP_PASSWORD  senha de app do Google para essa conta
//   GMAIL_FROM_NAME     nome do remetente (opcional; padrão "Atratis Digital")
//
// POST JSON: { "pis": ["uuid", ...], "para": ["email", ...], "assunto": "...", "corpo": "..." }
// Todos os P.I.s precisam ser do mesmo orçamento, estar emitidos e ter PDF.
// O envio fica registrado em public.pi_envios (e na auditoria).

import { createClient } from "npm:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.16";

function chave(novas: string, antiga: string): string {
  const bruto = Deno.env.get(novas);
  if (bruto) {
    try {
      const mapa = JSON.parse(bruto) as Record<string, string>;
      const v = mapa.default ?? Object.values(mapa)[0];
      if (typeof v === "string" && v) return v;
    } catch { /* formato inesperado: tenta a chave antiga */ }
  }
  const legado = Deno.env.get(antiga);
  if (legado) return legado;
  throw new Error(`Variável ${novas} (ou ${antiga}) não encontrada.`);
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = chave("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
const SERVICE_KEY = chave("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");

const EMAIL_RE = /^[^@\s,;<>"]+@[^@\s,;<>"]+\.[^@\s,;<>"]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DESTINATARIOS = 10;

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

interface PI {
  id: string;
  numero: string;
  budget_id: string;
  client_id: string;
  status: string;
  pdf_path: string | null;
  veiculacao: string;
}

function nomeArquivo(p: PI): string {
  const base = `PI ${p.numero} - ${p.veiculacao}`.normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 .,-]+/g, "").replace(/\s+/g, " ").trim().slice(0, 120);
  return `${base || `PI ${p.numero}`}.pdf`;
}

async function enviar(req: Request) {
  const gmailUser = Deno.env.get("GMAIL_USER");
  const gmailSenha = Deno.env.get("GMAIL_APP_PASSWORD");
  if (!gmailUser || !gmailSenha) {
    throw new HttpError(503, "O envio pelo sistema ainda não foi configurado. Use \"Enviar pelo meu e-mail\".");
  }

  // Quem chama: sessão válida, perfil de equipe ativo.
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Sessão ausente. Entre novamente.");
  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data: u, error: eu } = await anon.auth.getUser(token);
  if (eu || !u.user) throw new HttpError(401, "Sessão inválida ou expirada. Entre novamente.");

  const svc = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-actor-id": u.user.id } },
  });
  const { data: perfil } = await svc.from("profiles").select("role, ativo, nome, email").eq("id", u.user.id).maybeSingle();
  if (!perfil || !perfil.ativo || perfil.role === "cliente") {
    throw new HttpError(403, "Somente a equipe da Atratis envia P.I.s.");
  }

  // Pedido.
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const ids = Array.isArray(body.pis) ? body.pis.filter((x): x is string => typeof x === "string" && UUID_RE.test(x)) : [];
  if (!ids.length || ids.length > 20) throw new HttpError(400, "Escolha de 1 a 20 P.I.s.");
  const para = Array.isArray(body.para)
    ? [...new Set(body.para.filter((x): x is string => typeof x === "string").map((x) => x.trim().toLowerCase()).filter(Boolean))]
    : [];
  if (!para.length) throw new HttpError(400, "Informe pelo menos um e-mail.");
  if (para.length > MAX_DESTINATARIOS) throw new HttpError(400, `Use no máximo ${MAX_DESTINATARIOS} e-mails.`);
  const invalido = para.find((e) => !EMAIL_RE.test(e));
  if (invalido) throw new HttpError(400, `E-mail inválido: ${invalido}`);
  const assunto = typeof body.assunto === "string" ? body.assunto.replace(/[\r\n]+/g, " ").trim().slice(0, 200) : "";
  const corpo = typeof body.corpo === "string" ? body.corpo.slice(0, 10000) : "";
  if (!assunto || !corpo.trim()) throw new HttpError(400, "Preencha o assunto e a mensagem.");

  // P.I.s: emitidos, com PDF, do mesmo orçamento, e quem chama tem acesso ao cliente
  // (consulta com o token do usuário: a RLS só devolve o que ele pode ver).
  const comoUsuario = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: lista, error: ep } = await comoUsuario.from("insertion_orders")
    .select("id, numero, budget_id, client_id, status, pdf_path, veiculacao").in("id", ids);
  if (ep) throw new HttpError(500, "Não foi possível ler os P.I.s.");
  const pis = (lista ?? []) as PI[];
  if (pis.length !== ids.length) throw new HttpError(403, "Algum P.I. não foi encontrado ou você não tem acesso a ele.");
  if (new Set(pis.map((p) => p.budget_id)).size !== 1) throw new HttpError(400, "Envie juntos só P.I.s do mesmo orçamento.");
  const cancelado = pis.find((p) => p.status !== "emitido");
  if (cancelado) throw new HttpError(400, `O P.I. ${cancelado.numero} está cancelado.`);
  const semPdf = pis.find((p) => !p.pdf_path);
  if (semPdf) throw new HttpError(400, `O PDF do P.I. ${semPdf.numero} ainda não foi gerado. Abra o P.I. e gere o PDF antes.`);

  // Anexos.
  pis.sort((a, b) => a.numero.localeCompare(b.numero));
  const anexos = [];
  for (const p of pis) {
    const { data: arq, error } = await svc.storage.from("pis").download(p.pdf_path!);
    if (error || !arq) throw new HttpError(500, `Não foi possível ler o PDF do P.I. ${p.numero}.`);
    anexos.push({ filename: nomeArquivo(p), content: new Uint8Array(await arq.arrayBuffer()), contentType: "application/pdf" });
  }

  // Envio pelo Gmail (porta 465; o Supabase bloqueia 25 e 587).
  const transporte = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: gmailUser, pass: gmailSenha },
  });
  const nomeRemetente = Deno.env.get("GMAIL_FROM_NAME") || "Atratis Digital";
  try {
    await transporte.sendMail({
      from: { name: nomeRemetente, address: gmailUser },
      to: para,
      replyTo: perfil.email && perfil.email.toLowerCase() !== gmailUser.toLowerCase() ? perfil.email : undefined,
      subject: assunto,
      text: corpo,
      attachments: anexos,
    });
  } catch (e) {
    console.error("Falha no envio:", e instanceof Error ? e.message : e);
    throw new HttpError(502, "O Gmail recusou o envio. Confira a senha de app nas configurações ou use \"Enviar pelo meu e-mail\".");
  }

  const { error: er } = await svc.from("pi_envios").insert({
    budget_id: pis[0].budget_id, client_id: pis[0].client_id, pis: pis.map((p) => p.id), numeros: pis.map((p) => p.numero),
    para, assunto, enviado_por: u.user.id, enviado_por_nome: perfil.nome || perfil.email,
  });
  if (er) console.error("E-mail enviado, mas o registro falhou:", er.message);
  return { enviado: true, para, numeros: pis.map((p) => p.numero) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { erro: "Método não permitido." });
  try {
    return json(200, await enviar(req));
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { erro: e.message });
    console.error(e);
    return json(500, { erro: "Erro inesperado ao enviar os P.I.s." });
  }
});
