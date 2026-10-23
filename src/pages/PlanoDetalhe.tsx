import { useEffect, useMemo, useRef, useState } from "react";
import {
  LuArrowLeft, LuCopyPlus, LuDownload, LuExternalLink, LuEye, LuFileUp, LuLink, LuMerge, LuPencil, LuScissors, LuSend, LuTrash2,
} from "react-icons/lu";
import { useAsync } from "../lib/useAsync";
import { listarClientes, listarUsuarios } from "../lib/api";
import {
  SECOES_SUGERIDAS, cancelarPlano, contagemSecoes, enviarPdfPlano, enviarPlano, listarDecisoesPlano, listarVersoesPlano,
  baixarPdfPlano, chaveLink, definirLinkPlano, nomeArquivoPlano, novaVersaoPlano, obterPlano, paginasDaSecao, plural, removerMaterialPlano,
  salvarNotaVersao, salvarSecoes, slidesCitados, validarLink, type SecaoEditavel,
} from "../lib/planos";
import type { DocumentoPdf } from "../lib/leitorPdf";
import { Link } from "../lib/router";
import { formatarDataHora } from "../lib/format";
import {
  AvisoErro, Botao, CabecalhoPagina, Campo, CampoTexto, Carregando, Modal, Selo, Vazio, useAviso,
} from "../components/ui";
import { AvisarCliente } from "../components/AvisarCliente";
import { Slide, SlideAmpliado, usePdfPlano } from "../components/SlidesPdf";
import { JanelaLink, urlDoSlide } from "../components/SlidesLink";
import { PlanoFormulario } from "./PlanoFormulario";
import {
  STATUS_PLANO, STATUS_SECAO, STATUS_VERSAO_PLANO,
  type DecisaoSecaoPlano, type Plano, type SecaoPlano, type VersaoPlano,
} from "../types";

/** Aprovação de uma versão anterior que pode ser mantida numa seção nova. */
interface AprovacaoAnterior { id: string; nome: string; versao: number; paginas: string; tamanho: number }

