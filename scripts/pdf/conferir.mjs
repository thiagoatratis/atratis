// CI: monta o gerador de P.I. com esbuild (vem com o Vite), gera um PDF com a
// Montserrat de verdade e confere que a fonte foi embutida e o texto saiu.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";

await build({
  entryPoints: ["scripts/pdf/exemplo.ts"], bundle: true, platform: "node", format: "esm",
  outfile: "node_modules/.pi-exemplo.mjs", logLevel: "warning",
});
execFileSync("node", ["node_modules/.pi-exemplo.mjs", "pi-exemplo.pdf"], { stdio: "inherit" });

const bytes = fs.readFileSync("pi-exemplo.pdf");
const doc = await PDFDocument.load(bytes);
// Nomes das fontes embutidas (podem estar dentro de fluxos compactados, por isso lemos pelo pdf-lib).
const fontes = doc.context.enumerateIndirectObjects()
  .map(([, o]) => o)
  .filter((o) => o instanceof PDFDict && o.get(PDFName.of("BaseFont")))
  .map((o) => o.get(PDFName.of("BaseFont")).toString());
const falhas = [];
if (doc.getPageCount() !== 1) falhas.push(`esperava 1 página, veio ${doc.getPageCount()}`);
const { width, height } = doc.getPage(0).getSize();
if (Math.round(width) !== 595 || Math.round(height) !== 842) falhas.push(`página não é A4 (${width} x ${height})`);
for (const f of ["Montserrat-Regular", "Montserrat-Bold"]) {
  if (!fontes.some((n) => n.includes(f))) falhas.push(`fonte ${f} não foi embutida (achei: ${fontes.join(", ") || "nenhuma"})`);
}
if (bytes.length > 400_000) falhas.push(`PDF grande demais (${bytes.length} bytes)`);
if (falhas.length) {
  for (const f of falhas) console.log(`::error title=PDF do P.I.::${f}`);
  process.exit(1);
}
console.log(`PDF do P.I. ok: ${bytes.length} bytes, A4, Montserrat embutida.`);
