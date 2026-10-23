import { useEffect, useState } from "react";
import { LuCopy, LuLink } from "react-icons/lu";
import { Botao, CampoTexto, Modal, useAviso } from "./ui";

async function copiarTexto(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    // Navegadores sem permissão de área de transferência: cópia pelo método antigo.
    const area = document.createElement("textarea");
    area.value = texto;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

/**
 * O sistema não manda e-mail ao cliente: a equipe avisa com este link
 * (decisão de 22/10/2026). O mesmo endereço abre a visão interna para a
 * equipe e a página de aprovação para o cliente.
 */
export function AvisarCliente({ aberto, caminho, mensagem, onFechar }: {
  aberto: boolean;
  caminho: string;
  mensagem: (link: string) => string;
  onFechar: () => void;
}) {
  const avisar = useAviso();
  const link = `${window.location.origin}${caminho}`;
  const [texto, setTexto] = useState("");

  useEffect(() => {
    if (aberto) setTexto(mensagem(link));
    // a mensagem padrão só é montada ao abrir, para não apagar o que foi editado
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, link]);

  async function copiar(conteudo: string, oque: string) {
    if (await copiarTexto(conteudo)) avisar(`${oque} copiado.`);
    else avisar("Não deu para copiar. Selecione o texto e copie manualmente.", "erro");
  }

  return (
    <Modal aberto={aberto} titulo="Avisar o cliente" onFechar={onFechar}
      rodape={<>
        <Botao onClick={onFechar}>Fechar</Botao>
        <Botao onClick={() => void copiar(link, "Link")}><LuLink /> Copiar só o link</Botao>
        <Botao variante="primario" onClick={() => void copiar(texto, "Mensagem")}><LuCopy /> Copiar mensagem</Botao>
      </>}>
      <p className="suave">
        O sistema não manda e-mail ao cliente. Envie este link por WhatsApp ou e-mail. Só quem está cadastrado como
        aprovador ou visualizador desta empresa consegue abrir.
      </p>
      <div className="link-cliente">
        <code>{link}</code>
      </div>
      <CampoTexto rotulo="Mensagem" rows={7} value={texto} onChange={(e) => setTexto(e.target.value)} />
    </Modal>
  );
}
