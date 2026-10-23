import { useEffect, useMemo, useState, type FormEvent } from "react";
import { LuArrowLeft, LuLink, LuPencil, LuPlus, LuSend, LuUpload } from "react-icons/lu";
import { useAsync } from "../lib/useAsync";
import { listarClientes, listarUsuarios } from "../lib/api";
import {
  cancelarSolicitacao, criarPeca, criarVersaoArquivo, criarVersaoLink, descartarRascunho, enviarSolicitacao,
  excluirPeca, listarCampanhas, listarComentarios, listarDecisoes, listarPecas, obterObservacoesSolicitacao,
  obterSolicitacao, retirarPeca, salvarObservacoesSolicitacao, validarArquivo, versaoAtual,
} from "../lib/criativos";
import { CANAIS, EXTENSOES_ACEITAS, OUTRO, formatarTamanho } from "../lib/canais";
import { useAuth } from "../lib/auth";
import { Link } from "../lib/router";
import { formatarData, formatarDataHora } from "../lib/format";
import {
  AvisoErro, Botao, CabecalhoPagina, Campo, CampoSelecao, CampoTexto, Carregando, Modal, Selo, Vazio, useAviso,
} from "../components/ui";
import { Previa } from "../components/Previa";
import { Conversa } from "../components/Conversa";
import { AvisarCliente } from "../components/AvisarCliente";
import { SolicitacaoFormulario } from "./SolicitacaoFormulario";
import { STATUS_SOLICITACAO, STATUS_VERSAO, type Decisao, type Peca, type Solicitacao, type Versao } from "../types";

