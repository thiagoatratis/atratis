// Imagem PNG do orçamento no formato da planilha da Atratis:
// "Verba X Projeto x Objetivo - Mês/Ano (verba fixa mensal)", uma tabela por
// bloco de boleto, o recado para o cliente num quadro e o resumo por canal
// de cada bloco. Desenhada num <canvas>, sem depender de bibliotecas.
import { ordenarCanais, corDoCanal, formatarPct, type BlocoExibido } from "./blocos";
import { formatarMes } from "./dinheiro";
import { moedaCurta } from "./pi";

export interface DadosImagemOrcamento {
  mesReferencia: string;
  blocos: BlocoExibido[];
  /** Recado para o cliente: vai no quadro de texto (sem recado, sem quadro). */
  recado: string | null;
}

const ESCALA = 2;
const FONTE = "MontserratImagem";
const LARANJA = "#EE4723";
const LARANJA_CABECALHO = "#F79A1E";
const ROXO = "#7E22CE";
const CINZA_PROJETO = "#D9D9D9";
const TINTA = "#232427";
const BORDA = "#8A8A8A";

// Colunas da tabela (largura lógica, em px).
const COLS = { projeto: 150, numero: 30, canal: 100, objetivo: 136, campanha: 104, projetoValor: 104, pct: 96 };
const LARGURA_TABELA = Object.values(COLS).reduce((a, b) => a + b, 0);
const ALTURA_LINHA = 26;
const ALTURA_CAB_1 = 22;
const ALTURA_CAB_2 = 40;
const MARGEM = 32;
const LARGURA_LATERAL = 300;
const ESPACO = 36;

let fontes: Promise<void> | null = null;
function carregarFontes(): Promise<void> {
  fontes ??= (async () => {
    const pares: [string, string][] = [["400", "/fonts/Montserrat-Regular.ttf"], ["700", "/fonts/Montserrat-Bold.ttf"]];
    for (const [peso, url] of pares) {
      const f = new FontFace(FONTE, `url(${url})`, { weight: peso });
      await f.load();
      document.fonts.add(f);
    }
  })();
  fontes.catch(() => { fontes = null; });
  return fontes;
}

const fonte = (tamanho: number, negrito = false) => `${negrito ? 700 : 400} ${tamanho}px ${FONTE}, Arial, sans-serif`;

/** Quebra o texto em linhas que cabem na largura. */
function quebrar(ctx: CanvasRenderingContext2D, texto: string, largura: number): string[] {
  const linhas: string[] = [];
  for (const paragrafo of texto.split(/\r?\n/)) {
    if (!paragrafo.trim()) { linhas.push(""); continue; }
    let atual = "";
    for (const palavra of paragrafo.split(/\s+/)) {
      const teste = atual ? `${atual} ${palavra}` : palavra;
      if (ctx.measureText(teste).width <= largura || !atual) atual = teste;
      else { linhas.push(atual); atual = palavra; }
    }
    linhas.push(atual);
  }
  return linhas;
}

/** Texto centralizado numa caixa, diminuindo a fonte se não couber. */
function textoNaCaixa(ctx: CanvasRenderingContext2D, texto: string, x: number, y: number, w: number, h: number,
  opcoes: { tamanho?: number; negrito?: boolean; cor?: string; alinhar?: "center" | "right" | "left" } = {}) {
  let tamanho = opcoes.tamanho ?? 11;
  let linhas: string[] = [];
  for (; tamanho >= 7; tamanho -= 0.5) {
    ctx.font = fonte(tamanho, opcoes.negrito);
    linhas = quebrar(ctx, texto, w - 10);
    if (linhas.length * tamanho * 1.25 <= h - 4 && linhas.every((l) => ctx.measureText(l).width <= w - 6)) break;
  }
  ctx.fillStyle = opcoes.cor ?? TINTA;
  ctx.textBaseline = "middle";
  const alinhar = opcoes.alinhar ?? "center";
  ctx.textAlign = alinhar;
  const tx = alinhar === "center" ? x + w / 2 : alinhar === "right" ? x + w - 8 : x + 8;
  const altura = linhas.length * tamanho * 1.25;
  linhas.forEach((l, i) => ctx.fillText(l, tx, y + h / 2 - altura / 2 + tamanho * 1.25 * (i + 0.5)));
}

