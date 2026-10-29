import { useEffect, useState, type ReactNode } from "react";
import { instanteLocal } from "../lib/reuniao";
import { Botao, Campo, CampoTexto, Modal } from "./ui";

const doisDigitos = (n: number) => String(n).padStart(2, "0");

/**
 * Registro de aprovação feita em reunião com o cliente: data e hora da
 * reunião, quem aprovou pelo cliente e uma observação. Fica no histórico com
 * o nome de quem registrou, e o cliente vê "aprovado em reunião".
 */
export function AprovarEmReuniao({ aberto, oQue, aviso, onConfirmar, onFechar }: {
  aberto: boolean;
  /** O que será aprovado, ex.: "o orçamento de Novembro/2026 (R$ 1.100,00)". */
  oQue: ReactNode;
  /** Observação extra, ex.: "As 2 peças em rascunho serão enviadas e aprovadas." */
  aviso?: ReactNode;
  onConfirmar: (quando: string, quem: string, observacao: string) => Promise<void>;
  onFechar: () => void;
}) {
  const [data, setData] = useState("");
  const [hora, setHora] = useState("");
  const [quem, setQuem] = useState("");
  const [obs, setObs] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    const agora = new Date();
    setData(`${agora.getFullYear()}-${doisDigitos(agora.getMonth() + 1)}-${doisDigitos(agora.getDate())}`);
    setHora(`${doisDigitos(agora.getHours())}:${doisDigitos(agora.getMinutes() < 30 ? 0 : 30)}`);
    setQuem("");
    setObs("");
    setErro(null);
  }, [aberto]);

  async function confirmar() {
    setErro(null);
    const quando = instanteLocal(data, hora);
    if (!quando) return setErro("Informe a data e a hora da reunião.");
    if (new Date(quando).getTime() > Date.now() + 10 * 60 * 1000) return setErro("A reunião não pode estar no futuro.");
    if (quem.trim().length < 2) return setErro("Informe quem aprovou pelo cliente.");
    setSalvando(true);
    try {
      await onConfirmar(quando, quem, obs);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal aberto={aberto} titulo="Aprovado em reunião" onFechar={onFechar} largura={540}
      rodape={<>
        <Botao variante="fantasma" onClick={onFechar}>Voltar</Botao>
        <Botao variante="primario" carregando={salvando} onClick={() => void confirmar()}>Registrar aprovação</Botao>
      </>}>
      <div className="pilha">
        <p>Registra que o cliente aprovou {oQue} em reunião. Fica no histórico com o seu nome, e o cliente vê "aprovado em reunião" no portal.</p>
        {aviso && <div className="aviso aviso-info"><p>{aviso}</p></div>}
        {erro && <div className="aviso aviso-erro" role="alert"><p>{erro}</p></div>}
        <div className="grade-2">
          <Campo rotulo="Data da reunião" type="date" obrigatorio value={data} onChange={(e) => setData(e.target.value)} />
          <Campo rotulo="Hora" type="time" obrigatorio value={hora} onChange={(e) => setHora(e.target.value)} />
        </div>
        <Campo rotulo="Quem aprovou pelo cliente" obrigatorio value={quem} maxLength={120}
          placeholder="Ex.: Maria Souza (diretora de marketing)" onChange={(e) => setQuem(e.target.value)} />
        <CampoTexto rotulo="Observação" rows={3} value={obs} maxLength={1000} onChange={(e) => setObs(e.target.value)}
          ajuda="Opcional. Ex.: reunião pelo Meet, aprovou com a ressalva de…" />
      </div>
    </Modal>
  );
}