export function SolicitacaoDetalhe({ id }: { id: string }) {
  const { perfil } = useAuth();
  const avisar = useAviso();
  const dados = useAsync(async () => {
    const s = await obterSolicitacao(id);
    if (!s) return null;
    const [pecas, decisoes, comentarios, clientes, usuarios, campanhas] = await Promise.all([
      listarPecas(id), listarDecisoes(id), listarComentarios(id), listarClientes(), listarUsuarios(), listarCampanhas(s.client_id),
    ]);
    return {
      s, pecas, decisoes, comentarios,
      cliente: clientes.find((c) => c.id === s.client_id),
      responsavel: usuarios.find((u) => u.id === s.responsavel_id),
      campanha: campanhas.find((c) => c.id === s.campaign_id),
    };
  }, [id]);

  const [editando, setEditando] = useState(false);
  const [novaPeca, setNovaPeca] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [avisarCliente, setAvisarCliente] = useState(false);

  if (dados.loading && !dados.data) return <Carregando />;
  if (dados.error) return <AvisoErro erro={dados.error} tentarDeNovo={dados.reload} />;
  if (!dados.data) {
    return <Vazio titulo="Solicitação não encontrada" acao={<Link to="/criativos" className="btn btn-secundario">Voltar</Link>}>
      Ela pode ter sido removida ou você não tem acesso ao cliente.
    </Vazio>;
  }
  const { s, pecas, decisoes, comentarios, cliente, responsavel, campanha } = dados.data;
  const st = STATUS_SOLICITACAO[s.status];
  const editavel = s.status !== "cancelado";
  const ativas = pecas.filter((p) => p.ativo);
  const atuais = ativas.map(versaoAtual).filter(Boolean) as Versao[];
  const novas = atuais.filter((v) => v.status === "rascunho").length;
  const devolvidas = ativas.filter((p) => versaoAtual(p)?.status === "alteracoes_solicitadas");
  const semConteudo = ativas.filter((p) => !p.versoes.length);
  const podeEnviar = editavel && novas > 0 && devolvidas.length === 0;

  async function enviar() {
    setEnviando(true);
    try {
      const novo = await enviarSolicitacao(s.id);
      avisar(`Enviado ao cliente. Status: ${STATUS_SOLICITACAO[novo].rotulo.toLowerCase()}.`);
      await dados.reload();
      setAvisarCliente(true);
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <CabecalhoPagina
        voltar={<Link to="/criativos" className="voltar"><LuArrowLeft /> Criativos</Link>}
        titulo={<>{s.titulo} <Selo tom={st.tom}>{st.rotulo}</Selo></>}
        descricao={[cliente?.nome_comercial, campanha?.nome].filter(Boolean).join(", campanha ")}
        acoes={editavel && (
          <>
            <Botao onClick={() => setEditando(true)}><LuPencil /> Editar dados</Botao>
            {s.enviado_em && <Botao onClick={() => setAvisarCliente(true)}><LuLink /> Link para o cliente</Botao>}
            <Botao variante="primario" disabled={!podeEnviar} carregando={enviando} onClick={() => void enviar()}
              title={podeEnviar ? undefined : novas === 0 ? "Adicione uma peça ou versão nova para enviar." : "Há peças com alterações pedidas."}>
              <LuSend /> {s.enviado_em ? "Reenviar ao cliente" : "Enviar ao cliente"}{novas > 0 ? ` (${novas})` : ""}
            </Botao>
          </>
        )}
      />

      <AvisarCliente aberto={avisarCliente} onFechar={() => setAvisarCliente(false)}
        caminho={`/aprovacoes/${s.id}`} clientId={s.client_id}
        mensagem={(link, pessoal) => mensagemCriativos(s, link, pessoal)} />

      {s.status === "cancelado" && (
        <div className="aviso aviso-atencao"><p>Cancelada em {formatarDataHora(s.cancelado_em)}. Motivo: {s.motivo_cancelamento}</p></div>
      )}
      {devolvidas.length > 0 && editavel && (
        <div className="aviso aviso-erro">
          <p>O cliente pediu alterações em: {devolvidas.map((p) => p.nome).join(", ")}. Envie uma versão nova de cada uma (ou retire a peça) para reenviar.</p>
        </div>
      )}
      {semConteudo.length > 0 && editavel && (
        <div className="aviso aviso-atencao"><p>Sem arquivo ou link ainda: {semConteudo.map((p) => p.nome).join(", ")}.</p></div>
      )}

      <div className="layout-detalhe">
        <section aria-labelledby="titulo-pecas">
          <div className="secao-topo">
            <h2 id="titulo-pecas" className="titulo-secao">Peças <span className="contagem">{ativas.length}</span></h2>
            {editavel && <Botao onClick={() => setNovaPeca(true)}><LuPlus /> Adicionar peça</Botao>}
          </div>
          {!pecas.length ? (
            <Vazio titulo="Nenhuma peça ainda" acao={editavel && <Botao variante="primario" onClick={() => setNovaPeca(true)}>Adicionar a primeira peça</Botao>}>
              Cada peça tem nome, canal, formato e um arquivo ou link.
            </Vazio>
          ) : (
            <div className="pecas">
              {pecas.map((p) => (
                <CartaoPeca key={p.id} peca={p} solicitacao={s} decisoes={decisoes} editavel={editavel}
                  onMudou={() => void dados.reload()} />
              ))}
            </div>
          )}
        </section>

        <aside className="lateral-detalhe">
          <section className="painel">
            <h2 className="titulo-painel">Dados</h2>
            <dl className="dados-lista">
              <div><dt>Objetivo</dt><dd>{s.objetivo || <span className="falta">Não informado</span>}</dd></div>
              <div><dt>Veiculação</dt><dd>{s.veiculacao_inicio || s.veiculacao_fim
                ? `${formatarData(s.veiculacao_inicio) || "?"} a ${formatarData(s.veiculacao_fim) || "?"}`
                : <span className="falta">Não informada</span>}</dd></div>
              <div><dt>Aprovar até</dt><dd>{s.prazo_aprovacao ? formatarData(s.prazo_aprovacao) : <span className="falta">Sem prazo</span>}</dd></div>
              <div><dt>Responsável</dt><dd>{responsavel ? responsavel.nome || responsavel.email : <span className="falta">Ninguém</span>}</dd></div>
              <div><dt>Enviada em</dt><dd>{s.enviado_em ? formatarDataHora(s.enviado_em) : <span className="falta">Ainda não</span>}</dd></div>
              <div><dt>Instruções ao cliente</dt><dd className="pre">{s.instrucoes_cliente || <span className="falta">Nenhuma</span>}</dd></div>
            </dl>
          </section>
          <ObservacoesInternas requestId={s.id} editavel={editavel} />
          <section className="painel">
            <h2 className="titulo-painel">Conversa com o cliente</h2>
            {s.status === "rascunho" && <p className="suave pequeno">O cliente só vê os comentários depois do primeiro envio.</p>}
            <Conversa requestId={s.id} comentarios={comentarios} pecas={pecas} podeEscrever={editavel}
              euId={perfil?.id} onEnviado={() => void dados.reload()} />
          </section>
          {editavel && (
            <Botao variante="fantasma" className="perigo-texto" onClick={() => setCancelando(true)}>Cancelar solicitação</Botao>
          )}
        </aside>
      </div>

      <SolicitacaoFormulario aberto={editando} solicitacao={s} onFechar={() => setEditando(false)}
        onSalvo={() => { setEditando(false); avisar("Dados salvos."); void dados.reload(); }} />
      <NovaPeca aberto={novaPeca} solicitacao={s} ordem={pecas.length + 1} onFechar={() => setNovaPeca(false)}
        onPronto={() => { setNovaPeca(false); avisar("Peça adicionada. Ela vai ao cliente no próximo envio."); void dados.reload(); }} />
      <Cancelar aberto={cancelando} requestId={s.id} onFechar={() => setCancelando(false)}
        onPronto={() => { setCancelando(false); avisar("Solicitação cancelada."); void dados.reload(); }} />
    </>
  );
}

// ------------------------------------------------------------------

function CartaoPeca({ peca, solicitacao, decisoes, editavel, onMudou }: {
  peca: Peca; solicitacao: Solicitacao; decisoes: Decisao[]; editavel: boolean; onMudou: () => void;
}) {
  const avisar = useAviso();
  const atual = versaoAtual(peca);
  const [verId, setVerId] = useState<string | undefined>(atual?.id);
  useEffect(() => setVerId(atual?.id), [atual?.id]);
  const vista = peca.versoes.find((v) => v.id === verId) ?? atual;
  const [conteudo, setConteudo] = useState<"nova" | "trocar" | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const jaEnviada = peca.versoes.some((v) => v.status !== "rascunho");
  const decisoesDaVista = decisoes.filter((d) => d.version_id === vista?.id);
  const pode = editavel && peca.ativo;

  async function acao(fn: () => Promise<unknown>, ok: string) {
    setOcupado(true);
    try {
      await fn();
      avisar(ok);
      onMudou();
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <article className={`peca ${peca.ativo ? "" : "peca-retirada"}`}>
      <header className="peca-topo">
        <div>
          <h3>{peca.nome}</h3>
          <p className="peca-meta">{peca.canal}, {peca.formato}</p>
        </div>
        {!peca.ativo ? <Selo>Retirada</Selo> : atual ? <Selo tom={STATUS_VERSAO[atual.status].tom}>{STATUS_VERSAO[atual.status].rotulo}</Selo> : <Selo>Sem conteúdo</Selo>}
      </header>

      {peca.versoes.length > 1 && (
        <div className="versoes" role="tablist" aria-label={`Versões de ${peca.nome}`}>
          {peca.versoes.map((v) => (
            <button key={v.id} role="tab" aria-selected={v.id === vista?.id} className={v.id === vista?.id ? "on" : ""}
              onClick={() => setVerId(v.id)}>
              Versão {v.numero}
            </button>
          ))}
        </div>
      )}

      {vista ? (
        <>
          <Previa versao={vista} />
          <div className="peca-info">
            <p>
              Versão {vista.numero}
              {vista.tipo === "arquivo" && vista.nome_arquivo ? `, ${vista.nome_arquivo} (${formatarTamanho(vista.tamanho_bytes)})` : ""}
              {vista.enviado_em ? `. Enviada em ${formatarDataHora(vista.enviado_em)}.` : ". Ainda não enviada."}
            </p>
            {vista.observacao && <p className="suave">O que mudou: {vista.observacao}</p>}
            {decisoesDaVista.map((d) => (
              <p key={d.id} className={d.decisao === "aprovado" ? "decisao-ok" : "decisao-alt"}>
                {d.decisao === "aprovado" ? "Aprovada" : "Alterações pedidas"} por {d.user_nome || d.user_email} em {formatarDataHora(d.created_at)}
                {d.comentario ? `: "${d.comentario}"` : "."}
              </p>
            ))}
          </div>
        </>
      ) : (
        <div className="previa previa-vazia">Sem arquivo ou link ainda.</div>
      )}
      {peca.descricao && <p className="peca-desc">{peca.descricao}</p>}

      {pode && (
        <footer className="peca-acoes">
          {!atual || atual.status !== "rascunho" ? (
            <Botao onClick={() => setConteudo("nova")} disabled={ocupado}><LuUpload /> {atual ? "Nova versão" : "Adicionar conteúdo"}</Botao>
          ) : (
            <Botao onClick={() => setConteudo("trocar")} disabled={ocupado}><LuUpload /> Trocar conteúdo</Botao>
          )}
          {jaEnviada ? (
            <Botao variante="fantasma" disabled={ocupado}
              onClick={() => void acao(() => retirarPeca(peca.id), "Peça retirada da aprovação.")}>Retirar peça</Botao>
          ) : (
            <Botao variante="fantasma" className="perigo-texto" disabled={ocupado}
              onClick={() => void acao(() => excluirPeca(peca), "Peça excluída.")}>Excluir peça</Botao>
          )}
        </footer>
      )}

      <ConteudoVersao
        aberto={!!conteudo}
        titulo={conteudo === "trocar" ? `Trocar conteúdo de ${peca.nome}` : `Nova versão de ${peca.nome}`}
        pedirObservacao={!!atual && conteudo === "nova"}
        onFechar={() => setConteudo(null)}
        onEnviar={async (c) => {
          if (conteudo === "trocar" && atual) await descartarRascunho(atual);
          await salvarConteudo(solicitacao, peca.id, c);
          setConteudo(null);
          avisar(conteudo === "trocar" ? "Conteúdo trocado." : "Versão criada. Ela vai ao cliente no próximo envio.");
          onMudou();
        }}
      />
    </article>
  );
}

// ------------------------------------------------------------------

interface Conteudo { tipo: "arquivo" | "link"; arquivo: File | null; link: string; observacao: string }

async function salvarConteudo(s: Solicitacao, pieceId: string, c: Conteudo) {
  const obs = c.observacao.trim() || null;
  if (c.tipo === "arquivo" && c.arquivo) {
    await criarVersaoArquivo({ clientId: s.client_id, requestId: s.id, pieceId }, c.arquivo, obs);
  } else {
    await criarVersaoLink(pieceId, c.link, obs);
  }
}

function CamposConteudo({ c, set, pedirObservacao }: { c: Conteudo; set: (c: Conteudo) => void; pedirObservacao: boolean }) {
  const problema = c.arquivo ? validarArquivo(c.arquivo) : null;
  return (
    <>
      <div className="segmentado" role="group" aria-label="Tipo de conteúdo">
        <button type="button" className={c.tipo === "arquivo" ? "on" : ""} aria-pressed={c.tipo === "arquivo"} onClick={() => set({ ...c, tipo: "arquivo" })}>Arquivo</button>
        <button type="button" className={c.tipo === "link" ? "on" : ""} aria-pressed={c.tipo === "link"} onClick={() => set({ ...c, tipo: "link" })}>Link (Figma, Drive…)</button>
      </div>
      {c.tipo === "arquivo" ? (
        <Campo rotulo="Arquivo" type="file" accept={EXTENSOES_ACEITAS}
          onChange={(e) => set({ ...c, arquivo: e.target.files?.[0] ?? null })}
          erro={problema}
          ajuda={c.arquivo ? `${c.arquivo.name}, ${formatarTamanho(c.arquivo.size)}` : "JPG, PNG, WEBP, MP4 ou PDF, até 50 MB. Vídeo maior: use link do Drive."} />
      ) : (
        <Campo rotulo="Link do material" type="url" placeholder="https://" value={c.link}
          onChange={(e) => set({ ...c, link: e.target.value })}
          ajuda="Confira se o link está aberto para quem tem o endereço." />
      )}
      {pedirObservacao && (
        <CampoTexto rotulo="O que mudou nesta versão" rows={2} value={c.observacao}
          onChange={(e) => set({ ...c, observacao: e.target.value })} ajuda="O cliente vê este texto junto da versão nova." />
      )}
    </>
  );
}

const conteudoVazio = (): Conteudo => ({ tipo: "arquivo", arquivo: null, link: "", observacao: "" });
const conteudoOk = (c: Conteudo) => (c.tipo === "arquivo" ? !!c.arquivo && !validarArquivo(c.arquivo) : /^https?:\/\/\S+/i.test(c.link.trim()));

function ConteudoVersao({ aberto, titulo, pedirObservacao, onFechar, onEnviar }: {
  aberto: boolean; titulo: string; pedirObservacao: boolean; onFechar: () => void; onEnviar: (c: Conteudo) => Promise<void>;
}) {
  const [c, setC] = useState<Conteudo>(conteudoVazio);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { if (aberto) { setC(conteudoVazio()); setErro(null); } }, [aberto]);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!conteudoOk(c)) return setErro(c.tipo === "arquivo" ? "Escolha um arquivo válido." : "Cole um link que comece com https://");
    setSalvando(true);
    setErro(null);
    try {
      await onEnviar(c);
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal aberto={aberto} titulo={titulo} onFechar={onFechar}
      rodape={<>
        <Botao variante="fantasma" onClick={onFechar}>Cancelar</Botao>
        <Botao variante="primario" type="submit" form="form-versao" carregando={salvando}>{salvando ? "Enviando arquivo…" : "Salvar"}</Botao>
      </>}>
      <form id="form-versao" onSubmit={salvar} noValidate className="pilha">
        {erro && <div className="aviso aviso-erro" role="alert"><p>{erro}</p></div>}
        <CamposConteudo c={c} set={setC} pedirObservacao={pedirObservacao} />
      </form>
    </Modal>
  );
}