export function PlanoDetalhe({ id }: { id: string }) {
  const avisar = useAviso();
  const dados = useAsync(async () => {
    const p = await obterPlano(id);
    if (!p) return null;
    const [versoes, decisoes, clientes, usuarios] = await Promise.all([
      listarVersoesPlano(id), listarDecisoesPlano(id), listarClientes(), listarUsuarios(),
    ]);
    return {
      p, versoes, decisoes,
      cliente: clientes.find((c) => c.id === p.client_id),
      responsavel: usuarios.find((u) => u.id === p.responsavel_id),
    };
  }, [id]);

  const [verId, setVerId] = useState<string | undefined>();
  const [editando, setEditando] = useState(false);
  const [novaVersao, setNovaVersao] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [avisarCliente, setAvisarCliente] = useState(false);
  const [secoesSujas, setSecoesSujas] = useState(false);

  const atualId = dados.data?.versoes.at(-1)?.id;
  useEffect(() => setVerId(atualId), [atualId]);

  const versoes = dados.data?.versoes ?? [];
  const atual = versoes.at(-1);
  const vista = versoes.find((v) => v.id === verId) ?? atual;
  const pdf = usePdfPlano(vista?.pdf_path);

  // Aprovações que ainda valem: as finais da última versão enviada (a mesma
  // regra do banco). Devolve a aprovação original, com nome e tamanho dela.
  const aprovadasAnteriores = useMemo<AprovacaoAnterior[]>(() => {
    const ultimaEnviada = versoes.filter((v) => v.id !== atual?.id && v.status !== "rascunho").at(-1);
    if (!ultimaEnviada) return [];
    const original = new Map<string, { secao: SecaoPlano; versao: number }>();
    for (const v of versoes) for (const s of v.secoes) original.set(s.id, { secao: s, versao: v.numero });
    return ultimaEnviada.secoes
      .filter((s) => s.status === "aprovada" && (ultimaEnviada.status === "concluida" || s.mantem_aprovacao_de))
      .map((s) => {
        const o = original.get(s.mantem_aprovacao_de ?? s.id)!;
        return {
          id: o.secao.id, nome: o.secao.nome, versao: o.versao, paginas: paginasDaSecao(o.secao),
          tamanho: o.secao.pagina_fim - o.secao.pagina_inicio + 1,
        };
      });
  }, [versoes, atual?.id]);

  // Onde cada seção foi aprovada (para mostrar "aprovação mantida da versão 1").
  const origem = useMemo(() => {
    const m = new Map<string, { versao: number; nome: string }>();
    for (const v of versoes) for (const s of v.secoes) m.set(s.id, { versao: v.numero, nome: s.nome });
    return m;
  }, [versoes]);

  if (dados.loading && !dados.data) return <Carregando />;
  if (dados.error) return <AvisoErro erro={dados.error} tentarDeNovo={dados.reload} />;
  if (!dados.data) {
    return <Vazio titulo="Plano não encontrado" acao={<Link to="/planos" className="btn btn-secundario">Voltar</Link>}>
      Ele pode ter sido removido ou você não tem acesso ao cliente.
    </Vazio>;
  }
  const { p, decisoes, cliente, responsavel } = dados.data;
  const st = STATUS_PLANO[p.status];
  const editavel = p.status !== "cancelado";
  const rascunho = editavel && !!vista && vista.id === atual?.id && vista.status === "rascunho";
  const temSecoes = (atual?.secoes.length ?? 0) > 0;
  const motivoNaoEnvia = !atual?.pdf_path && !atual?.link_url ? "Adicione o PDF ou o link do plano." : !temSecoes ? "Marque e salve as seções."
    : secoesSujas ? "Salve as seções antes de enviar." : null;

  async function enviar() {
    setEnviando(true);
    try {
      await enviarPlano(p.id);
      avisar("Plano enviado ao cliente.");
      await dados.reload();
      setAvisarCliente(true);
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
    } finally {
      setEnviando(false);
    }
  }

  async function baixar() {
    if (!vista?.pdf_path) return;
    try {
      await baixarPdfPlano(vista.pdf_path, nomeArquivoPlano(p, vista));
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
    }
  }

  const ajustes = atual?.status === "concluida" ? atual.secoes.filter((s) => s.status === "ajuste_solicitado") : [];

  return (
    <>
      <CabecalhoPagina
        voltar={<Link to="/planos" className="voltar"><LuArrowLeft /> Planos</Link>}
        titulo={<>{p.titulo} <Selo tom={st.tom}>{st.rotulo}</Selo></>}
        descricao={cliente?.nome_comercial}
        acoes={editavel && (
          <>
            <Botao onClick={() => setEditando(true)}><LuPencil /> Editar dados</Botao>
            {p.enviado_em && <Botao onClick={() => setAvisarCliente(true)}><LuLink /> Link para o cliente</Botao>}
            {atual?.status === "rascunho" ? (
              <Botao variante="primario" disabled={!!motivoNaoEnvia} carregando={enviando} onClick={() => void enviar()}
                title={motivoNaoEnvia ?? undefined}>
                <LuSend /> {p.enviado_em ? "Reenviar ao cliente" : "Enviar ao cliente"}
              </Botao>
            ) : (
              <Botao variante="primario" onClick={() => setNovaVersao(true)}><LuCopyPlus /> Nova versão</Botao>
            )}
          </>
        )}
      />

      {p.status === "cancelado" && (
        <div className="aviso aviso-atencao"><p>Cancelado em {formatarDataHora(p.cancelado_em)}. Motivo: {p.motivo_cancelamento}</p></div>
      )}
      {p.status === "ajustes_solicitados" && (
        <div className="aviso aviso-erro">
          <p>O cliente pediu ajuste em {plural(ajustes.length, "seção", "seções")}: {ajustes.map((s) => s.nome).join(", ")}.
            Crie uma versão nova, suba o PDF corrigido e reenvie. As seções aprovadas que não mudarem continuam aprovadas.</p>
        </div>
      )}
      {(p.status === "aguardando_aprovacao" || p.status === "em_analise") && (
        <div className="aviso aviso-info">
          <p>A versão {atual?.numero} está com o cliente ({plural(contagemSecoes(atual).pendentes, "seção", "seções")} sem decisão).
            Para mudar algo agora, crie uma versão nova: a que está com ele fica substituída.</p>
        </div>
      )}

      <div className="layout-detalhe">
        <div className="pilha-larga">
          <section aria-labelledby="titulo-plano">
            <div className="secao-topo">
              <h2 id="titulo-plano" className="titulo-secao">{rascunho ? "Montar o envio" : "Seções e decisões"}</h2>
              {versoes.length > 1 && (
                <div className="versoes" role="group" aria-label="Versões">
                  {versoes.map((v) => (
                    <button key={v.id} type="button" className={v.id === vista?.id ? "on" : ""} aria-pressed={v.id === vista?.id}
                      onClick={() => {
                        if (v.id === vista?.id) return;
                        if (secoesSujas && !window.confirm("As seções têm mudanças não salvas. Sair desta versão e perder as mudanças?")) return;
                        setVerId(v.id);
                      }} title={STATUS_VERSAO_PLANO[v.status].rotulo}>
                      v{v.numero}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {vista && (
              <div className="versao-cabecalho">
                <span>Versão {vista.numero}</span>
                <Selo tom={STATUS_VERSAO_PLANO[vista.status].tom}>{STATUS_VERSAO_PLANO[vista.status].rotulo}</Selo>
                {vista.paginas && <span className="suave">{vista.paginas} slides</span>}
                {vista.enviado_em && <span className="suave">Enviada em {formatarDataHora(vista.enviado_em)}</span>}
                {vista.pdf_path && <Botao variante="fantasma" onClick={() => void baixar()}><LuDownload /> Baixar PDF</Botao>}
                {vista.link_url && (
                  <a className="btn btn-fantasma" href={urlDoSlide(vista.link_url, 1)} target="_blank" rel="noopener noreferrer">
                    <LuExternalLink /> Abrir apresentação
                  </a>
                )}
              </div>
            )}
            {!rascunho && vista?.observacao && <p className="peca-novidade">O que mudou nesta versão: {vista.observacao}</p>}

            {rascunho && vista ? (
              <MontarEnvio key={vista.id} plano={p} versao={vista} pdf={pdf} aprovadasAnteriores={aprovadasAnteriores}
                linksEnviados={versoes.filter((v) => v.status !== "rascunho" && v.link_url).map((v) => v.link_url!)}
                onSujo={setSecoesSujas} onMudou={() => void dados.reload()} />
            ) : vista ? (
              <ResumoSecoes versao={vista} decisoes={decisoes} origem={origem} pdf={pdf} titulo={p.titulo} baixar={() => void baixar()} />
            ) : null}
          </section>
        </div>

        <aside className="lateral-detalhe">
          <section className="painel">
            <h2 className="titulo-painel">Dados</h2>
            <dl className="dados-lista">
              <div><dt>Responsável</dt><dd>{responsavel ? responsavel.nome || responsavel.email : <span className="falta">Ninguém</span>}</dd></div>
              <div><dt>Enviado em</dt><dd>{p.enviado_em ? formatarDataHora(p.enviado_em) : <span className="falta">Ainda não</span>}</dd></div>
              <div><dt>Aberto pelo cliente</dt><dd>{p.visualizado_em ? formatarDataHora(p.visualizado_em) : <span className="falta">Ainda não</span>}</dd></div>
              <div><dt>Recado para o cliente</dt><dd className="pre">{p.instrucoes_cliente || <span className="falta">Nenhum</span>}</dd></div>
            </dl>
          </section>
          <section className="painel">
            <h2 className="titulo-painel">Como funciona</h2>
            <ol className="passos-curtos">
              <li>Suba o PDF exportado do Claude Design, cole o link da apresentação publicada em atratis.com.br, ou os dois.</li>
              <li>Marque onde começa cada seção (Objetivos, Personas…). Capa e sumário podem ser informativos.</li>
              <li>Envie. O cliente aprova ou pede ajuste em cada seção, citando os slides.</li>
              <li>Se pedir ajuste, crie uma versão nova: só as seções que mudaram voltam para ele.</li>
            </ol>
          </section>
          {editavel && (
            <Botao variante="fantasma" className="perigo-texto" onClick={() => setCancelando(true)}>Cancelar plano</Botao>
          )}
        </aside>
      </div>

      <PlanoFormulario aberto={editando} plano={p} onFechar={() => setEditando(false)}
        onSalvo={() => { setEditando(false); avisar("Dados salvos."); void dados.reload(); }} />
      <NovaVersao aberto={novaVersao} plano={p} onFechar={() => setNovaVersao(false)}
        onPronto={() => { setNovaVersao(false); avisar("Versão nova criada. Suba o PDF corrigido e confira as seções."); void dados.reload(); }} />
      <Cancelar aberto={cancelando} planId={p.id} onFechar={() => setCancelando(false)}
        onPronto={() => { setCancelando(false); avisar("Plano cancelado."); void dados.reload(); }} />
      <AvisarCliente aberto={avisarCliente} onFechar={() => setAvisarCliente(false)}
        caminho={`/planos/${p.id}`} clientId={p.client_id}
        mensagem={(link, pessoal) => mensagemPlano(p, versoes.filter((v) => v.status !== "rascunho").at(-1), link, pessoal)} />
    </>
  );
}

/** Mensagem sobre a versão que o cliente vê agora (a última enviada). */
function mensagemPlano(p: Plano, v: VersaoPlano | undefined, link: string, pessoal: boolean): string {
  const novaVersao = (v?.numero ?? 1) > 1;
  return [
    novaVersao
      ? `Olá! Preparamos uma versão nova do plano "${p.titulo}". As seções já aprovadas que não mudaram continuam aprovadas; falta olhar só as que mudaram.`
      : `Olá! O plano "${p.titulo}" está pronto para a sua aprovação. Ele está dividido em seções: em cada uma você aprova ou pede ajuste, e pode comentar citando os slides.`,
    "",
    `Acesse: ${link}`,
    "",
    pessoal
      ? "O link é só seu e funciona uma vez, por 24 horas. Depois do primeiro acesso, este aparelho fica conectado."
      : "Se pedir para entrar, use o botão do Google ou informe o seu e-mail e abra o link de acesso que chegar na sua caixa de entrada.",
  ].join("\n");
}

// ------------------------------------------------------------------
// Versão em rascunho: PDF, seções e nota ao cliente

type Pdf = ReturnType<typeof usePdfPlano>;

function MontarEnvio({ plano, versao, pdf, aprovadasAnteriores, linksEnviados, onSujo, onMudou }: {
  plano: Plano; versao: VersaoPlano; pdf: Pdf; aprovadasAnteriores: AprovacaoAnterior[]; linksEnviados: string[];
  onSujo: (v: boolean) => void; onMudou: () => void;
}) {
  const avisar = useAviso();
  const arquivo = useRef<HTMLInputElement>(null);
  const [subindo, setSubindo] = useState<string | null>(null);
  const [nota, setNota] = useState(versao.observacao ?? "");
  const [salvandoNota, setSalvandoNota] = useState(false);
  const [tirando, setTirando] = useState<"pdf" | "link" | null>(null);

  async function tirar(tipo: "pdf" | "link") {
    if (!window.confirm(tipo === "pdf" ? "Tirar o PDF desta versão? O cliente verá só o link." : "Tirar o link desta versão? O cliente verá só o PDF.")) return;
    setTirando(tipo);
    try {
      await removerMaterialPlano(versao.id, tipo, versao.pdf_path);
      onMudou();
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
    } finally {
      setTirando(null);
    }
  }

  async function escolher(f: File | undefined) {
    if (!f) return;
    setSubindo("Preparando…");
    try {
      const paginas = await enviarPdfPlano(
        { clientId: plano.client_id, planId: plano.id, versionId: versao.id, pdfAnterior: versao.pdf_path }, f, setSubindo);
      if (versao.secoes.length && versao.paginas !== paginas) {
        avisar(`O PDF novo tem ${paginas} slides (antes ${versao.paginas}). Confira onde começa cada seção.`);
      } else {
        avisar("PDF enviado.");
      }
      onMudou();
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
    } finally {
      setSubindo(null);
      if (arquivo.current) arquivo.current.value = "";
    }
  }

  return (
    <div className="pilha">
      <div className="passo-envio">
        <h3>1. Material do plano</h3>
        <p className="suave">
          Use o PDF exportado do Claude Design, o link da apresentação publicada no site da Atratis (com vídeos e carrosséis
          funcionando) ou os dois. Com os dois, o cliente vê o link e pode trocar para o PDF.
          {versao.numero > 1 && " A versão nova começa com o material anterior: troque pelo corrigido."}
        </p>
        <div className="material-bloco">
          <strong>PDF</strong>
          <input ref={arquivo} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => void escolher(e.target.files?.[0])} />
          <div className="acoes-linha">
            <Botao variante={versao.pdf_path ? "secundario" : "primario"} carregando={!!subindo} onClick={() => arquivo.current?.click()}>
              <LuFileUp /> {subindo ?? (versao.pdf_path ? "Trocar PDF" : "Escolher PDF")}
            </Botao>
            {versao.pdf_path && <span className="suave">{versao.paginas} slides neste PDF</span>}
            {versao.pdf_path && versao.link_url && (
              <Botao variante="fantasma" carregando={tirando === "pdf"} onClick={() => void tirar("pdf")}><LuTrash2 /> Tirar PDF</Botao>
            )}
          </div>
        </div>
        <MaterialLink versao={versao} linksEnviados={linksEnviados} tirando={tirando === "link"} onTirar={() => void tirar("link")} onMudou={onMudou} />
      </div>

      {(versao.pdf_path || versao.link_url) && versao.paginas && (
        <div className="passo-envio">
          <h3>2. Seções</h3>
          {versao.pdf_path ? (
            pdf.carregando ? <Carregando texto="Abrindo o PDF…" /> : pdf.erro ? <AvisoErro erro={pdf.erro} tentarDeNovo={pdf.tentarDeNovo} /> :
              pdf.doc ? (
                <EditorSecoes key={`${versao.pdf_path}|${versao.paginas}`} versao={versao} paginas={versao.paginas} doc={pdf.doc}
                  proporcao={pdf.proporcao} aprovadasAnteriores={aprovadasAnteriores} onSujo={onSujo} onSalvo={onMudou} />
              ) : null
          ) : (
            <EditorSecoes key={`${versao.link_url}|${versao.paginas}`} versao={versao} paginas={versao.paginas} doc={null}
              url={versao.link_url!} proporcao={9 / 16} aprovadasAnteriores={aprovadasAnteriores} onSujo={onSujo} onSalvo={onMudou} />
          )}
        </div>
      )}

      {versao.numero > 1 && (
        <div className="passo-envio">
          <h3>3. O que mudou nesta versão</h3>
          <CampoTexto rotulo="Nota para o cliente" rows={2} value={nota} maxLength={2000} onChange={(e) => setNota(e.target.value)}
            ajuda="Opcional. Aparece no topo da página de aprovação." />
          <div>
            <Botao disabled={nota === (versao.observacao ?? "")} carregando={salvandoNota} onClick={async () => {
              setSalvandoNota(true);
              try {
                await salvarNotaVersao(versao.id, nota);
                avisar("Nota salva.");
                onMudou();
              } catch (e) {
                avisar(e instanceof Error ? e.message : String(e), "erro");
              } finally {
                setSalvandoNota(false);
              }
            }}>Salvar nota</Botao>
          </div>
        </div>
      )}
    </div>
  );
}

function MaterialLink({ versao, linksEnviados, tirando, onTirar, onMudou }: {
  versao: VersaoPlano; linksEnviados: string[]; tirando: boolean; onTirar: () => void; onMudou: () => void;
}) {
  const avisar = useAviso();
  const [url, setUrl] = useState(versao.link_url ?? "");
  const [slides, setSlides] = useState(versao.paginas ? String(versao.paginas) : "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const totalFixo = !!versao.pdf_path;
  const total = totalFixo ? versao.paginas ?? 0 : Number(slides);
  const mudou = url.trim().split("#")[0] !== (versao.link_url ?? "") || (!totalFixo && total !== versao.paginas);
  // Mesmo endereço de uma versão já enviada (o banco recusa o envio).
  const repetido = !!url.trim() && linksEnviados.some((l) => chaveLink(l) === chaveLink(url));

  async function salvar() {
    setErro(null);
    const problema = validarLink(url);
    if (problema) return setErro(problema);
    if (!Number.isInteger(total) || total < 1 || total > 500) return setErro("Informe o total de slides da apresentação (o número que aparece no canto, ex.: 06 / 60).");
    setSalvando(true);
    try {
      await definirLinkPlano(versao.id, url, total);
      avisar(versao.paginas && versao.paginas !== total ? `Link salvo. O total mudou para ${total} slides: confira as seções.` : "Link salvo.");
      onMudou();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="material-bloco">
      <strong>Link da apresentação</strong>
      <div className="grade-link">
        <Campo rotulo="Endereço" type="url" inputMode="url" placeholder="https://atratis.com.br/uteis/cliente/pca/" value={url}
          onChange={(e) => setUrl(e.target.value)} />
        <Campo rotulo="Total de slides" inputMode="numeric" value={totalFixo ? String(versao.paginas) : slides} disabled={totalFixo}
          onChange={(e) => setSlides(e.target.value.replace(/\D/g, ""))}
          ajuda={totalFixo ? "Igual ao PDF." : "O número do canto da apresentação (ex.: 06 / 60 → 60)."} />
      </div>
      {repetido && (
        <p className="aviso aviso-atencao pequeno">
          Este é o endereço de uma versão já enviada. Publique a versão corrigida em outro endereço (ex.: com -v{versao.numero} no fim)
          e cole aqui: o link já aprovado precisa continuar mostrando o que foi aprovado.
        </p>
      )}
      {erro && <p className="campo-msg erro" role="alert">{erro}</p>}
      <div className="acoes-linha">
        <Botao variante={versao.link_url ? "secundario" : "primario"} disabled={!mudou || !url.trim()} carregando={salvando} onClick={() => void salvar()}>
          <LuLink /> {versao.link_url ? "Salvar link" : "Usar este link"}
        </Botao>
        {url.trim() && !validarLink(url) && (
          <a className="btn btn-fantasma" href={urlDoSlide(url.trim().split("#")[0], 1)} target="_blank" rel="noopener noreferrer">
            <LuEye /> Conferir
          </a>
        )}
        {versao.link_url && versao.pdf_path && (
          <Botao variante="fantasma" carregando={tirando} onClick={onTirar}><LuTrash2 /> Tirar link</Botao>
        )}
      </div>
    </div>
  );
}

interface SecaoTela { inicio: number; nome: string; requer: boolean; mantem: string | null }

function EditorSecoes({ versao, paginas, doc, url, proporcao, aprovadasAnteriores, onSujo, onSalvo }: {
  versao: VersaoPlano; paginas: number; doc: DocumentoPdf | null; url?: string; proporcao: number;
  aprovadasAnteriores: AprovacaoAnterior[]; onSujo: (v: boolean) => void; onSalvo: () => void;
}) {
  // Sem PDF (só link): as seções são marcadas pelo número do slide, com a apresentação ao lado.
  const [previa, setPrevia] = useState(1);
  const [previaTexto, setPreviaTexto] = useState("1");
  const irPara = (n: number) => {
    const v = Math.min(paginas, Math.max(1, Math.round(n) || 1));
    setPrevia(v);
    setPreviaTexto(String(v));
  };
  const [novoInicio, setNovoInicio] = useState("");
  const avisar = useAviso();
  const inicial = useMemo<SecaoTela[]>(() => versao.secoes.length
    ? versao.secoes.map((s) => ({ inicio: s.pagina_inicio, nome: s.nome, requer: s.requer_aprovacao, mantem: s.mantem_aprovacao_de }))
    : [{ inicio: 1, nome: "", requer: true, mantem: null }], [versao.secoes]);
  const [secoes, setSecoes] = useState<SecaoTela[]>(inicial);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ampliar, setAmpliar] = useState<number | null>(null);

  const fim = (i: number) => (i + 1 < secoes.length ? secoes[i + 1].inicio - 1 : paginas);
  const lista: SecaoEditavel[] = secoes.map((s, i) => ({
    nome: s.nome.trim(), pagina_inicio: s.inicio, pagina_fim: fim(i), requer_aprovacao: s.requer, mantem_aprovacao_de: s.requer ? s.mantem : null,
  }));
  const salvas: SecaoEditavel[] = versao.secoes.map((s) => ({
    nome: s.nome, pagina_inicio: s.pagina_inicio, pagina_fim: s.pagina_fim, requer_aprovacao: s.requer_aprovacao, mantem_aprovacao_de: s.mantem_aprovacao_de,
  }));
  // Compara também onde cada seção termina: um PDF com mais slides muda o fim da última.
  const sujo = !versao.secoes.length || JSON.stringify(lista) !== JSON.stringify(salvas);
  useEffect(() => { onSujo(sujo); }, [sujo, onSujo]);
  useEffect(() => () => onSujo(false), [onSujo]);

  const usadas = new Set(secoes.map((s) => s.mantem).filter(Boolean));

  function mudar(i: number, campos: Partial<SecaoTela>) {
    setSecoes((l) => l.map((s, j) => (j === i ? { ...s, ...campos } : s)));
  }
  // Mudar onde uma seção começa ou termina muda o conteúdo dela: a aprovação mantida cai.
  function dividir(pagina: number) {
    setSecoes((l) => [
      ...l.map((s, j) => (s.inicio < pagina && (j + 1 >= l.length || l[j + 1].inicio > pagina) ? { ...s, mantem: null } : s)),
      { inicio: pagina, nome: "", requer: true, mantem: null },
    ].sort((a, b) => a.inicio - b.inicio));
  }
  function juntar(i: number) {
    setSecoes((l) => l.filter((_, j) => j !== i).map((s, j) => (j === i - 1 ? { ...s, mantem: null } : s)));
  }
  // Modo link: muda o slide em que a seção começa (entre a anterior e a próxima).
  function mudarInicio(i: number, valor: number, campo: HTMLInputElement) {
    const min = secoes[i - 1].inicio + 1;
    const max = i + 1 < secoes.length ? secoes[i + 1].inicio - 1 : paginas;
    if (!Number.isInteger(valor) || valor < min || valor > max) {
      campo.value = String(secoes[i].inicio);
      setErro(`A seção ${i + 1} precisa começar entre o slide ${min} e o ${max}. Mantive o slide ${secoes[i].inicio}.`);
      return;
    }
    setErro(null);
    setSecoes((l) => l.map((s, j) => (j === i ? { ...s, inicio: valor, mantem: null } : j === i - 1 ? { ...s, mantem: null } : s)));
  }
  function adicionarPeloNumero() {
    const n = Number(novoInicio);
    if (!Number.isInteger(n) || n < 2 || n > paginas) return setErro(`Escolha um slide entre 2 e ${paginas}.`);
    if (secoes.some((s) => s.inicio === n)) return setErro(`Já existe uma seção começando no slide ${n}.`);
    setErro(null);
    dividir(n);
    setNovoInicio("");
  }

  async function salvar() {
    setErro(null);
    const semNome = secoes.findIndex((s) => !s.nome.trim());
    if (semNome >= 0) return setErro(`Dê um nome à seção que começa no slide ${secoes[semNome].inicio}.`);
    if (!secoes.some((s) => s.requer)) return setErro("Pelo menos uma seção precisa ser aprovada pelo cliente.");
    setSalvando(true);
    try {
      await salvarSecoes(versao.id, lista);
      avisar("Seções salvas.");
      onSalvo();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="editor-secoes">
      <p className="suave">
        {doc
          ? <>Dê nome a cada seção e use <strong>Começar seção aqui</strong> no slide onde a próxima começa.</>
          : <>Dê nome a cada seção e informe em que slide ela começa. Use a apresentação ao lado para conferir.</>}
        {" "}Capa, sumário e encerramento podem ficar como informativos: o cliente vê, mas não precisa decidir.
      </p>
      {!doc && url && (
        <div className="previa-link">
          <div className="acoes-linha">
            <label className="previa-num">
              Ver o slide
              <input type="number" min={1} max={paginas} value={previaTexto}
                onChange={(e) => setPreviaTexto(e.target.value)}
                onBlur={() => irPara(Number(previaTexto))}
                onKeyDown={(e) => { if (e.key === "Enter") irPara(Number(previaTexto)); }} />
              de {paginas}
            </label>
          </div>
          <JanelaLink url={url} pagina={previa} titulo={`Prévia do slide ${previa}`} sempre />
        </div>
      )}
      <datalist id="secoes-sugeridas">{SECOES_SUGERIDAS.map((n) => <option key={n} value={n} />)}</datalist>

      {secoes.map((s, i) => {
        const tamanho = fim(i) - s.inicio + 1;
        const opcoes = aprovadasAnteriores.filter((a) => a.tamanho === tamanho && (a.id === s.mantem || !usadas.has(a.id)));
        return (
          <section key={s.inicio} className={`secao-editor ${s.mantem ? "secao-mantida" : ""}`} aria-label={s.nome || `Seção ${i + 1}`}>
            <div className="secao-editor-topo">
              <span className="secao-num">{i + 1}</span>
              <label className="secao-nome">
                <span className="sr">Nome da seção {i + 1}</span>
                <input list="secoes-sugeridas" value={s.nome} maxLength={120} placeholder="Nome da seção (ex.: Personas)"
                  onChange={(e) => mudar(i, { nome: e.target.value })} />
              </label>
              {!doc && i > 0 ? (
                <label className="secao-inicio">
                  começa no slide
                  <input type="number" min={secoes[i - 1].inicio + 1} max={paginas} defaultValue={s.inicio} key={s.inicio}
                    onBlur={(e) => { if (Number(e.target.value) !== s.inicio) mudarInicio(i, Number(e.target.value), e.target); }}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                  <span className="suave tab-num">até o {fim(i)}</span>
                </label>
              ) : (
                <span className="suave tab-num">{paginasDaSecao({ pagina_inicio: s.inicio, pagina_fim: fim(i) })}</span>
              )}
              {!doc && (
                <Botao variante="fantasma" onClick={() => irPara(s.inicio)} title="Mostrar o primeiro slide desta seção na prévia">
                  <LuEye /> Ver
                </Botao>
              )}
              {i > 0 && (
                <Botao variante="fantasma" onClick={() => juntar(i)} title="Juntar com a seção anterior">
                  <LuMerge /> Juntar com a anterior
                </Botao>
              )}
            </div>
            <div className="secao-editor-opcoes">
              <select aria-label="Tipo da seção" value={s.requer ? "aprovar" : "informativa"}
                onChange={(e) => mudar(i, { requer: e.target.value === "aprovar", mantem: e.target.value === "aprovar" ? s.mantem : null })}>
                <option value="aprovar">Cliente aprova esta seção</option>
                <option value="informativa">Informativa (não precisa aprovar)</option>
              </select>
              {s.requer && opcoes.length > 0 && (
                <select aria-label="Aprovação" value={s.mantem ?? ""} onChange={(e) => mudar(i, { mantem: e.target.value || null })}>
                  <option value="">Mudou: precisa de nova aprovação</option>
                  {opcoes.map((a) => (
                    <option key={a.id} value={a.id}>Não mudou: manter a aprovação de "{a.nome}" (v{a.versao}, {a.paginas})</option>
                  ))}
                </select>
              )}
            </div>
            {doc && <div className="grade-slides">
              {Array.from({ length: fim(i) - s.inicio + 1 }, (_, k) => s.inicio + k).map((n) => (
                <Slide key={n} doc={doc} pagina={n} proporcao={proporcao} onAbrir={() => setAmpliar(n)}>
                  {n !== s.inicio && (
                    <button type="button" className="slide-dividir" onClick={() => dividir(n)}>
                      <LuScissors aria-hidden /> Começar seção aqui
                    </button>
                  )}
                </Slide>
              ))}
            </div>}
          </section>
        );
      })}

      {!doc && (
        <div className="acoes-linha">
          <label className="secao-inicio">
            Nova seção a partir do slide
            <input type="number" min={2} max={paginas} value={novoInicio} onChange={(e) => setNovoInicio(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") adicionarPeloNumero(); }} />
          </label>
          <Botao onClick={adicionarPeloNumero}><LuScissors /> Adicionar seção</Botao>
        </div>
      )}
      {erro && <div className="aviso aviso-erro" role="alert"><p>{erro}</p></div>}
      <div className="acoes-linha barra-salvar">
        <Botao variante="primario" disabled={!sujo} carregando={salvando} onClick={() => void salvar()}>Salvar seções</Botao>
        <span className="suave">
          {plural(secoes.length, "seção", "seções")}, {secoes.filter((s) => s.requer && !s.mantem).length} para o cliente decidir
          {sujo && versao.secoes.length ? ". Há mudanças não salvas." : ""}
        </span>
      </div>

      {doc && (
        <SlideAmpliado doc={doc} proporcao={proporcao} pagina={ampliar} de={1} ate={paginas} titulo="Plano"
          onMudar={setAmpliar} onFechar={() => setAmpliar(null)} />
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Versão enviada: seções, status e o que o cliente disse

function ResumoSecoes({ versao, decisoes, origem, pdf, titulo, baixar }: {
  versao: VersaoPlano; decisoes: DecisaoSecaoPlano[]; origem: Map<string, { versao: number; nome: string }>;
  pdf: Pdf; titulo: string; baixar: () => void;
}) {
  const [ampliar, setAmpliar] = useState<{ pagina: number; secao: SecaoPlano } | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);
  if (!versao.secoes.length) return <Vazio titulo="Esta versão não tem seções marcadas">Ela não chegou a ser enviada ao cliente.</Vazio>;
  return (
    <div className="pilha">
      {pdf.erro && <AvisoErro erro={pdf.erro} tentarDeNovo={pdf.tentarDeNovo} />}
      {versao.secoes.map((s) => {
        const ds = decisoes.filter((d) => d.section_id === s.id);
        const mantida = s.mantem_aprovacao_de ? origem.get(s.mantem_aprovacao_de) : undefined;
        const stS = STATUS_SECAO[s.status];
        return (
          <section key={s.id} className={`painel secao-resumo secao-${s.status}`}>
            <div className="secao-resumo-topo">
              <h3>{s.nome}</h3>
              <span className="suave">{paginasDaSecao(s)}</span>
              <Selo tom={stS.tom}>{mantida ? "Aprovada (mantida)" : stS.rotulo}</Selo>
            </div>
            {mantida && <p className="suave pequeno">Aprovação mantida da versão {mantida.versao}: a equipe indicou que esta seção não mudou.</p>}
            <HistoricoSecao decisoes={ds} />
            {!pdf.doc && versao.link_url && (
              aberta === s.id
                ? <JanelaLink url={versao.link_url} pagina={s.pagina_inicio} titulo={s.nome} />
                : <div><Botao variante="fantasma" onClick={() => setAberta(s.id)}><LuEye /> Ver na apresentação</Botao></div>
            )}
            {pdf.doc && (
              <div className="faixa-slides">
                {Array.from({ length: s.pagina_fim - s.pagina_inicio + 1 }, (_, k) => s.pagina_inicio + k).map((n) => (
                  <Slide key={n} doc={pdf.doc!} pagina={n} proporcao={pdf.proporcao} onAbrir={() => setAmpliar({ pagina: n, secao: s })} />
                ))}
              </div>
            )}
          </section>
        );
      })}
      {pdf.doc && ampliar && (
        <SlideAmpliado doc={pdf.doc} proporcao={pdf.proporcao} pagina={ampliar.pagina} de={ampliar.secao.pagina_inicio}
          ate={ampliar.secao.pagina_fim} titulo={`${titulo}: ${ampliar.secao.nome}`} baixar={baixar}
          onMudar={(n) => setAmpliar({ ...ampliar, pagina: n })} onFechar={() => setAmpliar(null)} />
      )}
    </div>
  );
}

export function HistoricoSecao({ decisoes }: { decisoes: DecisaoSecaoPlano[] }) {
  if (!decisoes.length) return null;
  return (
    <ul className="decisoes-orcamento">
      {decisoes.map((d) => (
        <li key={d.id} className={d.decisao === "aprovada" ? "decisao-ok" : "decisao-alt"}>
          {d.decisao === "aprovada" ? "Aprovada" : "Ajuste pedido"} por {d.user_nome || d.user_email} em {formatarDataHora(d.created_at)}
          {d.slides.length ? ` (${slidesCitados(d.slides)})` : ""}
          {d.comentario ? `: "${d.comentario}"` : "."}
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------

function NovaVersao({ aberto, plano, onFechar, onPronto }: {
  aberto: boolean; plano: Plano; onFechar: () => void; onPronto: () => void;
}) {
  const [observacao, setObservacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { if (aberto) { setObservacao(""); setErro(null); } }, [aberto]);
  const comCliente = plano.status === "aguardando_aprovacao" || plano.status === "em_analise";
  return (
    <Modal aberto={aberto} titulo="Criar versão nova" onFechar={onFechar} largura={520}
      rodape={<>
        <Botao variante="fantasma" onClick={onFechar}>Voltar</Botao>
        <Botao variante="primario" carregando={salvando} onClick={async () => {
          setSalvando(true);
          setErro(null);
          try {
            await novaVersaoPlano(plano.id, observacao.trim() || null);
            onPronto();
          } catch (e) {
            setErro(e instanceof Error ? e.message : String(e));
          } finally {
            setSalvando(false);
          }
        }}>Criar versão nova</Botao>
      </>}>
      <div className="pilha">
        <p>A versão nova começa com o mesmo PDF e as mesmas seções. As seções que o cliente aprovou de forma final já vêm marcadas
          para manter a aprovação; se mudar alguma delas, troque para "Mudou: precisa de nova aprovação".
          {comCliente && " A versão que está com o cliente fica substituída e ele não consegue mais decidir nela."}
        </p>
        <CampoTexto rotulo="O que muda nesta versão?" rows={2} value={observacao} onChange={(e) => setObservacao(e.target.value)}
          ajuda="Opcional. O cliente vê este texto." erro={erro} />
      </div>
    </Modal>
  );
}

function Cancelar({ aberto, planId, onFechar, onPronto }: { aberto: boolean; planId: string; onFechar: () => void; onPronto: () => void }) {
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { if (aberto) { setMotivo(""); setErro(null); } }, [aberto]);
  return (
    <Modal aberto={aberto} titulo="Cancelar plano" onFechar={onFechar} largura={480}
      rodape={<>
        <Botao variante="fantasma" onClick={onFechar}>Voltar</Botao>
        <Botao variante="perigo" carregando={salvando} onClick={async () => {
          setSalvando(true);
          setErro(null);
          try {
            await cancelarPlano(planId, motivo);
            onPronto();
          } catch (e) {
            setErro(e instanceof Error ? e.message : String(e));
          } finally {
            setSalvando(false);
          }
        }}>Cancelar plano</Botao>
      </>}>
      <div className="pilha">
        <p>O cliente continua vendo o histórico, mas não decide mais nada neste plano. Não dá para desfazer.</p>
        <CampoTexto rotulo="Motivo" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} erro={erro} />
      </div>
    </Modal>
  );
}
