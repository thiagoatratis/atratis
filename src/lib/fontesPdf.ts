// Fontes do P.I.: Montserrat (como no modelo da Atratis), servidas em /fonts.
// Licença SIL OFL 1.1 em /fonts/OFL.txt.
import fontkit from "@pdf-lib/fontkit";
import type { PDFDocument, PDFFont } from "pdf-lib";

let cache: Promise<[ArrayBuffer, ArrayBuffer]> | null = null;

function baixar(): Promise<[ArrayBuffer, ArrayBuffer]> {
  cache ??= Promise.all(["/fonts/Montserrat-Regular.ttf", "/fonts/Montserrat-Bold.ttf"].map(async (u) => {
    const r = await fetch(u);
    if (!r.ok) throw new Error(`Fonte não carregou (${u}).`);
    return r.arrayBuffer();
  })) as Promise<[ArrayBuffer, ArrayBuffer]>;
  cache.catch(() => { cache = null; });
  return cache;
}

export async function carregarFontes(doc: PDFDocument): Promise<{ regular: PDFFont; negrito: PDFFont }> {
  doc.registerFontkit(fontkit);
  const [regular, negrito] = await baixar();
  return {
    regular: await doc.embedFont(regular, { subset: true }),
    negrito: await doc.embedFont(negrito, { subset: true }),
  };
}
