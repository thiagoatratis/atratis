import { useEffect, useState, type FormEvent } from "react";
import { LuArrowLeft, LuCopyPlus, LuHandshake, LuLink, LuPencil, LuPlus, LuSend } from "react-icons/lu";
import { useAsync } from "../lib/useAsync";
import { listarClientes, listarUsuarios } from "../lib/api";
import { listarCampanhas } from "../lib/criativos";
import {
  adicionarLinha, aprovarOrcamentoEmReuniao, atualizarLinha, cancelarOrcamento, enviarOrcamento, excluirLinha, listarAlteracoesOrcamento, listarDecisoesOrcamento,
  listarVersoes, novaVersaoOrcamento, obterObservacoesOrcamento, obterOrcamento, projetosDoOrcamento, salvarObservacoesOrcamento,
  tituloOrcamento, totais, type CamposLinha,
} from "../lib/orcamentos";
import {
  OUTRA_PLATAFORMA, PLATAFORMAS, aliquotaPlataforma, dividirValor, formatarAliquota, formatarMes, formatarMoeda,
  lerMoeda, moedaParaCampo,
} from "../lib/dinheiro";
import { Link } from "../lib/router";
import { formatarDataHora } from "../lib/format";
import {
  AvisoErro, Botao, CabecalhoPagina, Campo, CampoSelecao, CampoTexto, Carregando, Modal, Selo, Vazio, useAviso,
} from "../components/ui";
import { AvisarCliente } from "../components/AvisarCliente";
import { TabelaOrcamento } from "../components/TabelaOrcamento";
import { PedidosInsercao } from "../components/PedidosInsercao";
import { HistoricoOrcamento } from "../components/HistoricoOrcamento";
import { OrcamentoFormulario } from "./OrcamentoFormulario";
import {
  STATUS_ORCAMENTO, STATUS_VERSAO_ORCAMENTO, type DecisaoOrcamento, type LinhaOrcamento, type Orcamento,
} from "../types";
import { autoriaDecisao, observacaoReuniao } from "../lib/reuniao";
import { AprovarEmReuniao } from "../components/AprovarEmReuniao";
import { BLOCO_PADRAO, STATUS_BLOCO, blocosDaVersao, blocosUsados, mostrarNomesDosBlocos } from "../lib/blocos";
import { BaixarImagemOrcamento } from "../components/ImagemOrcamento";

