import { useEffect, useState, type ReactNode } from "react";
import { LuCopy, LuKeyRound, LuLink } from "react-icons/lu";
import { useAsync } from "../lib/useAsync";
import { gerarLinkAcesso, listarVinculos } from "../lib/api";
import { Botao, CampoSelecao, CampoTexto, Modal, useAviso } from "./ui";

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

const GERAL = "";

/**
 * O sistema não manda e-mail ao cliente: a equipe avisa pelo WhatsApp ou e-mail
 * (decisão de 22/10/2026). Duas formas de link:
 *  - geral: o mesmo endereço para todos; quem não estiver conectado entra com o e-mail;
 *  - pessoal: entra direto, sem e-mail, uma vez e por tempo limitado (decisão de 23/10/2026).
 */
export function AvisarCliente({ aberto, caminho, clientId, mensagem, extra, onFechar }: {
  aberto: boolean;
  caminho: string;
  clientId: string;
  /** Monta o texto; `pessoal` indica link que já faz o login. */
  mensagem: (link: string, pessoal: boolean) => string;
  /** Conteúdo a mais no fim (ex.: baixar a imagem do orçamento para mandar junto). */
  extra?: ReactNode;
  onFechar: () => void;
}) {
  const avisar = useAviso();
  const geral = `${window.location.origin}${caminho}`;
  const pessoas = useAsync(() => (aberto ? listarVinculos(clientId) : Promise.resolve([])), [aberto, clientId]);
  const [pessoa, setPessoa] = useState(GERAL);
  const [pessoal, setPessoal] = useState<{ userId: string; link: string } | null>(null);
  const [gerando, setGerando] = useState(false);
  const [texto, setTexto] = useState("");

  const ativos = (pessoas.data ?? []).filter((v) => v.ativo && v.profile?.ativo);
  const link = pessoal && pessoal.userId === pessoa ? pessoal.link : geral;
  const ehPessoal = link !== geral;

  useEffect(() => {
    if (!aberto) return;
    setPessoa(GERAL);
    setPessoal(null);
    setTexto(mensagem(geral, false));
    // a mensagem padrão só é montada ao abrir, para não apagar o que foi editado
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, geral]);

  async function gerar() {
    if (!pessoa) return;
    setGerando(true);
    try {
      const r = await gerarLinkAcesso(pessoa, caminho);
      setPessoal({ userId: pessoa, link: r.link });
      setTexto(mensagem(r.link, true));
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
    } finally {
      setGerando(false);
    }
  }

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
      <div className="pilha">
        <p className="suave">
          O sistema não manda e-mail ao cliente. Envie o link por WhatsApp ou e-mail. Só quem está cadastrado nesta empresa consegue abrir.
        </p>
        <CampoSelecao rotulo="Para quem" value={pessoa} onChange={(e) => {
          const v = e.target.value;
          setPessoa(v);
          if (!v) setTexto(mensagem(geral, false));
          else if (pessoal?.userId === v) setTexto(mensagem(pessoal.link, true));
        }}
          ajuda={pessoa
            ? "O link pessoal entra direto, sem e-mail. Funciona uma vez e por 24 horas; depois, o aparelho da pessoa fica conectado. Gerar outro link invalida o anterior."
            : "Link geral: quem ainda não estiver conectado entra com o e-mail cadastrado."}>
          <option value={GERAL}>Qualquer pessoa da empresa (link geral)</option>
          {ativos.map((v) => (
            <option key={v.user_id} value={v.user_id}>
              {v.profile?.nome || v.profile?.email} {v.pode_aprovar ? "(aprova)" : "(só acompanha)"}: link pessoal
            </option>
          ))}
        </CampoSelecao>
        {pessoa && !ehPessoal && (
          <div>
            <Botao variante="primario" carregando={gerando} onClick={() => void gerar()}><LuKeyRound /> Gerar link pessoal</Botao>
          </div>
        )}
        <div className={`link-cliente ${ehPessoal ? "link-pessoal" : ""}`}>
          <code>{ehPessoal ? "Link pessoal gerado. Ele está na mensagem abaixo." : link}</code>
        </div>
        <CampoTexto rotulo="Mensagem" rows={7} value={texto} onChange={(e) => setTexto(e.target.value)} />
        {extra}
      </div>
    </Modal>
  );
}
