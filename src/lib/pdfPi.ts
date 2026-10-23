// PDF A4 do Pedido de Inserção, no mesmo desenho do modelo da Atratis
// ("20260918 - Atlantico - PI - Meta Ads - Outubro 2026.pdf"): Montserrat,
// logo no cabeçalho, quadros com bordas finas. Medidas em pontos (1/72").
import { PDFDocument, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { carregarFontes } from "./fontesPdf";
import { enderecoCompleto, formatarCEP, formatarCNPJ, formatarData } from "./format";
import { formatarMoeda } from "./dinheiro";
import type { DadosEmpresaPI, PedidoInsercao } from "../types";

/** Dados para desenhar: um P.I. emitido ou a prévia (sem número). */
export type DadosPdfPI = Omit<PedidoInsercao,
  "id" | "sequencia" | "budget_id" | "version_id" | "client_id" | "plataforma" | "pdf_path" | "status"
  | "cancelado_em" | "motivo_cancelamento" | "created_at" | "created_by">;

const A4 = { w: 595.28, h: 841.89 };
const X0 = 50, X1 = 545, XM = 297, XC = 421;
const RECUO = 2.25;
const CORPO = 6.5, ENTRELINHA = 7.8, TITULO = 8;
const BORDA = 0.6;
const PRETO = rgb(0, 0, 0);

interface Trecho { t: string; f: PDFFont }
type Linha = Trecho[];

let logoCache: Promise<ArrayBuffer> | null = null;
function logo(): Promise<ArrayBuffer> {
  logoCache ??= fetch("/logo-atratis.png").then((r) => {
    if (!r.ok) throw new Error("Logo não carregou.");
    return r.arrayBuffer();
  });
  logoCache.catch(() => { logoCache = null; });
  return logoCache;
}

/** Quebra trechos (rótulo em negrito + valor) em linhas que cabem na largura. */
function quebrar(trechos: Trecho[], largura: number, tam = CORPO): Linha[] {
  const linhas: Linha[] = [];
  let atual: Linha = [];
  let usado = 0;
  for (const tr of trechos) {
    for (const parte of tr.t.split(/(\s+)/).filter((p) => p !== "")) {
      const espaco = /^\s+$/.test(parte);
      const w = tr.f.widthOfTextAtSize(espaco ? " " : parte, tam);
      if (!espaco && usado + w > largura && atual.length) {
        linhas.push(atual);
        atual = [];
        usado = 0;
      }
      if (espaco && !atual.length) continue;
      const ultimo = atual[atual.length - 1];
      const texto = espaco ? " " : parte;
      if (ultimo && ultimo.f === tr.f) ultimo.t += texto;
      else atual.push({ t: texto, f: tr.f });
      usado += w;
    }
  }
  if (atual.length) linhas.push(atual);
  return linhas.map((l) => {
    const fim = l[l.length - 1];
    fim.t = fim.t.replace(/\s+$/, "");
    return l;
  });
}

export async function gerarPdfPI(p: DadosPdfPI, opcoes: { previa?: boolean } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Pedido de Inserção ${p.numero}`);
  doc.setAuthor(p.dados_agencia.razao_social ?? p.dados_agencia.nome ?? "Atratis Digital");
  doc.setCreator("Atratis Approval");
  doc.setLanguage("pt-BR");
  const { regular: R, negrito: N } = await carregarFontes(doc);
  const page = doc.addPage([A4.w, A4.h]);

  // y medido de cima para baixo, como no modelo; o PDF conta de baixo para cima.
  const y = (topo: number) => A4.h - topo;
  const linhaBase = (topo: number, f: PDFFont, tam: number) => y(topo + f.heightAtSize(tam, { descender: false }));

  const escrever = (l: Linha, x: number, topo: number, tam = CORPO) => {
    let cx = x;
    for (const tr of l) {
      page.drawText(tr.t, { x: cx, y: linhaBase(topo, tr.f, tam), size: tam, font: tr.f, color: PRETO });
      cx += tr.f.widthOfTextAtSize(tr.t, tam);
    }
  };
  const largura = (l: Linha, tam = CORPO) => l.reduce((s, tr) => s + tr.f.widthOfTextAtSize(tr.t, tam), 0);
  const caixa = (x0: number, topo: number, x1: number, fundo: number) =>
    page.drawRectangle({ x: x0, y: y(fundo), width: x1 - x0, height: fundo - topo, borderColor: PRETO, borderWidth: BORDA });
  const vertical = (x: number, topo: number, fundo: number) =>
    page.drawLine({ start: { x, y: y(topo) }, end: { x, y: y(fundo) }, thickness: BORDA, color: PRETO });
  const horizontal = (topo: number, x0 = X0, x1 = X1) =>
    page.drawLine({ start: { x: x0, y: y(topo) }, end: { x: x1, y: y(topo) }, thickness: BORDA, color: PRETO });

  const rotulo = (r: string, v: string | null | undefined): Trecho[] => [{ t: `${r} `, f: N }, { t: v ?? "", f: R }];
  const simples = (r: string, v: string | null | undefined): Trecho[] => [{ t: `${r} ${v ?? ""}`, f: R }];

  // ---------------- Quadro 1 ----------------
  const topo1 = 53.5;
  const fim1 = 107;

  // Logo e dados da agência em letra miúda, como no modelo.
  const img = await doc.embedPng(await logo());
  const lw = 112;
  const lh = (img.height / img.width) * lw;
  page.drawImage(img, { x: 55, y: y((topo1 + fim1) / 2 + lh / 2), width: lw, height: lh });
  const ag = p.dados_agencia;
  const miudo = 4.3;
  const blocoAgencia = [
    ...quebrar([{ t: `${(ag.razao_social ?? ag.nome ?? "").toUpperCase()} CNPJ: ${formatarCNPJ(ag.cnpj)}`, f: R }], 118, miudo),
    ...(ag.endereco ? quebrar([{ t: ag.endereco, f: R }], 118, miudo) : []),
    ...quebrar([{ t: [ag.bairro, [ag.cidade, ag.uf].filter(Boolean).join(" - "), ag.cep ? formatarCEP(ag.cep) : null]
      .filter(Boolean).join(", "), f: R }], 118, miudo),
    ...(ag.telefone ? [[{ t: ag.telefone, f: R }]] : []),
  ];
  const altMiudo = 5.4;
  let ty = (topo1 + fim1) / 2 - (blocoAgencia.length * altMiudo) / 2;
  for (const l of blocoAgencia) {
    escrever(l, XM - 6 - largura(l, miudo), ty, miudo);
    ty += altMiudo;
  }

  // Título
  const titulo: Linha = [{ t: "PEDIDO DE INSERÇÃO", f: N }];
  escrever(titulo, (XM + XC) / 2 - largura(titulo, TITULO) / 2, (topo1 + fim1) / 2 - 4.9, TITULO);

  // Número, emissão e referência
  const [ano, mes] = p.mes_referencia.split("-");
  const numero = opcoes.previa ? "definido ao emitir" : p.numero;
  const blocoNumero = [
    ...quebrar(rotulo("Número do Pedido:", numero), X1 - XC - 2 * RECUO),
    ...quebrar(rotulo("Data da Emissão:", formatarData(p.data_emissao)), X1 - XC - 2 * RECUO),
    ...quebrar(rotulo("Mês/Ano de referência:", `${mes}/${ano}`), X1 - XC - 2 * RECUO),
  ];
  ty = (topo1 + fim1) / 2 - (blocoNumero.length * ENTRELINHA) / 2;
  for (const l of blocoNumero) { escrever(l, XC + RECUO, ty); ty += ENTRELINHA; }

  // Cliente e agência
  const larguraMeia = XM - X0 - 2 * RECUO - 1;
  const cl: DadosEmpresaPI = p.dados_cliente;
  const blocoCliente = [
    rotulo("Cliente:", cl.nome), rotulo("Razão Social:", cl.razao_social), rotulo("Endereço:", enderecoCompleto(cl)),
    rotulo("CNPJ:", cl.cnpj ? formatarCNPJ(cl.cnpj) : ""), rotulo("Fone:", cl.telefone),
  ].flatMap((t) => quebrar(t, larguraMeia));
  const blocoAg = [
    rotulo("Agência:", ag.nome), rotulo("Razão Social:", ag.razao_social), rotulo("Endereço:", enderecoCompleto(ag)),
    rotulo("Fone:", ag.telefone),
  ].flatMap((t) => quebrar(t, larguraMeia));
  const fim2 = fim1 + Math.max(67.6, Math.max(blocoCliente.length, blocoAg.length) * ENTRELINHA + 12);
  const meio2 = (fim1 + fim2) / 2;
  ty = meio2 - (blocoCliente.length * ENTRELINHA) / 2;
  for (const l of blocoCliente) { escrever(l, X0 + RECUO, ty); ty += ENTRELINHA; }
  ty = meio2 - (blocoAg.length * ENTRELINHA) / 2;
  for (const l of blocoAg) { escrever(l, XM + RECUO, ty); ty += ENTRELINHA; }

  // Dados de campanha e observações
  const campanha = [
    ...quebrar(simples("Campanha:", p.campanha), larguraMeia),
    ...quebrar(simples("Veiculação:", p.veiculacao), larguraMeia),
    [] as Linha,
    ...quebrar(simples("Período:", p.periodo), larguraMeia),
  ];
  const obs = (p.observacoes ?? "").split("\n").flatMap((par) => (par.trim() ? quebrar([{ t: par, f: R }], larguraMeia) : [[] as Linha]));
  const altCampanha = 8.2 + 9.8 + campanha.length * ENTRELINHA + 8;
  const altObs = 2 + ENTRELINHA * (1 + obs.length) + 6;
  const fim3 = fim2 + Math.max(65.4, altCampanha, altObs);
  escrever([{ t: "DADOS DE CAMPANHA", f: N }], X0 + RECUO, fim2 + 8.2, TITULO);
  ty = fim2 + 8.2 + 9.8;
  for (const l of campanha) { escrever(l, X0 + RECUO, ty); ty += ENTRELINHA; }
  escrever([{ t: "Observações:", f: N }], XM + RECUO, fim2 + 2);
  ty = fim2 + 2 + ENTRELINHA;
  for (const l of obs) { escrever(l, XM + RECUO, ty); ty += ENTRELINHA; }

  const fim4 = fim3 + 13;
  escrever([{ t: "DADOS DE FATURAMENTO", f: N }], X0 + RECUO, fim3 + 2, TITULO);

  caixa(X0, topo1, X1, fim4);
  horizontal(fim1); horizontal(fim2); horizontal(fim3);
  vertical(XM, topo1, fim3);
  vertical(XC, topo1, fim1);

  // ---------------- Quadro 2 ----------------
  const topo5 = fim4 + 6;
  const fim5 = topo5 + 15.5;
  escrever(quebrar(rotulo("Prazo para pagamento:", p.prazo_pagamento), larguraMeia)[0], X0 + RECUO, topo5 + 3.9);
  escrever([{ t: `Valor: ${formatarMoeda(p.valor)}`, f: R }], XM + RECUO, topo5 + 3.9);

  const marca = (sim: boolean) => (sim ? "( X )" : "(    )");
  escrever([{ t: "Forma de Faturamento:", f: R }], X0 + RECUO, fim5 + 10.8);
  escrever([{ t: `${marca(p.faturamento === "bruto")} Bruto`, f: R }], 141.9, fim5 + 10.8);
  escrever([{ t: `${marca(p.faturamento === "liquido")} Líquido`, f: R }], 187, fim5 + 10.8);
  escrever([{ t: "Local de entrega da fatura:", f: R }], X0 + RECUO, fim5 + 21.5);
  escrever([{ t: `${marca(p.entrega_fatura === "agencia")} Agência`, f: R }], X0 + RECUO, fim5 + 29.3);
  escrever([{ t: `${marca(p.entrega_fatura === "cliente")} Cliente`, f: R }], 94.4, fim5 + 29.3);
  const obsFat = quebrar(simples("Observação:", p.observacao_faturamento), X1 - X0 - 2 * RECUO);
  ty = fim5 + 55.1;
  for (const l of obsFat) { escrever(l, X0 + RECUO, ty); ty += ENTRELINHA; }
  const fim6 = Math.max(fim5 + 77, ty + 8);

  caixa(X0, topo5, X1, fim6);
  horizontal(fim5);
  vertical(XM, topo5, fim5);

  if (opcoes.previa) marcaDagua(page, N, (topo1 + fim6) / 2);
  return doc.save();
}

function marcaDagua(page: PDFPage, f: PDFFont, centroTopo: number) {
  const texto = "PRÉVIA";
  const tam = 96;
  const w = f.widthOfTextAtSize(texto, tam);
  page.drawText(texto, {
    x: A4.w / 2 - (w / 2) * Math.cos(Math.PI / 6), y: A4.h - centroTopo - (w / 2) * Math.sin(Math.PI / 6) - tam / 3,
    size: tam, font: f, color: rgb(0.85, 0.85, 0.85), rotate: degrees(30), opacity: 0.6,
  });
}
