import { useEffect, useState } from "react";
import { LuArrowLeft, LuCheck } from "react-icons/lu";
import { useAsync } from "../lib/useAsync";
import { listarClientes, listarVinculos } from "../lib/api";
import { listarCampanhas } from "../lib/criativos";
import {
  decidirOrcamento, listarAlteracoesOrcamento, listarDecisoesOrcamento, listarVersoes, obterOrcamento, registrarVisualizacaoOrcamento,
  tituloOrcamento, totais,
} from "../lib/orcamentos";
import { formatarMes, formatarMoeda } from "../lib/dinheiro";
import { useAuth } from "../lib/auth";
import { Link } from "../lib/router";
import { formatarData, formatarDataHora } from "../lib/format";
import { AvisoErro, Botao, CampoTexto, Carregando, Modal, Selo, Vazio, useAviso } from "../components/ui";
import { TabelaOrcamento } from "../components/TabelaOrcamento";
import { PedidosInsercao } from "../components/PedidosInsercao";
import { HistoricoOrcamento, ultimaAlteracao } from "../components/HistoricoOrcamento";
import { STATUS_ORCAMENTO, STATUS_VERSAO_ORCAMENTO } from "../types";
import { autoriaDecisao, observacaoReuniao } from "../lib/reuniao";

export function AprovacaoOrcamento({ id }: { id: string }) {
  const { perfil } = useAuth();
  const avisar = useAviso();
  const [registrado, setRegistrado] = useState(false);

  useEffect(() => {
    void registrarVisualizacaoOrcamento(id).finally(() => setRegistrado(true));
  }, [id]);

  const dados = useAsync(async () => {
    if (!registrado) return undefined;
    const o = await obterOrcamento(id);
    if (!o) return null;
    const [versoes, decisoes, empresas, vinculos, campanhas, alteracoes] = await Promise.all([
      listarVersoes(id), listarDecisoesOrcamento(id), listarClientes(), listarVinculos(), listarCampanhas(o.client_id),
      listarAlteracoesOrcamento(id),
    ]);
    const meu = vinculos.find((v) => v.user_id === perfil?.id && v.client_id === o.client_id);
    return {
      o, versoes, decisoes, alteracoes,
      empresa: empresas.find((c) => c.id === o.client_id),
      campanha: campanhas.find((c) => c.id === o.campaign_id),
      podeAprovar: !!meu?.pode_aprovar && !!meu.ativo,
    };
  }, [id, registrado, perfil?.id]);

  const [pedindo, setPedindo] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  if (!registrado || (dados.loading && !dados.data)) return <Carregando />;
  if (dados.error) return <AvisoErro erro={dados.error} tentarDeNovo={dados.reload} />;
  if (!dados.data) {
    return <Vazio titulo="Orçamento não encontrado" acao={<Link to="/" className="btn btn-secundario">Voltar ao início</Link>}>
      O endereço pode estar errado ou você não tem acesso a esta empresa.
    </Vazio>;
  }
  const { o, versoes, decisoes, alteracoes, empresa, campanha, podeAprovar } = dados.data;
  const st = STATUS_ORCAMENTO[o.status];
  // o cliente só recebe versões já enviadas; a última é a que vale
  const atual = versoes[versoes.length - 1];
  const anteriores = versoes.slice(0, -1).reverse();
  const aberto = (o.status === "aguardando_aprovacao" || o.status === "em_analise") && atual?.status === "pendente";
  const t = totais(atual?.linhas ?? []);
  const decisao = (versionId: string) => decisoes.filter((d) => d.version_id === versionId).at(-1);
  // Depois de um reenvio, a decisão anterior fica só no histórico de versões.
  const minha = atual ? decisoes.filter((d) => d.version_id === atual.id && d.created_at >= (atual.enviado_em ?? "")).at(-1) : undefined;

  async function decidir(tipo: "aprovado" | "alteracoes_solicitadas") {
    if (tipo === "alteracoes_solicitadas" && texto.trim().length < 3) return setErro("Conte o que precisa ser ajustado.");
    setOcupado(true);
    setErro(null);
    try {
      await decidirOrcamento(o.id, tipo, tipo === "alteracoes_solicitadas" ? texto : undefined, t.valor);
      setPedindo(false);
      setConfirmar(false);
      setTexto("");
      avisar(tipo === "aprovado" ? "Orçamento aprovado." : "Pedido de alteração enviado à Atratis.");
      await dados.reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (tipo === "aprovado") {
        // Valores mudaram enquanto a página estava aberta: mostra os novos antes de aprovar.
        setConfirmar(false);
        void dados.reload();
        avisar(msg, "erro");
      } else setErro(msg);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="aprovacao">
      <Link to="/" className="voltar"><LuArrowLeft /> Início</Link>
      <header className="aprovacao-topo">
        <p className="aprovacao-empresa">{empresa?.nome_comercial}</p>
        <h1>{tituloOrcamento(o)}</h1>
        <div className="aprovacao-meta">
          <Selo tom={st.tom}>{st.rotuloCliente}</Selo>
          <span>Mês de referência: {formatarMes(o.mes_referencia)}</span>
          {campanha && <span>Campanha: {campanha.nome}</span>}
        </div>
      </header>

      {o.status === "cancelado" && (
        <div className="aviso aviso-atencao"><p>A Atratis cancelou este orçamento em {formatarData(o.cancelado_em)}. Não há nada para aprovar.</p></div>
      )}
      {o.status === "em_revisao_interna" && (
        <div className="aviso aviso-info"><p>A Atratis está ajustando este orçamento. Você recebe a versão nova para aprovar em breve.</p></div>
      )}
      {o.instrucoes_cliente && (
        <section className="instrucoes">
          <h2>Recado da Atratis</h2>
          <p className="pre">{o.instrucoes_cliente}</p>
        </section>
      )}

      {atual && (
        <section className="painel orcamento-cliente" aria-labelledby="titulo-valores">
          <div className="versao-cabecalho">
            <h2 id="titulo-valores" className="titulo-painel">Valores{atual.numero > 1 ? `, versão ${atual.numero}` : ""}</h2>
            <Selo tom={STATUS_VERSAO_ORCAMENTO[atual.status].tom}>{STATUS_VERSAO_ORCAMENTO[atual.status].rotulo}</Selo>
          </div>
          {atual.observacao && <p className="peca-novidade">O que mudou nesta versão: {atual.observacao}</p>}
          {(() => {
            const ultima = ultimaAlteracao(alteracoes, atual);
            return ultima ? (
              <div className="aviso aviso-atencao">
                <p>A Atratis atualizou os valores em {formatarDataHora(ultima.created_at)}. Veja o que mudou no histórico logo abaixo da tabela.</p>
              </div>
            ) : null;
          })()}
          <TabelaOrcamento linhas={atual.linhas} />
          <HistoricoOrcamento alteracoes={alteracoes} versoes={versoes} />
          <p className="suave pequeno">
            O valor de cada linha é o total a pagar. No Meta Ads, o imposto de 12,15% já está incluso nesse valor.
          </p>

          {aberto && !podeAprovar && (
            <div className="aviso aviso-atencao"><p>Seu acesso é só de visualização. A decisão fica com quem aprova pela empresa.</p></div>
          )}
          {aberto && podeAprovar && !pedindo && (
            <div className="decisao-botoes">
              <Botao variante="primario" onClick={() => setConfirmar(true)}><LuCheck /> Aprovar orçamento</Botao>
              <Botao onClick={() => setPedindo(true)}>Pedir alteração</Botao>
            </div>
          )}
          {aberto && podeAprovar && pedindo && (
            <div className="pedido-alteracao">
              <CampoTexto rotulo="O que precisa ser ajustado?" rows={3} value={texto} autoFocus
                onChange={(e) => setTexto(e.target.value)} erro={erro} />
              <div className="decisao-botoes">
                <Botao variante="primario" carregando={ocupado} onClick={() => void decidir("alteracoes_solicitadas")}>Enviar pedido de alteração</Botao>
                <Botao variante="fantasma" onClick={() => { setPedindo(false); setErro(null); }}>Voltar</Botao>
              </div>
            </div>
          )}
          {minha && (
            <p className={minha.decisao === "aprovado" ? "decisao-ok" : "decisao-alt"}>
              {minha.decisao === "aprovado" ? "Aprovado" : "Alteração pedida"} {autoriaDecisao(minha)}
              {minha.comentario ? `: "${minha.comentario}"` : "."}{observacaoReuniao(minha)}
            </p>
          )}

          {anteriores.length > 0 && (
            <details className="versoes-anteriores">
              <summary>Versões anteriores ({anteriores.length})</summary>
              <ul>
                {anteriores.map((v) => {
                  const d = decisao(v.id);
                  return (
                    <li key={v.id}>
                      <strong>Versão {v.numero}</strong>, total {formatarMoeda(totais(v.linhas).valor)}:
                      {d ? ` ${d.decisao === "aprovado" ? "aprovada" : "com alteração pedida"} ${autoriaDecisao(d)}${d.comentario ? ` ("${d.comentario}")` : ""}`
                        : v.status === "substituida" ? " substituída pela Atratis antes da decisão" : " sem decisão"}
                    </li>
                  );
                })}
              </ul>
            </details>
          )}
        </section>
      )}

      <PedidosInsercao orcamento={o} versao={atual} cliente={undefined} campanha={campanha?.nome} equipe={false} />

      <Modal aberto={confirmar} titulo="Aprovar este orçamento?" onFechar={() => setConfirmar(false)} largura={460}
        rodape={<>
          <Botao variante="fantasma" onClick={() => setConfirmar(false)}>Voltar</Botao>
          <Botao variante="primario" carregando={ocupado} onClick={() => void decidir("aprovado")}>Aprovar {formatarMoeda(t.valor)}</Botao>
        </>}>
        <p>Total de {formatarMoeda(t.valor)} para {formatarMes(o.mes_referencia)}. A aprovação fica registrada no seu nome, com data e hora.</p>
      </Modal>
    </div>
  );
}