function NovaPeca({ aberto, solicitacao, ordem, onFechar, onPronto }: {
  aberto: boolean; solicitacao: Solicitacao; ordem: number; onFechar: () => void; onPronto: () => void;
}) {
  const [nome, setNome] = useState("");
  const [canal, setCanal] = useState("Meta Ads");
  const [canalOutro, setCanalOutro] = useState("");
  const [formato, setFormato] = useState("Feed");
  const [formatoOutro, setFormatoOutro] = useState("");
  const [descricao, setDescricao] = useState("");
  const [c, setC] = useState<Conteudo>(conteudoVazio);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const formatos = useMemo(() => (canal === OUTRO ? [] : CANAIS[canal] ?? []), [canal]);

  useEffect(() => {
    if (!aberto) return;
    setNome(""); setCanal("Meta Ads"); setCanalOutro(""); setFormato("Feed"); setFormatoOutro("");
    setDescricao(""); setC(conteudoVazio()); setErro(null);
  }, [aberto]);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const canalFinal = canal === OUTRO ? canalOutro.trim() : canal;
    const formatoFinal = canal === OUTRO || formato === OUTRO ? formatoOutro.trim() : formato;
    if (!nome.trim()) return setErro("Dê um nome para a peça.");
    if (!canalFinal || !formatoFinal) return setErro("Informe canal e formato.");
    const temConteudo = c.tipo === "arquivo" ? !!c.arquivo : !!c.link.trim();
    if (temConteudo && !conteudoOk(c)) return setErro(c.tipo === "arquivo" ? "Arquivo inválido." : "Cole um link que comece com https://");
    setSalvando(true);
    try {
      const pieceId = await criarPeca(solicitacao.id, { nome: nome.trim(), canal: canalFinal, formato: formatoFinal, descricao: descricao.trim() || null, ordem });
      if (temConteudo) await salvarConteudo(solicitacao, pieceId, c);
      onPronto();
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal aberto={aberto} titulo="Adicionar peça" onFechar={onFechar} largura={640}
      rodape={<>
        <Botao variante="fantasma" onClick={onFechar}>Cancelar</Botao>
        <Botao variante="primario" type="submit" form="form-peca" carregando={salvando}>{salvando ? "Salvando…" : "Adicionar peça"}</Botao>
      </>}>
      <form id="form-peca" onSubmit={salvar} noValidate className="pilha">
        {erro && <div className="aviso aviso-erro" role="alert"><p>{erro}</p></div>}
        <Campo rotulo="Nome da peça" obrigatorio value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Conta na mão, versão azul" />
        <div className="grade-2">
          <CampoSelecao rotulo="Canal" value={canal} onChange={(e) => { setCanal(e.target.value); setFormato(CANAIS[e.target.value]?.[0] ?? OUTRO); }}>
            {Object.keys(CANAIS).map((k) => <option key={k} value={k}>{k}</option>)}
            <option value={OUTRO}>Outro</option>
          </CampoSelecao>
          {canal === OUTRO ? (
            <Campo rotulo="Qual canal" value={canalOutro} onChange={(e) => setCanalOutro(e.target.value)} />
          ) : (
            <CampoSelecao rotulo="Formato" value={formato} onChange={(e) => setFormato(e.target.value)}>
              {formatos.map((f) => <option key={f} value={f}>{f}</option>)}
              <option value={OUTRO}>Outro</option>
            </CampoSelecao>
          )}
          {(canal === OUTRO || formato === OUTRO) && (
            <Campo rotulo="Qual formato" value={formatoOutro} onChange={(e) => setFormatoOutro(e.target.value)} />
          )}
        </div>
        <CampoTexto rotulo="Descrição" rows={2} value={descricao} onChange={(e) => setDescricao(e.target.value)}
          ajuda="Opcional. Texto da legenda, chamada ou contexto da peça." />
        <fieldset className="grupo">
          <legend>Conteúdo</legend>
          <CamposConteudo c={c} set={setC} pedirObservacao={false} />
        </fieldset>
      </form>
    </Modal>
  );
}

