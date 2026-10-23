// Leitura de PDF no navegador (pdf.js), usada no plano de comunicação.
// A biblioteca só é baixada quando alguém abre um plano, para não pesar o
// resto do site. Cada página vira uma imagem JPEG guardada em memória, em vez
// de manter dezenas de canvas abertos (que travariam o celular em planos longos).
import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { ErroApp } from "./api";

export type DocumentoPdf = PDFDocumentProxy;

type ModuloPdf = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let modulo: Promise<ModuloPdf> | null = null;

function carregarPdfJs(): Promise<ModuloPdf> {
  modulo ??= Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
  ]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  }).catch((e) => {
    modulo = null;
    throw e;
  });
  return modulo;
}

export async function abrirPdf(fonte: string | ArrayBuffer): Promise<DocumentoPdf> {
  const pdfjs = await carregarPdfJs();
  const tarefa = pdfjs.getDocument(typeof fonte === "string" ? { url: fonte } : { data: new Uint8Array(fonte) });
  try {
    return await tarefa.promise;
  } catch (e) {
    const nome = e instanceof Error ? e.name : "";
    if (nome === "PasswordException") throw new ErroApp("O PDF tem senha. Exporte de novo sem senha.");
    if (nome === "InvalidPDFException") throw new ErroApp("O arquivo não é um PDF válido.");
    throw new ErroApp("Não foi possível abrir o PDF. Verifique a conexão e tente de novo.");
  }
}

/** Conta as páginas de um PDF escolhido no computador, antes de enviar. */
export async function contarPaginas(arquivo: File): Promise<number> {
  const doc = await abrirPdf(await arquivo.arrayBuffer());
  try {
    return doc.numPages;
  } finally {
    void doc.destroy();
  }
}

// ---------------- Páginas como imagem ----------------

const cache = new WeakMap<DocumentoPdf, Map<string, Promise<string>>>();
const urlsCriadas = new WeakMap<DocumentoPdf, string[]>();

// Fila simples: no máximo duas páginas desenhando ao mesmo tempo.
let ativos = 0;
const fila: (() => void)[] = [];
async function naVez<T>(fn: () => Promise<T>): Promise<T> {
  if (ativos >= 2) await new Promise<void>((r) => fila.push(r));
  ativos++;
  try {
    return await fn();
  } finally {
    ativos--;
    fila.shift()?.();
  }
}

/** Proporção (altura / largura) da página, para reservar espaço antes de desenhar. */
export async function proporcaoPagina(doc: DocumentoPdf, numero: number): Promise<number> {
  const p = await doc.getPage(numero);
  const v = p.getViewport({ scale: 1 });
  return v.height / v.width;
}

/**
 * Desenha a página e devolve o endereço de uma imagem JPEG.
 * `larguraPx` é a largura final em pixels (já considerando telas de alta densidade).
 */
export function imagemDaPagina(doc: DocumentoPdf, numero: number, larguraPx: number): Promise<string> {
  // Larguras parecidas reaproveitam a mesma imagem.
  const faixa = Math.min(1800, Math.max(160, Math.ceil(larguraPx / 160) * 160));
  let mapa = cache.get(doc);
  if (!mapa) {
    mapa = new Map();
    cache.set(doc, mapa);
  }
  const chave = `${numero}@${faixa}`;
  const pronta = mapa.get(chave);
  if (pronta) return pronta;

  const promessa = naVez(async () => {
    const pagina = await doc.getPage(numero);
    const base = pagina.getViewport({ scale: 1 });
    const viewport = pagina.getViewport({ scale: faixa / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    try {
      await pagina.render({ canvas, viewport }).promise;
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.88));
      if (!blob) throw new ErroApp("Não foi possível desenhar a página.");
      const url = URL.createObjectURL(blob);
      urlsCriadas.set(doc, [...(urlsCriadas.get(doc) ?? []), url]);
      return url;
    } finally {
      canvas.width = 0;
      canvas.height = 0;
      pagina.cleanup();
    }
  });
  promessa.catch(() => mapa!.delete(chave));
  mapa.set(chave, promessa);
  return promessa;
}

/** Libera o documento e as imagens geradas a partir dele. */
export function fecharPdf(doc: DocumentoPdf): void {
  for (const url of urlsCriadas.get(doc) ?? []) URL.revokeObjectURL(url);
  urlsCriadas.delete(doc);
  cache.delete(doc);
  void doc.destroy();
}
