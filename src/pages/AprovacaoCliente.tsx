import { useEffect, useState } from "react";
import { LuArrowLeft, LuCheck, LuMessageSquare } from "react-icons/lu";
import { useAsync } from "../lib/useAsync";
import { listarClientes, listarVinculos } from "../lib/api";
import {
  aprovarPendentes, decidir, listarComentarios, listarDecisoes, listarPecas, obterSolicitacao, registrarVisualizacao,
} from "../lib/criativos";
import { useAuth } from "../lib/auth";
import { Link } from "../lib/router";
import { formatarData } from "../lib/format";
import { AvisoErro, Botao, CampoTexto, Carregando, Modal, Selo, Vazio, useAviso } from "../components/ui";
import { Previa } from "../components/Previa";
import { Conversa } from "../components/Conversa";
import { STATUS_SOLICITACAO, STATUS_VERSAO, type Decisao, type Peca, type Versao } from "../types";
import { autoriaDecisao, observacaoReuniao } from "../lib/reuniao";

export function AprovacaoCliente({ id }: { id: string }) {
  const { perfil } = useAuth();
  const avisar = useAviso();
  const [registrado, setRegistrado] = useState(false);

  useEffect(() => {
    void registrarVisualizacao(id).finally(() => setRegistrado(true));
  }, [id]);

  const dados = useAsync(async () => {
    if (!registrado) return undefined;
    const s = await obterSolicitacao(id);
    if (!s) return null;
    const [pecas, decisoes, comentarios, empresas, vinculos] = await Promise.all([
      listarPecas(id), listarDecisoes(id), listarComentarios(id), listarClientes(), listarVinculos(),
    ]);
    const meu = vinculos.find((v) => v.user_id === perfil?.id && v.client_id === s.client_id);
    return {
      s, decisoes, comentarios,
      // o cliente só recebe as versões já enviadas
      pecas: pecas.filter((p) => p.versoes.length > 0),
      empresa: empresas.find((c) => c.id === s.client_id),
      podeAprovar: !!meu?.pode_aprovar && !!meu.ativo,
    };
  }, [id, registrado, perfil?.id]);

  const [aprovandoTodas, setAprovandoTodas] = useState(false);
  const [confirmarTodas, setConfirmarTodas] = useState(false);

  if (!registrado || (dados.loading && !dados.data)) return <Carregando />;
  if (dados.error) return <AvisoErro erro={dados.error} tentarDeNovo={dados.reload} />;
  if (!dados.data) {
    return <Vazio titulo="Solicitação não encontrada" acao={<Link to="/" className="btn btn-secundario">Voltar ao início</Link>}>
      O endereço pode estar errado ou você não tem acesso a esta empresa.
    </Vazio>;
  }
  const { s, pecas, decisoes, comentarios, empresa, podeAprovar } = dados.data;
  const st = STATUS_SOLICITACAO[s.status];
  const ativas = pecas.filter((p) => p.ativo);
  const atuais = ativas.map((p) => p.versoes[p.versoes.length - 1]);
  const pendentes = atuais.filter((v) => v.status === "pendente").length;
  const decididas = atuais.filter((v) => v.status === "aprovado" || v.status === "alteracoes_solicitadas").length;
  const aberta = s.status === "aguardando_aprovacao" || s.status === "em_analise";

  return (
    <div className="aprovacao">
      <Link to="/" className="voltar"><LuArrowLeft /> Início</Link>
      <header className="aprovacao-topo">
        <p className="aprovacao-empresa">{empresa?.nome_comercial}</p>
        <h1>{s.titulo}</h1>
        <div className="aprovacao-meta">
          <Selo tom={st.tom}>{st.rotuloCliente}</Selo>
          {s.prazo_aprovacao && aberta && <span>Aprovar até {formatarData(s.prazo_aprovacao)}</span>}
        </div>
      </header>

      {s.status === "cancelado" && (
        <div className="aviso aviso-atencao"><p>A Atratis cancelou esta solicitação em {formatarData(s.cancelado_em)}. Não há nada para aprovar.</p></div>
      )}
      {s.instrucoes_cliente && (
        <section className="instrucoes">
          <h2>Recado da Atratis</h2>
          <p className="pre">{s.instrucoes_cliente}</p>
        </section>
      )}

      {aberta && ativas.length > 0 && (
        <div className="progresso">
          <div>
            <p className="progresso-numeros">{decididas} de {ativas.length} {ativas.length === 1 ? "peça decidida" : "peças decididas"}</p>
            <div className="barra" aria-hidden><span style={{ width: `${(decididas / ativas.length) * 100}%` }} /></div>
          </div>
          {podeAprovar && pendentes > 1 && (
            <Botao variante="primario" onClick={() => setConfirmarTodas(true)}><LuCheck /> Aprovar todas as pendentes ({pendentes})</Botao>
          )}
        </div>
      )}
      {aberta && !podeAprovar && (
        <div className="aviso aviso-atencao"><p>Seu acesso é só de visualização. Você pode comentar, mas a decisão fica com quem aprova pela empresa.</p></div>
      )}

      <div className="pecas-cliente">
        {pecas.map((p) => (
          <PecaCliente key={p.id} peca={p} decisoes={decisoes} podeDecidir={podeAprovar && aberta}
            onDecidido={(msg) => { avisar(msg); void dados.reload(); }} />
        ))}
      </div>

      <section className="painel conversa-cliente" aria-labelledby="titulo-conversa">
        <h2 id="titulo-conversa" className="titulo-painel"><LuMessageSquare aria-hidden /> Conversa com a Atratis</h2>
        <Conversa requestId={s.id} comentarios={comentarios} pecas={pecas} podeEscrever={s.status !== "cancelado"}
          euId={perfil?.id} onEnviado={() => void dados.reload()} />
      </section>

      <Modal aberto={confirmarTodas} titulo="Aprovar todas as peças pendentes?" onFechar={() => setConfirmarTodas(false)} largura={460}
        rodape={<>
          <Botao variante="fantasma" onClick={() => setConfirmarTodas(false)}>Voltar</Botao>
          <Botao variante="primario" carregando={aprovandoTodas} onClick={async () => {
            setAprovandoTodas(true);
            try {
              const n = await aprovarPendentes(s.id);
              setConfirmarTodas(false);
              avisar(`${n} ${n === 1 ? "peça aprovada" : "peças aprovadas"}.`);
              await dados.reload();
            } catch (e) {
              avisar(e instanceof Error ? e.message : String(e), "erro");
            } finally {
              setAprovandoTodas(false);
            }
          }}>Aprovar {pendentes} {pendentes === 1 ? "peça" : "peças"}</Botao>
        </>}>
        <p>As peças já decididas continuam como estão. A aprovação fica registrada no seu nome, com data e hora.</p>
      </Modal>
    </div>
  );
}

