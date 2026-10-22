import { useState, type FormEvent } from "react";
import { comentar } from "../lib/criativos";
import { formatarDataHora } from "../lib/format";
import type { Comentario, Peca } from "../types";
import { Botao, CampoTexto, useAviso } from "./ui";

/** Comentários entre a Atratis e o cliente, na solicitação ou numa peça. */
export function Conversa({
  requestId, comentarios, pecas, pecaId, podeEscrever, onEnviado, euId,
}: {
  requestId: string;
  comentarios: Comentario[];
  pecas?: Peca[];
  pecaId?: string | null;
  podeEscrever: boolean;
  onEnviado: () => void;
  euId?: string;
}) {
  const avisar = useAviso();
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const lista = pecaId === undefined ? comentarios : comentarios.filter((c) => c.piece_id === pecaId);
  const nomePeca = (id: string | null) => (id && pecas ? pecas.find((p) => p.id === id)?.nome : null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!texto.trim()) return;
    setEnviando(true);
    try {
      await comentar(requestId, texto, pecaId ?? null);
      setTexto("");
      onEnviado();
    } catch (err) {
      avisar(err instanceof Error ? err.message : String(err), "erro");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="conversa">
      {lista.length === 0 ? (
        <p className="suave">Nenhum comentário ainda.</p>
      ) : (
        <ol className="conversa-lista">
          {lista.map((c) => (
            <li key={c.id} className={c.autor_papel === "cliente" ? "msg-cliente" : "msg-atratis"}>
              <p className="msg-autor">
                <strong>{c.autor_id === euId ? "Você" : c.autor_nome}</strong>
                <span>{c.autor_papel === "cliente" ? "cliente" : "Atratis"}</span>
                <time dateTime={c.created_at}>{formatarDataHora(c.created_at)}</time>
              </p>
              {pecaId === undefined && nomePeca(c.piece_id) && <p className="msg-peca">Sobre: {nomePeca(c.piece_id)}</p>}
              <p className="msg-corpo">{c.corpo}</p>
            </li>
          ))}
        </ol>
      )}
      {podeEscrever && (
        <form onSubmit={enviar} className="conversa-form">
          <CampoTexto rotulo="Escrever comentário" rows={3} value={texto} onChange={(e) => setTexto(e.target.value)}
            maxLength={4000} />
          <div><Botao type="submit" disabled={!texto.trim()} carregando={enviando}>Comentar</Botao></div>
        </form>
      )}
    </div>
  );
}
