import { useEffect, useRef, useState, type ReactNode } from "react";
import { LuChevronLeft, LuChevronRight, LuDownload } from "react-icons/lu";
import { abrirPdf, fecharPdf, imagemDaPagina, proporcaoPagina, type DocumentoPdf } from "../lib/leitorPdf";
import { urlPdfPlano } from "../lib/planos";
import { Botao, Modal } from "./ui";

/** Abre o PDF do plano guardado no Storage. Fecha e libera a memória ao sair. */
export function usePdfPlano(caminho: string | null | undefined) {
  const [estado, setEstado] = useState<{ doc: DocumentoPdf | null; proporcao: number; erro: string | null; carregando: boolean }>(
    { doc: null, proporcao: 9 / 16, erro: null, carregando: !!caminho });
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    if (!caminho) {
      setEstado({ doc: null, proporcao: 9 / 16, erro: null, carregando: false });
      return;
    }
    let vivo = true;
    let aberto: DocumentoPdf | null = null;
    setEstado((e) => ({ ...e, doc: null, erro: null, carregando: true }));
    (async () => {
      try {
        const doc = await abrirPdf(await urlPdfPlano(caminho));
        aberto = doc;
        if (!vivo) return fecharPdf(doc);
        const proporcao = await proporcaoPagina(doc, 1);
        if (vivo) setEstado({ doc, proporcao, erro: null, carregando: false });
      } catch (e) {
        if (vivo) setEstado({ doc: null, proporcao: 9 / 16, erro: e instanceof Error ? e.message : String(e), carregando: false });
      }
    })();
    return () => {
      vivo = false;
      if (aberto) fecharPdf(aberto);
    };
  }, [caminho, tentativa]);

  return { ...estado, tentarDeNovo: () => setTentativa((n) => n + 1) };
}

/**
 * Um slide do PDF. Só desenha quando chega perto da tela, na largura em que
 * aparece, e mostra um espaço reservado do mesmo tamanho enquanto isso.
 */
export function Slide({
  doc, pagina, proporcao, rotulo, onAbrir, className = "", children,
}: {
  doc: DocumentoPdf; pagina: number; proporcao: number; rotulo?: string;
  onAbrir?: () => void; className?: string; children?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visivel, setVisivel] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  const [falhou, setFalhou] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!("IntersectionObserver" in window)) {
      setVisivel(true);
      return;
    }
    const obs = new IntersectionObserver((itens) => {
      if (itens.some((i) => i.isIntersecting)) {
        setVisivel(true);
        obs.disconnect();
      }
    }, { rootMargin: "800px 0px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!visivel || !ref.current) return;
    let vivo = true;
    const largura = ref.current.clientWidth * Math.min(window.devicePixelRatio || 1, 2);
    setFalhou(false);
    imagemDaPagina(doc, pagina, largura)
      .then((u) => { if (vivo) setSrc(u); })
      .catch(() => { if (vivo) setFalhou(true); });
    return () => { vivo = false; };
  }, [visivel, doc, pagina]);

  const texto = rotulo ?? `Slide ${pagina}`;
  const conteudo = (
    <span className="slide-quadro" style={{ aspectRatio: `${1 / proporcao}` }}>
      {src ? <img src={src} alt={texto} draggable={false} />
        : <span className="slide-espera">{falhou ? "Não deu para mostrar este slide." : ""}</span>}
    </span>
  );
  return (
    <div ref={ref} className={`slide ${className}`}>
      {onAbrir ? (
        <button type="button" className="slide-botao" onClick={onAbrir} aria-label={`Ampliar ${texto.toLowerCase()}`}>
          {conteudo}
        </button>
      ) : conteudo}
      <span className="slide-rotulo">{texto}</span>
      {children}
    </div>
  );
}

/** Slide ampliado, com setas para passar entre as páginas do intervalo. */
export function SlideAmpliado({
  doc, proporcao, pagina, de, ate, titulo, onMudar, onFechar, baixar,
}: {
  doc: DocumentoPdf; proporcao: number; pagina: number | null; de: number; ate: number; titulo: string;
  onMudar: (p: number) => void; onFechar: () => void; baixar?: () => void;
}) {
  useEffect(() => {
    if (pagina === null) return;
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && pagina > de) onMudar(pagina - 1);
      if (e.key === "ArrowRight" && pagina < ate) onMudar(pagina + 1);
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [pagina, de, ate, onMudar]);

  return (
    <Modal aberto={pagina !== null} titulo={pagina !== null ? `${titulo}, slide ${pagina}` : titulo} onFechar={onFechar} largura={1200}
      rodape={pagina !== null && <>
        {baixar && <Botao variante="fantasma" onClick={baixar}><LuDownload /> Baixar PDF</Botao>}
        <Botao disabled={pagina <= de} onClick={() => onMudar(pagina - 1)} aria-label="Slide anterior"><LuChevronLeft /> Anterior</Botao>
        <Botao disabled={pagina >= ate} onClick={() => onMudar(pagina + 1)} aria-label="Próximo slide">Próximo <LuChevronRight /></Botao>
      </>}>
      {pagina !== null && <Slide key={pagina} doc={doc} pagina={pagina} proporcao={proporcao} className="slide-ampliado" />}
    </Modal>
  );
}