export function OrcamentoDetalhe({ id }: { id: string }) {
  const avisar = useAviso();
  const dados = useAsync(async () => {
    const o = await obterOrcamento(id);
    if (!o) return null;
    const [versoes, decisoes, clientes, usuarios, campanhas, alteracoes] = await Promise.all([
      listarVersoes(id), listarDecisoesOrcamento(id), listarClientes(), listarUsuarios(), listarCampanhas(o.client_id),
      listarAlteracoesOrcamento(id),
    ]);
    return {
      o, versoes, decisoes, alteracoes,
      cliente: clientes.find((c) => c.id === o.client_id),
      responsavel: usuarios.find((u) => u.id === o.responsavel_id),
      campanha: campanhas.find((c) => c.id === o.campaign_id),
    };
  }, [id]);

  const [verId, setVerId] = useState<string | undefined>();
  const [editando, setEditando] = useState(false);
  const [linha, setLinha] = useState<LinhaOrcamento | { bloco: string } | null>(null);
  const [novaVersao, setNovaVersao] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [avisarCliente, setAvisarCliente] = useState(false);
  const [reuniao, setReuniao] = useState(false);
  const [blocosReuniao, setBlocosReuniao] = useState<string[]>([]);

  const atualId = dados.data?.versoes.at(-1)?.id;
  useEffect(() => setVerId(atualId), [atualId]);

  if (dados.loading && !dados.data) return <Carregando />;
  if (dados.error) return <AvisoErro erro={dados.error} tentarDeNovo={dados.reload} />;
  if (!dados.data) {
    return <Vazio titulo="Orçamento não encontrado" acao={<Link to="/orcamentos" className="btn btn-secundario">Voltar</Link>}>
      Ele pode ter sido removido ou você não tem acesso ao cliente.
    </Vazio>;
  }
  const { o, versoes, decisoes, alteracoes, cliente, responsavel, campanha } = dados.data;
  const st = STATUS_ORCAMENTO[o.status];
  const editavel = o.status !== "cancelado";
  const atual = versoes[versoes.length - 1];
  const vista = versoes.find((v) => v.id === verId) ?? atual;
  // Desde 29/10/2026 os valores da versão atual mudam mesmo depois de enviada; cada mudança vai para o histórico.
  const rascunho = editavel && vista?.id === atual?.id && atual?.status !== "substituida";
  const enviada = atual?.status !== "rascunho";
  // Blocos de boleto da versão atual e o que falta decidir.
  const blocosAtuais = atual ? blocosDaVersao(atual.linhas, atual.blocos) : [];
  const comAjuste = atual?.blocos.filter((b) => b.status === "alteracoes_solicitadas") ?? [];
  const reenviar = editavel && atual?.status !== "rascunho" && comAjuste.length > 0;
  const podeEnviar = editavel && (atual?.status === "rascunho" || reenviar) && (atual?.linhas.length ?? 0) > 0;
  const faltaDecidir = atual?.status === "rascunho"
    ? blocosAtuais.map((b) => b.nome)
    : blocosAtuais.filter((b) => b.status === "pendente" || b.status === "alteracoes_solicitadas").map((b) => b.nome);
  const podeAprovarEmReuniao = editavel && (atual?.linhas.length ?? 0) > 0 && faltaDecidir.length > 0;
  const ultimaDecisaoDoBloco = (bloco: string) => decisoes
    .filter((d) => d.version_id === atual?.id && (d.bloco ?? BLOCO_PADRAO) === bloco).at(-1);

  // Mudança em bloco já aprovado: continua aprovado, mas o P.I. emitido não muda.
  const confirmarSeAprovado = (bloco: string) => atual?.blocos.find((b) => b.bloco === bloco)?.status !== "aprovado"
    || window.confirm(
      `${mostrarNomesDosBlocos(blocosAtuais) ? `O bloco "${bloco}"` : "Este orçamento"} já foi aprovado. A mudança fica no histórico (que o cliente também vê) e ele continua aprovado.\n\n`
      + "P.I. já emitido não muda: se precisar, cancele e emita de novo.");
  const decisoesDaVista = decisoes.filter((d) => d.version_id === vista?.id);

  async function enviar() {
    setEnviando(true);
    try {
      await enviarOrcamento(o.id);
      avisar("Orçamento enviado ao cliente.");
      await dados.reload();
      setAvisarCliente(true);
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
    } finally {
      setEnviando(false);
    }
  }

  async function excluir(l: LinhaOrcamento) {
    if (!window.confirm(`Excluir a linha ${l.plataforma}${l.descricao ? ` (${l.descricao})` : ""}?${enviada ? " A remoção fica no histórico que o cliente vê." : ""}`)) return;
    if (!confirmarSeAprovado(l.bloco)) return;
    try {
      await excluirLinha(l.id);
      await dados.reload();
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
    }
  }

  return (
    <>
      <CabecalhoPagina
        voltar={<Link to="/orcamentos" className="voltar"><LuArrowLeft /> Orçamentos</Link>}
        titulo={<>{tituloOrcamento(o)} <Selo tom={st.tom}>{st.rotulo}</Selo></>}
        descricao={[cliente?.nome_comercial, o.titulo ? formatarMes(o.mes_referencia) : null, campanha ? `campanha ${campanha.nome}` : null]
          .filter(Boolean).join(", ")}
        acoes={editavel && (
          <>
            <Botao onClick={() => setEditando(true)}><LuPencil /> Editar dados</Botao>
            {o.enviado_em && <Botao onClick={() => setAvisarCliente(true)}><LuLink /> Link para o cliente</Botao>}
            {podeAprovarEmReuniao && <Botao onClick={() => { setBlocosReuniao(faltaDecidir); setReuniao(true); }}><LuHandshake /> Aprovado em reunião</Botao>}
            {atual?.status !== "rascunho" && (
              <Botao onClick={() => setNovaVersao(true)}><LuCopyPlus /> Nova versão</Botao>
            )}
            {(atual?.status === "rascunho" || reenviar) && (
              <Botao variante="primario" disabled={!podeEnviar} carregando={enviando} onClick={() => void enviar()}
                title={podeEnviar ? undefined : "Adicione pelo menos uma linha para enviar."}>
                <LuSend /> {o.enviado_em ? "Reenviar ao cliente" : "Enviar ao cliente"}
              </Botao>
            )}
          </>
        )}
      />

      {o.status === "cancelado" && (
        <div className="aviso aviso-atencao"><p>Cancelado em {formatarDataHora(o.cancelado_em)}. Motivo: {o.motivo_cancelamento}</p></div>
      )}
      {reenviar && (
        <div className="aviso aviso-erro">
          {comAjuste.map((b) => {
            const d = ultimaDecisaoDoBloco(b.bloco);
            return (
              <p key={b.bloco}>
                O cliente pediu ajuste{mostrarNomesDosBlocos(blocosAtuais) ? ` no bloco ${b.bloco}` : ""}{d?.comentario ? `: "${d.comentario}"` : "."}
              </p>
            );
          })}
          <p>Ajuste os valores aqui e clique em Reenviar ao cliente. Os blocos já aprovados continuam aprovados.</p>
        </div>
      )}
      {(o.status === "aguardando_aprovacao" || o.status === "em_analise") && (
        <div className="aviso aviso-info">
          <p>O orçamento está com o cliente. Você pode ajustar os valores aqui: ele vê os valores novos na hora, com o histórico do que mudou.</p>
        </div>
      )}

      <div className="layout-detalhe layout-orcamento">
        <div className="pilha-larga">
        <section aria-labelledby="titulo-valores">
          <div className="secao-topo">
            <h2 id="titulo-valores" className="titulo-secao">Valores</h2>
            {vista && vista.linhas.length > 0 && (
              <BaixarImagemOrcamento orcamento={o} versao={vista} cliente={cliente?.nome_comercial} />
            )}
            {versoes.length > 1 && (
              <div className="versoes" role="group" aria-label="Versões">
                {versoes.map((v) => (
                  <button key={v.id} type="button" className={v.id === vista?.id ? "on" : ""} aria-pressed={v.id === vista?.id}
                    onClick={() => setVerId(v.id)} title={STATUS_VERSAO_ORCAMENTO[v.status].rotulo}>
                    v{v.numero}
                  </button>
                ))}
              </div>
            )}
          </div>

          {vista && (
            <div className="versao-cabecalho">
              <span>Versão {vista.numero}</span>
              <Selo tom={STATUS_VERSAO_ORCAMENTO[vista.status].tom}>{STATUS_VERSAO_ORCAMENTO[vista.status].rotulo}</Selo>
              {vista.enviado_em && <span className="suave">Enviada em {formatarDataHora(vista.enviado_em)}</span>}
            </div>
          )}
          {vista?.observacao && <p className="peca-novidade">O que mudou nesta versão: {vista.observacao}</p>}

          {!vista?.linhas.length ? (
            <Vazio titulo="Nenhum valor ainda" acao={rascunho && <Botao variante="primario" onClick={() => setLinha({ bloco: BLOCO_PADRAO })}>Adicionar a primeira linha</Botao>}>
              Cada linha tem o bloco de boleto, o projeto, o canal, o objetivo e o valor. O imposto do Meta Ads (12,15%) já fica incluso.
            </Vazio>
          ) : (
            <TabelaOrcamento linhas={vista.linhas} blocos={vista.blocos} mostrarStatus={vista.status !== "rascunho"}
              onEditar={rascunho ? (l) => setLinha(l) : undefined}
              onExcluir={rascunho ? (l) => void excluir(l) : undefined}
              rodapeBloco={(b) => {
                const d = vista.id === atual?.id ? ultimaDecisaoDoBloco(b.nome) : undefined;
                if (!rascunho && !d) return null;
                return (
                  <div className="bloco-rodape">
                    {d && (
                      <span className={d.decisao === "aprovado" ? "decisao-ok" : "decisao-alt"}>
                        {d.decisao === "aprovado" ? "Aprovado" : "Ajuste pedido"} {autoriaDecisao(d)}{d.comentario ? `: "${d.comentario}"` : "."}{observacaoReuniao(d)}
                      </span>
                    )}
                    {rascunho && mostrarNomesDosBlocos(blocosAtuais) && (
                      <Botao variante="fantasma" onClick={() => setLinha({ bloco: b.nome })}><LuPlus /> Linha em {b.nome}</Botao>
                    )}
                  </div>
                );
              }} />
          )}
          {rascunho && (vista?.linhas.length ?? 0) > 0 && (
            <div className="acoes-abaixo">
              <Botao onClick={() => setLinha({ bloco: blocosAtuais.at(-1)?.nome ?? BLOCO_PADRAO })}><LuPlus /> Adicionar linha</Botao>
              <Botao variante="fantasma" onClick={() => setLinha({ bloco: "" })}><LuPlus /> Novo bloco de boleto</Botao>
            </div>
          )}

          {decisoesDaVista.length > 0 && <ListaDecisoes decisoes={decisoesDaVista} />}
          <HistoricoOrcamento alteracoes={alteracoes} versoes={versoes} />
        </section>
        <PedidosInsercao orcamento={o} versao={atual} cliente={cliente} campanha={campanha?.nome} equipe />
        </div>

        <aside className="lateral-detalhe">
          <section className="painel">
            <h2 className="titulo-painel">Dados</h2>
            <dl className="dados-lista">
              <div><dt>Mês de referência</dt><dd>{formatarMes(o.mes_referencia)}</dd></div>
              <div><dt>Campanha</dt><dd>{campanha?.nome || <span className="falta">Sem campanha</span>}</dd></div>
              <div><dt>Responsável</dt><dd>{responsavel ? responsavel.nome || responsavel.email : <span className="falta">Ninguém</span>}</dd></div>
              <div><dt>Enviado em</dt><dd>{o.enviado_em ? formatarDataHora(o.enviado_em) : <span className="falta">Ainda não</span>}</dd></div>
              <div><dt>Recado para o cliente</dt><dd className="pre">{o.instrucoes_cliente || <span className="falta">Nenhum</span>}</dd></div>
            </dl>
          </section>
          <ObservacoesInternas budgetId={o.id} editavel={editavel} />
          {editavel && (
            <Botao variante="fantasma" className="perigo-texto" onClick={() => setCancelando(true)}>Cancelar orçamento</Botao>
          )}
        </aside>
      </div>

      <OrcamentoFormulario aberto={editando} orcamento={o} onFechar={() => setEditando(false)}
        onSalvo={() => { setEditando(false); avisar("Dados salvos."); void dados.reload(); }} />
      {atual && (
        <LinhaFormulario linha={linha} versionId={atual.id} ordem={Math.max(0, ...atual.linhas.map((l) => l.ordem)) + 1}
          projetos={projetosDoOrcamento(atual.linhas)} blocos={blocosUsados(atual.linhas)} onFechar={() => setLinha(null)}
          antesDeSalvar={confirmarSeAprovado}
          onPronto={() => { setLinha(null); void dados.reload(); }} />
      )}
      <NovaVersao aberto={novaVersao} orcamento={o} onFechar={() => setNovaVersao(false)}
        onPronto={() => { setNovaVersao(false); avisar("Versão nova criada. Ajuste os valores e reenvie."); void dados.reload(); }} />
      <Cancelar aberto={cancelando} budgetId={o.id} onFechar={() => setCancelando(false)}
        onPronto={() => { setCancelando(false); avisar("Orçamento cancelado."); void dados.reload(); }} />
      <AprovarEmReuniao aberto={reuniao} onFechar={() => setReuniao(false)}
        oQue={faltaDecidir.length > 1 || mostrarNomesDosBlocos(blocosAtuais)
          ? <>os blocos marcados abaixo do orçamento <strong>{tituloOrcamento(o)}</strong></>
          : <>o orçamento <strong>{tituloOrcamento(o)}</strong> ({formatarMoeda(totais(atual?.linhas ?? []).valor)})</>}
        aviso={atual?.status === "rascunho" ? "O orçamento ainda não foi enviado: ele fica enviado e aprovado ao mesmo tempo." : undefined}
        extra={(faltaDecidir.length > 1 || mostrarNomesDosBlocos(blocosAtuais)) && (
          <fieldset className="grupo">
            <legend>Blocos aprovados na reunião</legend>
            <div className="opcoes-radio">
              {blocosAtuais.filter((b) => faltaDecidir.includes(b.nome)).map((b) => (
                <label key={b.nome} className="check">
                  <input type="checkbox" checked={blocosReuniao.includes(b.nome)}
                    onChange={(e) => setBlocosReuniao(e.target.checked ? [...blocosReuniao, b.nome] : blocosReuniao.filter((x) => x !== b.nome))} />
                  <span>{b.nome} <small className="suave">({formatarMoeda(b.total.valor)}{b.status ? `, ${STATUS_BLOCO[b.status].rotulo.toLowerCase()}` : ""})</small></span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        onConfirmar={async (quando, quem, obs) => {
          if (faltaDecidir.length > 1 && !blocosReuniao.length) throw new Error("Marque pelo menos um bloco.");
          // Rascunho: o envio pode manter aprovações; manda só os nomes marcados.
          await aprovarOrcamentoEmReuniao(o.id, quando, quem, obs, faltaDecidir.length > 1 ? blocosReuniao : undefined);
          setReuniao(false);
          avisar("Aprovação em reunião registrada. Agora é só emitir os P.I.s logo abaixo dos valores.");
          await dados.reload();
        }} />
      <AvisarCliente aberto={avisarCliente} onFechar={() => setAvisarCliente(false)}
        caminho={`/orcamentos/${o.id}`} clientId={o.client_id}
        mensagem={(link, pessoal) => mensagemOrcamento(o, totais(atual?.linhas ?? []).valor, link, pessoal)} />
    </>
  );
}

function mensagemOrcamento(o: Orcamento, total: number, link: string, pessoal: boolean): string {
  return [
    `Olá! O orçamento de mídia de ${formatarMes(o.mes_referencia)} (${formatarMoeda(total)}) está pronto para a sua aprovação.`,
    "",
    `Acesse: ${link}`,
    "",
    pessoal
      ? "O link é só seu e funciona uma vez, por 24 horas. Depois do primeiro acesso, este aparelho fica conectado."
      : "Se pedir para entrar, informe o seu e-mail e abra o link de acesso que chegar na sua caixa de entrada.",
  ].join("\n");
}

export function ListaDecisoes({ decisoes }: { decisoes: DecisaoOrcamento[] }) {
  return (
    <ul className="decisoes-orcamento">
      {decisoes.map((d) => (
        <li key={d.id} className={d.decisao === "aprovado" ? "decisao-ok" : "decisao-alt"}>
          {d.bloco && d.bloco !== BLOCO_PADRAO ? `${d.bloco}: ` : ""}{d.decisao === "aprovado" ? "Aprovado" : "Alteração pedida"} {autoriaDecisao(d)}
          {" "}(total {formatarMoeda(d.total)}){d.comentario ? `: "${d.comentario}"` : "."}{observacaoReuniao(d)}
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------

function LinhaFormulario({ linha, versionId, ordem, projetos, blocos, onFechar, onPronto, antesDeSalvar }: {
  linha: LinhaOrcamento | { bloco: string } | null; versionId: string; ordem: number; projetos: string[]; blocos: string[];
  onFechar: () => void; onPronto: () => void;
  antesDeSalvar?: (bloco: string) => boolean;
}) {
  const aberto = linha !== null;
  const existente = linha && "id" in linha ? linha : null;
  const [bloco, setBloco] = useState(BLOCO_PADRAO);
  const [plataforma, setPlataforma] = useState(PLATAFORMAS[0]);
  const [outra, setOutra] = useState("");
  const [projeto, setProjeto] = useState("");
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    const conhecida = existente ? PLATAFORMAS.includes(existente.plataforma) : true;
    setPlataforma(existente ? (conhecida ? existente.plataforma : OUTRA_PLATAFORMA) : PLATAFORMAS[0]);
    setOutra(existente && !conhecida ? existente.plataforma : "");
    setBloco(linha?.bloco ?? BLOCO_PADRAO);
    setProjeto(existente ? existente.projeto ?? "" : projetos.at(-1) ?? "");
    setDescricao(existente?.descricao ?? "");
    setValor(existente ? moedaParaCampo(existente.valor) : "");
    setErro(null);
  }, [aberto, existente]); // projetos: só na abertura

  const nome = plataforma === OUTRA_PLATAFORMA ? outra.trim() : plataforma;
  const numero = lerMoeda(valor);
  const aliquota = aliquotaPlataforma(nome);
  const conta = numero ? dividirValor(numero, aliquota) : null;

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!nome) return setErro("Digite o nome do canal.");
    if (!numero || numero <= 0) return setErro("Digite o valor do boleto, por exemplo 1.100,00.");
    if (!bloco.trim()) return setErro("Dê um nome ao bloco de boleto, por exemplo Revista.");
    const campos: CamposLinha = {
      bloco: bloco.trim(), projeto: projeto.trim() || null, plataforma: nome, descricao: descricao.trim() || null, valor: numero,
    };
    if (antesDeSalvar && !antesDeSalvar(existente?.bloco ?? campos.bloco)) return;
    setSalvando(true);
    try {
      if (existente) await atualizarLinha(existente.id, campos);
      else await adicionarLinha(versionId, campos, ordem);
      onPronto();
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal aberto={aberto} titulo={existente ? "Editar linha" : "Adicionar linha"} onFechar={onFechar} largura={520}
      rodape={<>
        <Botao variante="fantasma" onClick={onFechar}>Cancelar</Botao>
        <Botao variante="primario" type="submit" form="form-linha" carregando={salvando}>{existente ? "Salvar" : "Adicionar"}</Botao>
      </>}>
      <form id="form-linha" onSubmit={salvar} noValidate className="pilha">
        {erro && <div className="aviso aviso-erro" role="alert"><p>{erro}</p></div>}
        <Campo rotulo="Bloco de boleto" value={bloco} onChange={(e) => setBloco(e.target.value)} list="blocos-orcamento" maxLength={60}
          placeholder="Ex.: Geral, Revista" autoFocus={!bloco}
          ajuda="Cada bloco tem tabela, aprovação e P.I.s próprios (boletos separados). Use Geral quando não houver separação." />
        <datalist id="blocos-orcamento">{blocos.map((b) => <option key={b} value={b} />)}</datalist>
        <Campo rotulo="Projeto" value={projeto} onChange={(e) => setProjeto(e.target.value)} list="projetos-orcamento" maxLength={80}
          placeholder="Ex.: Institucional, Revista, Ebook Energia"
          ajuda={projetos.length ? "Escolha um projeto da lista ou digite um novo. As linhas do mesmo projeto ficam juntas na tabela." : "As linhas do mesmo projeto ficam juntas na tabela."} />
        <datalist id="projetos-orcamento">{projetos.map((p) => <option key={p} value={p} />)}</datalist>
        <CampoSelecao rotulo="Canal" value={plataforma} onChange={(e) => setPlataforma(e.target.value)}>
          {PLATAFORMAS.map((p) => <option key={p} value={p}>{p}</option>)}
          <option value={OUTRA_PLATAFORMA}>Outra</option>
        </CampoSelecao>
        {plataforma === OUTRA_PLATAFORMA && (
          <Campo rotulo="Nome do canal" value={outra} onChange={(e) => setOutra(e.target.value)} autoFocus />
        )}
        <Campo rotulo="Objetivo" value={descricao} onChange={(e) => setDescricao(e.target.value)}
          placeholder="Ex.: Impulsionamento, Branding, HR | Comercial" maxLength={200}
          ajuda="Linhas seguidas do mesmo projeto com o mesmo objetivo ficam agrupadas na tabela." />
        <Campo rotulo="Verba fixa mensal (R$)" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)}
          placeholder="1.100,00" erro={valor && numero === null ? "Use o formato 1.100,00." : null}
          ajuda={aliquota > 0 ? `Valor total que o cliente paga. O imposto do ${nome} (${formatarAliquota(aliquota)}) já está incluso.` : "Valor total que o cliente paga."} />
        {conta && (
          <dl className="resumo-valores resumo-compacto">
            <div><dt>Para anúncios</dt><dd className="tab-num">{formatarMoeda(conta.verba)}</dd></div>
            {aliquota > 0 && <div><dt>Imposto ({formatarAliquota(aliquota)})</dt><dd className="tab-num">{formatarMoeda(conta.imposto)}</dd></div>}
            <div className="resumo-total"><dt>Valor do boleto</dt><dd className="tab-num">{formatarMoeda(numero)}</dd></div>
          </dl>
        )}
      </form>
    </Modal>
  );
}

function NovaVersao({ aberto, orcamento, onFechar, onPronto }: {
  aberto: boolean; orcamento: Orcamento; onFechar: () => void; onPronto: () => void;
}) {
  const [observacao, setObservacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { if (aberto) { setObservacao(""); setErro(null); } }, [aberto]);
  const comCliente = orcamento.status === "aguardando_aprovacao" || orcamento.status === "em_analise";
  return (
    <Modal aberto={aberto} titulo="Criar versão nova" onFechar={onFechar} largura={500}
      rodape={<>
        <Botao variante="fantasma" onClick={onFechar}>Voltar</Botao>
        <Botao variante="primario" carregando={salvando} onClick={async () => {
          setSalvando(true);
          setErro(null);
          try {
            await novaVersaoOrcamento(orcamento.id, observacao.trim() || null);
            onPronto();
          } catch (e) {
            setErro(e instanceof Error ? e.message : String(e));
          } finally {
            setSalvando(false);
          }
        }}>Criar versão nova</Botao>
      </>}>
      <div className="pilha">
        <p>A versão nova começa com os mesmos valores. Ajuste o que precisar e reenvie ao cliente.
          {comCliente && " A versão que está com o cliente fica substituída e ele não consegue mais aprová-la."}
          {orcamento.status === "aprovado" && " A aprovação anterior continua no histórico, mas o orçamento volta a precisar de aprovação."}
        </p>
        <CampoTexto rotulo="O que muda nesta versão?" rows={2} value={observacao} onChange={(e) => setObservacao(e.target.value)}
          ajuda="Opcional. O cliente vê este texto." erro={erro} />
      </div>
    </Modal>
  );
}

function ObservacoesInternas({ budgetId, editavel }: { budgetId: string; editavel: boolean }) {
  const avisar = useAviso();
  const obs = useAsync(() => obterObservacoesOrcamento(budgetId), [budgetId]);
  const [texto, setTexto] = useState("");
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { if (obs.data !== undefined) setTexto(obs.data); }, [obs.data]);
  const mudou = texto !== (obs.data ?? "");
  return (
    <section className="painel">
      <h2 className="titulo-painel">Observações internas</h2>
      <CampoTexto rotulo="Só a equipe da Atratis vê" rows={4} value={texto} disabled={!editavel}
        onChange={(e) => setTexto(e.target.value)} />
      {editavel && (
        <div>
          <Botao disabled={!mudou} carregando={salvando} onClick={async () => {
            setSalvando(true);
            try {
              await salvarObservacoesOrcamento(budgetId, texto);
              avisar("Observações salvas.");
              await obs.reload();
            } catch (e) {
              avisar(e instanceof Error ? e.message : String(e), "erro");
            } finally {
              setSalvando(false);
            }
          }}>Salvar observações</Botao>
        </div>
      )}
    </section>
  );
}

function Cancelar({ aberto, budgetId, onFechar, onPronto }: { aberto: boolean; budgetId: string; onFechar: () => void; onPronto: () => void }) {
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { if (aberto) { setMotivo(""); setErro(null); } }, [aberto]);
  return (
    <Modal aberto={aberto} titulo="Cancelar orçamento" onFechar={onFechar} largura={480}
      rodape={<>
        <Botao variante="fantasma" onClick={onFechar}>Voltar</Botao>
        <Botao variante="perigo" carregando={salvando} onClick={async () => {
          setSalvando(true);
          setErro(null);
          try {
            await cancelarOrcamento(budgetId, motivo);
            onPronto();
          } catch (e) {
            setErro(e instanceof Error ? e.message : String(e));
          } finally {
            setSalvando(false);
          }
        }}>Cancelar orçamento</Botao>
      </>}>
      <div className="pilha">
        <p>O cliente continua vendo o histórico, mas não aprova mais nada neste orçamento. Não dá para desfazer.</p>
        <CampoTexto rotulo="Motivo" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} erro={erro} />
      </div>
    </Modal>
  );
}