function ObservacoesInternas({ requestId, editavel }: { requestId: string; editavel: boolean }) {
  const avisar = useAviso();
  const obs = useAsync(() => obterObservacoesSolicitacao(requestId), [requestId]);
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
              await salvarObservacoesSolicitacao(requestId, texto);
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

function Cancelar({ aberto, requestId, onFechar, onPronto }: { aberto: boolean; requestId: string; onFechar: () => void; onPronto: () => void }) {
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { if (aberto) { setMotivo(""); setErro(null); } }, [aberto]);
  return (
    <Modal aberto={aberto} titulo="Cancelar solicitação" onFechar={onFechar} largura={480}
      rodape={<>
        <Botao variante="fantasma" onClick={onFechar}>Voltar</Botao>
        <Botao variante="perigo" carregando={salvando} onClick={async () => {
          setSalvando(true);
          setErro(null);
          try {
            await cancelarSolicitacao(requestId, motivo);
            onPronto();
          } catch (e) {
            setErro(e instanceof Error ? e.message : String(e));
          } finally {
            setSalvando(false);
          }
        }}>Cancelar solicitação</Botao>
      </>}>
      <div className="pilha">
        <p>O cliente continua vendo o histórico, mas não aprova mais nada nesta solicitação. Não dá para desfazer.</p>
        <CampoTexto rotulo="Motivo" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} erro={erro} />
      </div>
    </Modal>
  );
}


function mensagemCriativos(s: Solicitacao, link: string, pessoal: boolean): string {
  const prazo = s.prazo_aprovacao ? ` até ${formatarData(s.prazo_aprovacao)}` : "";
  return [
    `Olá! Os criativos de "${s.titulo}" estão prontos para a sua aprovação${prazo}.`,
    "",
    `Acesse: ${link}`,
    "",
    pessoal
      ? "O link é só seu e funciona uma vez, por 24 horas. Depois do primeiro acesso, este aparelho fica conectado."
      : "Se pedir para entrar, informe o seu e-mail e abra o link de acesso que chegar na sua caixa de entrada.",
  ].join("\n");
}