function PecaCliente({ peca, decisoes, podeDecidir, onDecidido }: {
  peca: Peca; decisoes: Decisao[]; podeDecidir: boolean; onDecidido: (msg: string) => void;
}) {
  const avisar = useAviso();
  const atual = peca.versoes[peca.versoes.length - 1];
  const anteriores = peca.versoes.slice(0, -1).reverse();
  const [pedindo, setPedindo] = useState(false);
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const decisao = (v: Versao) => decisoes.filter((d) => d.version_id === v.id).at(-1);
  const minha = decisao(atual);
  const pendente = atual.status === "pendente" && peca.ativo;

  async function aprovar() {
    setOcupado(true);
    try {
      await decidir(atual.id, "aprovado");
      onDecidido(`"${peca.nome}" aprovada.`);
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
    } finally {
      setOcupado(false);
    }
  }

  async function pedirAlteracao() {
    if (texto.trim().length < 3) return setErro("Conte o que precisa ser ajustado.");
    setOcupado(true);
    setErro(null);
    try {
      await decidir(atual.id, "alteracoes_solicitadas", texto);
      setPedindo(false);
      setTexto("");
      onDecidido(`Pedido de alteração enviado para "${peca.nome}".`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <article className={`peca-cliente estado-${peca.ativo ? atual.status : "retirada"}`}>
      <header className="peca-topo">
        <div>
          <h2>{peca.nome}</h2>
          <p className="peca-meta">{peca.canal}, {peca.formato}{atual.numero > 1 ? `. Versão ${atual.numero}` : ""}</p>
        </div>
        {peca.ativo ? <Selo tom={STATUS_VERSAO[atual.status].tom}>{STATUS_VERSAO[atual.status].rotulo}</Selo> : <Selo>Retirada pela Atratis</Selo>}
      </header>
      <Previa versao={atual} grande />
      {peca.descricao && <p className="peca-desc pre">{peca.descricao}</p>}
      {atual.observacao && <p className="peca-novidade">O que mudou nesta versão: {atual.observacao}</p>}

      {pendente && podeDecidir && !pedindo && (
        <div className="decisao-botoes">
          <Botao variante="primario" carregando={ocupado} onClick={() => void aprovar()}><LuCheck /> Aprovar</Botao>
          <Botao onClick={() => setPedindo(true)} disabled={ocupado}>Pedir alteração</Botao>
        </div>
      )}
      {pendente && podeDecidir && pedindo && (
        <div className="pedido-alteracao">
          <CampoTexto rotulo="O que precisa ser ajustado?" rows={3} value={texto} autoFocus
            onChange={(e) => setTexto(e.target.value)} erro={erro} />
          <div className="decisao-botoes">
            <Botao variante="primario" carregando={ocupado} onClick={() => void pedirAlteracao()}>Enviar pedido de alteração</Botao>
            <Botao variante="fantasma" onClick={() => { setPedindo(false); setErro(null); }}>Voltar</Botao>
          </div>
        </div>
      )}
      {minha && (
        <p className={minha.decisao === "aprovado" ? "decisao-ok" : "decisao-alt"}>
          {minha.decisao === "aprovado" ? "Aprovada" : "Alteração pedida"} {autoriaDecisao(minha)}
          {minha.comentario ? `: "${minha.comentario}"` : "."}{observacaoReuniao(minha)}
        </p>
      )}
      {anteriores.length > 0 && (
        <details className="versoes-anteriores">
          <summary>Versões anteriores ({anteriores.length})</summary>
          <ul>
            {anteriores.map((v) => {
              const d = decisao(v);
              return (
                <li key={v.id}>
                  <strong>Versão {v.numero}</strong>
                  {d ? ` ${d.decisao === "aprovado" ? "aprovada" : "com alteração pedida"} ${autoriaDecisao(d)}${d.comentario ? `: "${d.comentario}"` : ""}` : " sem decisão"}
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </article>
  );
}
