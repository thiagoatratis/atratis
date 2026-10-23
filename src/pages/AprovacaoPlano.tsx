import { useEffect, useState } from "react";
import { LuArrowLeft, LuCheck, LuDownload, LuMessageSquare } from "react-icons/lu";
import { useAsync } from "../lib/useAsync";
import { listarClientes, listarVinculos } from "../lib/api";
import {
  baixarPdfPlano, contagemSecoes, decidirSecao, listarDecisoesPlano, listarVersoesPlano, nomeArquivoPlano, obterPlano,
  paginasDaSecao, plural, registrarVisualizacaoPlano,
} from "../lib/planos";
import type { DocumentoPdf } from "../lib/leitorPdf";
import { useAuth } from "../lib/auth";
import { Link } from "../lib/router";
import { formatarData } from "../lib/format";
import { AvisoErro, Botao, CampoTexto, Carregando, Selo, Vazio, useAviso } from "../components/ui";
import { Slide, SlideAmpliado, usePdfPlano } from "../components/SlidesPdf";
import { JanelaLink } from "../components/SlidesLink";
import { HistoricoSecao } from "./PlanoDetalhe";
import { STATUS_PLANO, STATUS_SECAO, type DecisaoSecaoPlano, type SecaoPlano } from "../types";

export function AprovacaoPlano({ id }: { id: string }) {
  const { perfil } = useAuth();
  const avisar = useAviso();
  const [registrado, setRegistrado] = useState(false);

  useEffect(() => {
    void registrarVisualizacaoPlano(id).finally(() => setRegistrado(true));
  }, [id]);

  const dados = useAsync(async () => {
    if (!registrado) return undefined;
    const p = await obterPlano(id);
    if (!p) return null;
    const [versoes, decisoes, empresas, vinculos] = await Promise.all([
      listarVersoesPlano(id), listarDecisoesPlano(id), listarClientes(), listarVinculos(),
    ]);
    const meu = vinculos.find((v) => v.user_id === perfil?.id && v.client_id === p.client_id);
    return {
      p, versoes, decisoes,
      empresa: empresas.find((c) => c.id === p.client_id),
      podeAprovar: !!meu?.pode_aprovar && !!meu.ativo,
    };
  }, [id, registrado, perfil?.id]);

  // o cliente só recebe versões já enviadas; a última é a que vale
  const atual = dados.data?.versoes.at(-1);
  // Com link e PDF, abre no link (vídeos e carrosséis funcionando) e dá para trocar.
  const [escolha, setEscolha] = useState<"link" | "pdf" | null>(null);
  const modo: "link" | "pdf" = escolha ?? (atual?.link_url ? "link" : "pdf");
  const pdf = usePdfPlano(modo === "pdf" ? atual?.pdf_path : null);
  const [ampliar, setAmpliar] = useState<{ pagina: number; secao: SecaoPlano } | null>(null);

  if (!registrado || (dados.loading && !dados.data)) return <Carregando />;
  if (dados.error) return <AvisoErro erro={dados.error} tentarDeNovo={dados.reload} />;
  if (!dados.data) {
    return <Vazio titulo="Plano não encontrado" acao={<Link to="/" className="btn btn-secundario">Voltar ao início</Link>}>
      O endereço pode estar errado ou você não tem acesso a esta empresa.
    </Vazio>;
  }
  const { p, versoes, decisoes, empresa, podeAprovar } = dados.data;
  const st = STATUS_PLANO[p.status];
  const aberto = (p.status === "aguardando_aprovacao" || p.status === "em_analise") && atual?.status === "pendente";
  const c = contagemSecoes(atual);
  const anteriores = versoes.slice(0, -1).reverse();

  async function baixar() {
    if (!atual?.pdf_path) return;
    try {
      await baixarPdfPlano(atual.pdf_path, nomeArquivoPlano(p, atual));
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
    }
  }

  async function aposDecidir(secaoId: string, resultado: string) {
    if (resultado === "aprovado") avisar("Plano aprovado. Obrigado!");
    else if (resultado === "ajustes_solicitados") avisar("Respostas enviadas à Atratis.");
    else avisar("Decisão registrada.");
    await dados.reload();
    // Leva para a próxima seção que falta decidir.
    const ordem = atual?.secoes ?? [];
    const i = ordem.findIndex((s) => s.id === secaoId);
    const proxima = [...ordem.slice(i + 1), ...ordem.slice(0, i)].find((s) => s.status === "pendente" && s.id !== secaoId);
    if (proxima && resultado !== "aprovado" && resultado !== "ajustes_solicitados") {
      document.getElementById(`secao-${proxima.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  return (
    <div className="aprovacao aprovacao-plano">
      <Link to="/" className="voltar"><LuArrowLeft /> Início</Link>
      <header className="aprovacao-topo">
        <p className="aprovacao-empresa">{empresa?.nome_comercial}</p>
        <h1>{p.titulo}</h1>
        <div className="aprovacao-meta">
          <Selo tom={st.tom}>{st.rotuloCliente}</Selo>
          {atual && atual.numero > 1 && <span>Versão {atual.numero}</span>}
          {c.total > 0 && <span>{c.total - c.pendentes} de {plural(c.total, "seção decidida", "seções decididas")}</span>}
          {atual?.pdf_path && <Botao variante="fantasma" onClick={() => void baixar()}><LuDownload /> Baixar PDF</Botao>}
        </div>
      </header>

      {p.status === "cancelado" && (
        <div className="aviso aviso-atencao"><p>A Atratis cancelou este plano em {formatarData(p.cancelado_em)}. Não há nada para decidir.</p></div>
      )}
      {p.status === "em_revisao_interna" && (
        <div className="aviso aviso-info"><p>A Atratis está ajustando o plano. Você recebe a versão nova em breve; as seções aprovadas que não mudarem continuam aprovadas.</p></div>
      )}
      {p.status === "ajustes_solicitados" && (
        <div className="aviso aviso-info"><p>Suas respostas foram enviadas. A Atratis vai ajustar {c.ajustes === 1 ? "a seção" : `as ${c.ajustes} seções`} em que você pediu ajuste e mandar uma versão nova.</p></div>
      )}
      {p.status === "aprovado" && (
        <div className="aviso aviso-ok"><p>Plano aprovado em {formatarData(p.concluido_em)}. Todas as seções estão aprovadas.</p></div>
      )}
      {p.instrucoes_cliente && (
        <section className="instrucoes">
          <h2>Recado da Atratis</h2>
          <p className="pre">{p.instrucoes_cliente}</p>
        </section>
      )}
      {atual?.observacao && <p className="peca-novidade">O que mudou nesta versão: {atual.observacao}</p>}

      {aberto && (
        <div className="aviso aviso-info como-decidir">
          <p>
            {podeAprovar
              ? "Veja cada seção e escolha Aprovar ou Pedir ajuste. Ao pedir ajuste, conte o que mudar e marque os slides, se quiser. Você pode mudar de ideia até decidir a última seção."
              : "Seu acesso é só de visualização. As decisões ficam com quem aprova pela empresa."}
          </p>
        </div>
      )}

      {atual?.link_url && atual.pdf_path && (
        <div className="segmentado escolha-formato" role="group" aria-label="Como ver o plano">
          <button type="button" className={modo === "link" ? "on" : ""} aria-pressed={modo === "link"} onClick={() => setEscolha("link")}>
            Apresentação (com vídeos)
          </button>
          <button type="button" className={modo === "pdf" ? "on" : ""} aria-pressed={modo === "pdf"} onClick={() => setEscolha("pdf")}>
            PDF
          </button>
        </div>
      )}

      {atual && atual.secoes.length > 0 && (
        <nav className="indice-secoes" aria-label="Seções do plano">
          {atual.secoes.map((s) => (
            <a key={s.id} href={`#secao-${s.id}`} className={`chip-secao chip-${s.status}`}
              onClick={(e) => { e.preventDefault(); document.getElementById(`secao-${s.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>
              {s.nome}
            </a>
          ))}
        </nav>
      )}

      {modo === "pdf" && pdf.carregando && <Carregando texto="Abrindo o plano…" />}
      {modo === "pdf" && pdf.erro && <AvisoErro erro={pdf.erro} tentarDeNovo={pdf.tentarDeNovo} />}

      {atual?.secoes.map((s) => (
        <SecaoCliente key={s.id} secao={s} doc={modo === "pdf" ? pdf.doc : null} proporcao={pdf.proporcao}
          link={modo === "link" ? atual?.link_url ?? null : null}
          decisoes={decisoes.filter((d) => d.section_id === s.id)}
          aberto={aberto} podeAprovar={podeAprovar} ultima={c.pendentes === 1 && s.status === "pendente"}
          onAmpliar={(n) => setAmpliar({ pagina: n, secao: s })}
          onDecidido={(r) => void aposDecidir(s.id, r)} />
      ))}

      {anteriores.length > 0 && (
        <details className="versoes-anteriores">
          <summary>Versões anteriores ({anteriores.length})</summary>
          <ul>
            {anteriores.map((v) => {
              const cv = contagemSecoes(v);
              return (
                <li key={v.id}>
                  <strong>Versão {v.numero}</strong>:{" "}
                  {v.status === "substituida" ? "substituída pela Atratis antes de você terminar"
                    : `${plural(cv.aprovadas, "seção aprovada", "seções aprovadas")}${cv.ajustes ? `, ajuste pedido em ${v.secoes.filter((s) => s.status === "ajuste_solicitado").map((s) => s.nome).join(", ")}` : ""}`}
                </li>
              );
            })}
          </ul>
        </details>
      )}

      {pdf.doc && ampliar && (
        <SlideAmpliado doc={pdf.doc} proporcao={pdf.proporcao} pagina={ampliar.pagina} de={ampliar.secao.pagina_inicio}
          ate={ampliar.secao.pagina_fim} titulo={ampliar.secao.nome}
          onMudar={(n) => setAmpliar({ ...ampliar, pagina: n })} onFechar={() => setAmpliar(null)} />
      )}
    </div>
  );
}

function SecaoCliente({ secao: s, doc, link, proporcao, decisoes, aberto, podeAprovar, ultima, onAmpliar, onDecidido }: {
  secao: SecaoPlano; doc: DocumentoPdf | null; link: string | null; proporcao: number; decisoes: DecisaoSecaoPlano[];
  aberto: boolean; podeAprovar: boolean; ultima: boolean;
  onAmpliar: (pagina: number) => void; onDecidido: (resultado: string) => void;
}) {
  const mantida = !!s.mantem_aprovacao_de;
  const decide = aberto && podeAprovar && s.requer_aprovacao && !mantida;
  const [mudando, setMudando] = useState(false);
  const [pedindo, setPedindo] = useState(false);
  const [texto, setTexto] = useState("");
  const [slides, setSlides] = useState<number[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  // Seções que não pedem decisão agora começam recolhidas.
  const [verSlides, setVerSlides] = useState(!mantida);

  const paginas = Array.from({ length: s.pagina_fim - s.pagina_inicio + 1 }, (_, k) => s.pagina_inicio + k);
  const st = STATUS_SECAO[s.status];
  // Só decide depois que os slides aparecem (no PDF, quando ele termina de abrir).
  const podeVer = !!link || !!doc;
  const mostrarBotoes = decide && podeVer && (s.status === "pendente" || mudando) && !pedindo;

  async function decidir(tipo: "aprovada" | "ajuste_solicitado") {
    if (tipo === "ajuste_solicitado" && texto.trim().length < 3) return setErro("Conte o que precisa ser ajustado.");
    setOcupado(true);
    setErro(null);
    try {
      const r = await decidirSecao(s.id, tipo, tipo === "ajuste_solicitado" ? texto : undefined, tipo === "ajuste_solicitado" ? slides : []);
      setPedindo(false);
      setMudando(false);
      setTexto("");
      setSlides([]);
      onDecidido(r);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section id={`secao-${s.id}`} className={`painel secao-cliente secao-${s.status}`} aria-labelledby={`titulo-${s.id}`}>
      <div className="secao-resumo-topo">
        <h2 id={`titulo-${s.id}`}>{s.nome}</h2>
        <span className="suave">{paginasDaSecao(s)}</span>
        <Selo tom={st.tom}>{mantida ? "Aprovada antes" : s.requer_aprovacao ? st.rotulo : "Para conhecer"}</Selo>
      </div>
      {mantida && <p className="suave pequeno">Esta seção já foi aprovada e não mudou nesta versão.</p>}
      {!s.requer_aprovacao && <p className="suave pequeno">Seção informativa: não precisa de decisão.</p>}

      {verSlides && link ? (
        <>
          <JanelaLink url={link} pagina={s.pagina_inicio} titulo={s.nome} />
          {s.pagina_fim > s.pagina_inicio && (
            <p className="suave pequeno">A apresentação abre no slide {s.pagina_inicio}. Use as setas dela para ver até o slide {s.pagina_fim}.</p>
          )}
        </>
      ) : verSlides ? (
        doc ? (
          <div className="slides-coluna">
            {paginas.map((n) => <Slide key={n} doc={doc} pagina={n} proporcao={proporcao} onAbrir={() => onAmpliar(n)} />)}
          </div>
        ) : <p className="suave pequeno">Os slides aparecem aqui assim que o plano terminar de abrir.</p>
      ) : (
        <Botao variante="fantasma" onClick={() => setVerSlides(true)}>Ver os slides desta seção</Botao>
      )}

      <HistoricoSecao decisoes={decisoes} />

      {erro && !pedindo && <div className="aviso aviso-erro" role="alert"><p>{erro}</p></div>}
      {mostrarBotoes && (
        <>
          {ultima && <p className="suave pequeno">É a última seção: ao decidir, suas respostas vão para a Atratis.</p>}
          <div className="decisao-botoes">
            <Botao variante="primario" carregando={ocupado} onClick={() => void decidir("aprovada")}><LuCheck /> Aprovar seção</Botao>
            <Botao onClick={() => { setPedindo(true); setErro(null); }}><LuMessageSquare /> Pedir ajuste</Botao>
            {mudando && <Botao variante="fantasma" onClick={() => setMudando(false)}>Manter como está</Botao>}
          </div>
        </>
      )}
      {decide && podeVer && pedindo && (
        <div className="pedido-alteracao">
          <CampoTexto rotulo="O que precisa ser ajustado nesta seção?" rows={3} value={texto} autoFocus maxLength={4000}
            onChange={(e) => setTexto(e.target.value)} erro={erro} />
          {paginas.length > 1 && (
            <fieldset className="citar-slides">
              <legend>A quais slides se refere? (opcional)</legend>
              <div className="chips">
                {paginas.map((n) => {
                  const on = slides.includes(n);
                  return (
                    <button key={n} type="button" className={`chip ${on ? "on" : ""}`} aria-pressed={on}
                      onClick={() => setSlides((l) => (on ? l.filter((x) => x !== n) : [...l, n].sort((a, b) => a - b)))}>
                      Slide {n}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}
          {ultima && <p className="suave pequeno">É a última seção: ao enviar, suas respostas vão para a Atratis.</p>}
          <div className="decisao-botoes">
            <Botao variante="primario" carregando={ocupado} onClick={() => void decidir("ajuste_solicitado")}>Enviar pedido de ajuste</Botao>
            <Botao variante="fantasma" onClick={() => { setPedindo(false); setErro(null); }}>Voltar</Botao>
          </div>
        </div>
      )}
      {decide && !mudando && !pedindo && s.status !== "pendente" && (
        <div>
          <Botao variante="fantasma" onClick={() => setMudando(true)}>Mudar a decisão</Botao>
        </div>
      )}
    </section>
  );
}