function caixa(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fundo?: string, borda = BORDA) {
  if (fundo) { ctx.fillStyle = fundo; ctx.fillRect(x, y, w, h); }
  ctx.strokeStyle = borda;
  ctx.lineWidth = 0.75;
  ctx.strokeRect(x + 0.375, y + 0.375, w - 0.75, h - 0.75);
}

const alturaBloco = (b: BlocoExibido) => ALTURA_CAB_1 + ALTURA_CAB_2 + b.exibidas.length * ALTURA_LINHA + ALTURA_LINHA;

function desenharBloco(ctx: CanvasRenderingContext2D, b: BlocoExibido, x: number, y: number, rotulo: string, periodo: string) {
  const c = COLS;
  const xs = {
    projeto: x, numero: x + c.projeto, canal: x + c.projeto + c.numero,
    objetivo: x + c.projeto + c.numero + c.canal,
    campanha: x + c.projeto + c.numero + c.canal + c.objetivo,
  };
  const xProjetoValor = xs.campanha + c.campanha;
  const xPct = xProjetoValor + c.projetoValor;
  const larguraEsq = c.projeto + c.numero + c.canal + c.objetivo;
  const larguraDir = c.campanha + c.projetoValor + c.pct;

  // Cabeçalho laranja e cabeçalho preto.
  caixa(ctx, x, y, larguraEsq, ALTURA_CAB_1, LARANJA_CABECALHO);
  textoNaCaixa(ctx, rotulo, x, y, larguraEsq, ALTURA_CAB_1, { tamanho: 10, negrito: true });
  caixa(ctx, xs.campanha, y, larguraDir, ALTURA_CAB_1, LARANJA_CABECALHO);
  textoNaCaixa(ctx, periodo, xs.campanha, y, larguraDir, ALTURA_CAB_1, { tamanho: 10, negrito: true });
  const y2 = y + ALTURA_CAB_1;
  const cab: [string, number, number][] = [
    ["Projetos", xs.projeto, c.projeto], ["Canal", xs.numero, c.numero + c.canal], ["Objetivo", xs.objetivo, c.objetivo],
    ["Investimento por Campanha", xs.campanha, c.campanha], ["Investimento por Projeto", xProjetoValor, c.projetoValor],
    ["% Verba por Projeto", xPct, c.pct],
  ];
  for (const [t, cx, w] of cab) {
    caixa(ctx, cx, y2, w, ALTURA_CAB_2, "#000000", "#444444");
    textoNaCaixa(ctx, t, cx, y2, w, ALTURA_CAB_2, { tamanho: 10, negrito: true, cor: "#ffffff" });
  }

  // Linhas.
  let yl = y2 + ALTURA_CAB_2;
  b.exibidas.forEach((e) => {
    const l = e.linha;
    if (e.projetoSpan) {
      const h = e.projetoSpan * ALTURA_LINHA;
      caixa(ctx, xs.projeto, yl, c.projeto, h, CINZA_PROJETO);
      textoNaCaixa(ctx, l.projeto || "Sem projeto", xs.projeto, yl, c.projeto, h, { tamanho: 10.5 });
      caixa(ctx, xProjetoValor, yl, c.projetoValor, h, CINZA_PROJETO);
      textoNaCaixa(ctx, moedaCurta(e.projetoValor), xProjetoValor, yl, c.projetoValor, h, { tamanho: 10.5 });
      caixa(ctx, xPct, yl, c.pct, h, CINZA_PROJETO);
      textoNaCaixa(ctx, formatarPct(e.projetoPct), xPct, yl, c.pct, h, { tamanho: 10.5 });
    }
    caixa(ctx, xs.numero, yl, c.numero, ALTURA_LINHA, ROXO, "#ffffff");
    textoNaCaixa(ctx, String(e.numero), xs.numero, yl, c.numero, ALTURA_LINHA, { tamanho: 10.5, negrito: true, cor: "#ffffff" });
    caixa(ctx, xs.canal, yl, c.canal, ALTURA_LINHA, CINZA_PROJETO);
    textoNaCaixa(ctx, l.plataforma.replace(/ Ads$/, ""), xs.canal, yl, c.canal, ALTURA_LINHA, { tamanho: 10.5 });
    if (e.objetivoSpan) {
      const h = e.objetivoSpan * ALTURA_LINHA;
      caixa(ctx, xs.objetivo, yl, c.objetivo, h, CINZA_PROJETO);
      textoNaCaixa(ctx, l.descricao || "—", xs.objetivo, yl, c.objetivo, h, { tamanho: 10.5 });
    }
    caixa(ctx, xs.campanha, yl, c.campanha, ALTURA_LINHA, CINZA_PROJETO);
    textoNaCaixa(ctx, moedaCurta(l.valor), xs.campanha, yl, c.campanha, ALTURA_LINHA, { tamanho: 10.5 });
    yl += ALTURA_LINHA;
  });

  // Total.
  ctx.fillStyle = "#000000";
  ctx.fillRect(x, yl, LARGURA_TABELA, ALTURA_LINHA);
  textoNaCaixa(ctx, "Investimento Total", x, yl, larguraEsq, ALTURA_LINHA, { tamanho: 10.5, negrito: true, cor: "#ffffff", alinhar: "right" });
  textoNaCaixa(ctx, moedaCurta(b.total.valor), xs.campanha, yl, c.campanha, ALTURA_LINHA, { tamanho: 10.5, negrito: true, cor: "#ffffff" });
  textoNaCaixa(ctx, moedaCurta(b.total.valor), xProjetoValor, yl, c.projetoValor, ALTURA_LINHA, { tamanho: 10.5, negrito: true, cor: "#ffffff" });
}

