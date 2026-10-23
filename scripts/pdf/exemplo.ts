// Gera um P.I. de exemplo com as fontes reais (Montserrat) para o CI conferir.
import fs from "node:fs";
import path from "node:path";
import { gerarPdfPI } from "../../src/lib/pdfPi";

const publico = path.resolve(process.cwd(), "public");
(globalThis as { fetch: unknown }).fetch = async (url: string) => {
  const b = fs.readFileSync(path.join(publico, url));
  return { ok: true, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
};

const empresa = {
  nome: "Instituto Atlântico", razao_social: "Instituto Atlântico", cnpj: "04614281000123",
  endereco: "Av. Washington Soares, 909 - Loja 42", bairro: "Edson Queiroz", cidade: "Fortaleza", uf: "CE",
  cep: "60811341", telefone: "(85) 3216-7800", email: null,
};
const bytes = await gerarPdfPI({
  numero: "261023.01", data_emissao: "2026-10-23", veiculacao: "Meta Ads, Google Ads", valor: 1800,
  mes_referencia: "2026-11-01", campanha: "Conta de luz", periodo: "01/11/2026 a 30/11/2026",
  prazo_pagamento: "Data do vencimento do boleto", faturamento: "bruto", entrega_fatura: "cliente",
  observacoes: "Valores por plataforma:\nMeta Ads: R$ 1.500,00\nGoogle Ads: R$ 300,00", observacao_faturamento: null,
  dados_cliente: empresa, dados_agencia: { ...empresa, nome: "Atratis Digital", razao_social: "Atratis Digital LTDA" },
});
fs.writeFileSync(process.argv[2] ?? "pi-exemplo.pdf", bytes);
