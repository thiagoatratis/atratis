// Pedidos de Inserção: emissão (numeração no banco), PDF no Storage e e-mail.
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { ErroApp } from "./api";
import { erro } from "./criativos";
import { formatarMes, formatarMoeda } from "./dinheiro";
import { gerarPdfPI } from "./pdfPi";
import type { CamposEmissaoPI, EnvioPI, PedidoInsercao } from "../types";

const BUCKET = "pis";

const normalizar = (p: PedidoInsercao): PedidoInsercao => ({ ...p, valor: Number(p.valor) });

export async function listarPIs(budgetId: string): Promise<PedidoInsercao[]> {
  const { data, error } = await supabase.from("insertion_orders").select("*")
    .eq("budget_id", budgetId).order("data_emissao").order("sequencia");
  erro(error);
  return ((data ?? []) as PedidoInsercao[]).map(normalizar);
}

export const caminhoPdf = (p: Pick<PedidoInsercao, "client_id" | "id">) => `${p.client_id}/${p.id}.pdf`;

/** Gera o PDF a partir do retrato gravado no banco, envia ao Storage e registra o caminho. */
export async function salvarPdf(p: PedidoInsercao): Promise<Uint8Array> {
  const bytes = await gerarPdfPI(p);
  const caminho = caminhoPdf(p);
  const up = await supabase.storage.from(BUCKET)
    .upload(caminho, new Blob([bytes as BlobPart], { type: "application/pdf" }), { contentType: "application/pdf", upsert: false });
  // Se uma tentativa anterior já enviou o arquivo, basta registrar.
  if (up.error && !/exist|duplicate/i.test(up.error.message)) throw new ErroApp(`O PDF não subiu: ${up.error.message}`);
  const { error } = await supabase.rpc("registrar_pdf_pi", { p_pi: p.id, p_path: caminho });
  erro(error);
  return bytes;
}

/**
 * Emite os P.I.s (o banco numera e grava) e em seguida gera e guarda os PDFs.
 * Se algum PDF falhar, o P.I. continua emitido e a tela oferece gerar de novo.
 */
export async function emitirPIs(budgetId: string, porPlataforma: boolean, campos: CamposEmissaoPI, blocos: string[])
  : Promise<{ pis: PedidoInsercao[]; falhasPdf: number }> {
  const { data, error } = await supabase.rpc("emitir_pis", {
    p_budget: budgetId, p_por_plataforma: porPlataforma, p_dados: campos, p_blocos: blocos,
  });
  erro(error);
  const pis = ((data ?? []) as PedidoInsercao[]).map(normalizar);
  let falhasPdf = 0;
  for (const p of pis) {
    try {
      await salvarPdf(p);
    } catch {
      falhasPdf += 1;
    }
  }
  return { pis, falhasPdf };
}

export async function cancelarPI(id: string, motivo: string): Promise<void> {
  const { error } = await supabase.rpc("cancelar_pi", { p_pi: id, p_motivo: motivo });
  erro(error);
}

/** Nome do arquivo no padrão usado pela Atratis: "20261023 - Cliente - PI 261023.01 - Meta Ads - Novembro 2026.pdf". */
export function nomeArquivoPI(p: PedidoInsercao): string {
  const data = p.data_emissao.replace(/-/g, "");
  const nome = `${data} - ${p.dados_cliente.nome ?? "Cliente"} - PI ${p.numero} - ${p.veiculacao} - ${formatarMes(p.mes_referencia).replace("/", " ")}.pdf`;
  return nome.replace(/[\\/:*?"<>|]+/g, "-");
}

/** Baixa o PDF guardado; se ainda não existir (falha anterior), gera de novo a partir do retrato. */
export async function baixarPdf(p: PedidoInsercao, podeGerar: boolean): Promise<void> {
  let blob: Blob;
  if (p.pdf_path) {
    const { data, error } = await supabase.storage.from(BUCKET).download(p.pdf_path);
    if (error || !data) throw new ErroApp("Não foi possível baixar o PDF.");
    blob = data;
  } else if (podeGerar) {
    blob = new Blob([(await salvarPdf(p)) as BlobPart], { type: "application/pdf" });
  } else {
    throw new ErroApp("O PDF deste P.I. ainda não está disponível. Fale com a Atratis.");
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeArquivoPI(p);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Texto padrão do e-mail (editável antes de copiar). */
export function emailPadrao(pis: PedidoInsercao[], linkPortal: string): { assunto: string; corpo: string } {
  const primeiro = pis[0];
  const cliente = primeiro?.dados_cliente.nome ?? "";
  const mes = formatarMes(primeiro?.mes_referencia);
  const numeros = pis.map((p) => p.numero).join(", ");
  const assunto = pis.length === 1
    ? `P.I. ${primeiro.numero} - ${cliente} - ${primeiro.veiculacao} - ${mes}`
    : `P.I.s ${numeros} - ${cliente} - ${mes}`;
  const linhas = pis.map((p) => `• P.I. ${p.numero}: ${p.veiculacao}, ${formatarMoeda(p.valor)}`);
  const corpo = [
    "Olá!",
    "",
    pis.length === 1
      ? `Segue o Pedido de Inserção referente a ${mes}, conforme o orçamento aprovado:`
      : `Seguem os Pedidos de Inserção referentes a ${mes}, conforme o orçamento aprovado:`,
    "",
    ...linhas,
    "",
    `O PDF está anexo e também disponível no portal: ${linkPortal}`,
    "",
    "Qualquer dúvida, estamos à disposição.",
    "",
    "Atratis Digital",
  ].join("\n");
  return { assunto, corpo };
}

// ---------------- E-mail ----------------

/** Envia os P.I.s pelo Gmail da Atratis (função de servidor "enviar-pis"), com os PDFs anexos. */
export async function enviarPisPeloSistema(dados: { pis: string[]; para: string[]; assunto: string; corpo: string })
  : Promise<{ registrado: boolean }> {
  const { data, error } = await supabase.functions.invoke("enviar-pis", { body: dados });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const resp = await error.context.json().catch(() => null);
      throw new ErroApp(resp?.erro ?? "O envio foi recusado.");
    }
    throw new ErroApp("Não foi possível falar com a função de envio. Confira se ela foi publicada no Supabase.");
  }
  return { registrado: (data as { registrado?: boolean } | null)?.registrado !== false };
}

export async function listarEnviosPI(budgetId: string): Promise<EnvioPI[]> {
  const { data, error } = await supabase.from("pi_envios")
    .select("id, budget_id, numeros, para, assunto, enviado_por_nome, created_at")
    .eq("budget_id", budgetId).order("created_at", { ascending: false });
  erro(error);
  return (data ?? []) as EnvioPI[];
}

/** Separa e confere uma lista de e-mails digitada (vírgula, ponto e vírgula, espaço ou linha). */
export function lerEmails(texto: string): { validos: string[]; invalidos: string[] } {
  const partes = [...new Set(texto.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const ok = (e: string) => /^[^@\s,;<>"]+@[^@\s,;<>"]+\.[^@\s,;<>"]+$/.test(e);
  return { validos: partes.filter(ok), invalidos: partes.filter((e) => !ok(e)) };
}