const ALTURA_CANAL = 22;
const alturaResumo = (canais: string[]) => (canais.length + 1) * ALTURA_CANAL;

function desenharResumo(ctx: CanvasRenderingContext2D, b: BlocoExibido, canais: string[], x: number, y: number) {
  const larguraRotulo = 34;
  const w1 = 146;
  const w2 = LARGURA_LATERAL - larguraRotulo - w1;
  const h = alturaResumo(canais);
  caixa(ctx, x, y, larguraRotulo, h, "#ffffff");
  ctx.save();
  ctx.translate(x + larguraRotulo / 2, y + h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.font = fonte(14);
  ctx.fillStyle = LARANJA;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let rotulo = b.nome;
  while (ctx.measureText(rotulo).width > h - 8 && rotulo.length > 3) rotulo = `${rotulo.slice(0, -2)}…`;
  ctx.fillText(rotulo, 0, 0);
  ctx.restore();
  let yl = y;
  for (const canal of canais) {
    const valor = b.canais.find((c) => c.canal === canal)?.valor ?? 0;
    const cor = corDoCanal(canal);
    caixa(ctx, x + larguraRotulo, yl, w1, ALTURA_CANAL, cor.fundo, "#ffffff");
    textoNaCaixa(ctx, canal, x + larguraRotulo, yl, w1, ALTURA_CANAL, { tamanho: 10, cor: cor.texto });
    caixa(ctx, x + larguraRotulo + w1, yl, w2, ALTURA_CANAL, cor.fundo, "#ffffff");
    textoNaCaixa(ctx, moedaCurta(valor), x + larguraRotulo + w1, yl, w2, ALTURA_CANAL, { tamanho: 10, cor: cor.texto });
    yl += ALTURA_CANAL;
  }
  caixa(ctx, x + larguraRotulo, yl, w1, ALTURA_CANAL, "#BFBFBF", "#ffffff");
  textoNaCaixa(ctx, "Total", x + larguraRotulo, yl, w1, ALTURA_CANAL, { tamanho: 10, negrito: true });
  caixa(ctx, x + larguraRotulo + w1, yl, w2, ALTURA_CANAL, "#BFBFBF", "#ffffff");
  textoNaCaixa(ctx, moedaCurta(b.total.valor), x + larguraRotulo + w1, yl, w2, ALTURA_CANAL, { tamanho: 10, negrito: true });
}

export async function gerarImagemOrcamento(d: DadosImagemOrcamento): Promise<Blob> {
  await carregarFontes().catch(() => undefined); // sem a fonte, usa Arial
  const mes = formatarMes(d.mesReferencia);
  const periodo = `Período ${mes.replace("/", " ")}`;
  const canais = ordenarCanais(d.blocos.flatMap((b) => b.canais.map((c) => c.canal)));
  const comNomes = d.blocos.length > 1 || d.blocos.some((b) => b.nome !== "Geral");

  // Medidas do recado (quadro de texto).
  const medidor = document.createElement("canvas").getContext("2d")!;
  medidor.font = fonte(13);
  const linhasRecado = d.recado?.trim() ? quebrar(medidor, d.recado.trim(), LARGURA_LATERAL - 28) : [];
  const alturaRecado = linhasRecado.length ? linhasRecado.length * 19 + 28 : 0;

  const topo = MARGEM + 58;
  const alturaEsq = d.blocos.reduce((s, b) => s + alturaBloco(b), 0) + (d.blocos.length - 1) * ESPACO;
  const alturaDir = alturaRecado + (alturaRecado ? ESPACO : 0)
    + d.blocos.reduce((s) => s + alturaResumo(canais), 0) + (d.blocos.length - 1) * 24;
  const largura = MARGEM * 2 + LARGURA_TABELA + ESPACO + LARGURA_LATERAL;
  const altura = topo + Math.max(alturaEsq, alturaDir) + MARGEM;

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(largura * ESCALA);
  canvas.height = Math.ceil(altura * ESCALA);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(ESCALA, ESCALA);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, largura, altura);

  // Título.
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = fonte(28, true);
  ctx.fillStyle = LARANJA;
  const titulo = `Verba X Projeto x Objetivo - ${mes}`;
  ctx.fillText(titulo, MARGEM, MARGEM + 30);
  const larguraTitulo = ctx.measureText(titulo).width;
  ctx.font = fonte(17, true);
  ctx.fillStyle = TINTA;
  ctx.fillText("(verba fixa mensal)", MARGEM + larguraTitulo + 10, MARGEM + 30);

  // Tabelas.
  let y = topo;
  for (const b of d.blocos) {
    desenharBloco(ctx, b, MARGEM, y, comNomes ? `${b.nome} · Projetos X Objetivo X Mídias` : "Projetos X Objetivo X Mídias", periodo);
    y += alturaBloco(b) + ESPACO;
  }

  // Lateral: recado e resumo por canal de cada bloco.
  const xLat = MARGEM + LARGURA_TABELA + ESPACO;
  let yLat = topo;
  if (linhasRecado.length) {
    caixa(ctx, xLat, yLat, LARGURA_LATERAL, alturaRecado, "#ffffff", "#444444");
    ctx.font = fonte(13);
    ctx.fillStyle = TINTA;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    linhasRecado.forEach((l, i) => ctx.fillText(l, xLat + 14, yLat + 14 + 14 + i * 19));
    yLat += alturaRecado + ESPACO;
  }
  for (const b of d.blocos) {
    desenharResumo(ctx, b, canais, xLat, yLat);
    yLat += alturaResumo(canais) + 24;
  }

  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Não deu para gerar a imagem."))), "image/png"));
}
