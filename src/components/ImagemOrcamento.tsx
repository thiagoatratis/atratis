import { useState } from "react";
import { LuImageDown } from "react-icons/lu";
import { blocosDaVersao } from "../lib/blocos";
import { formatarMes } from "../lib/dinheiro";
import { gerarImagemOrcamento } from "../lib/imagemOrcamento";
import { Botao, useAviso } from "./ui";
import type { Orcamento, VersaoOrcamento } from "../types";

/** Botão que baixa o orçamento em PNG, no formato da planilha da Atratis. */
export function BaixarImagemOrcamento({ orcamento, versao, cliente, variante = "secundario" }: {
  orcamento: Orcamento;
  versao: VersaoOrcamento;
  cliente: string | undefined;
  variante?: "primario" | "secundario" | "fantasma";
}) {
  const avisar = useAviso();
  const [gerando, setGerando] = useState(false);

  async function baixar() {
    setGerando(true);
    try {
      const blob = await gerarImagemOrcamento({
        mesReferencia: orcamento.mes_referencia,
        blocos: blocosDaVersao(versao.linhas, versao.blocos),
        recado: orcamento.instrucoes_cliente,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Orcamento ${cliente ?? ""} ${formatarMes(orcamento.mes_referencia).replace("/", " ")}${versao.numero > 1 ? ` v${versao.numero}` : ""}.png`
        .replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ");
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
    } finally {
      setGerando(false);
    }
  }

  return (
    <Botao variante={variante} carregando={gerando} onClick={() => void baixar()}>
      <LuImageDown /> Baixar imagem
    </Botao>
  );
}
