import { useEffect, useRef, useState } from "react";
import { LuExternalLink } from "react-icons/lu";

/** Endereço que abre a apresentação já no slide `n` (o deck lê o número depois do #). */
export const urlDoSlide = (url: string, n: number) => `${url}#${n}`;

/** Verdadeiro enquanto o elemento está perto da tela. */
export function usePertoDaTela<T extends Element>(margem = "300px 0px") {
  const ref = useRef<T>(null);
  const [perto, setPerto] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!("IntersectionObserver" in window)) {
      setPerto(true);
      return;
    }
    const obs = new IntersectionObserver((itens) => setPerto(itens.some((i) => i.isIntersecting)), { rootMargin: margem });
    obs.observe(el);
    return () => obs.disconnect();
  }, [margem]);
  return { ref, perto };
}

/**
 * A apresentação publicada no site da Atratis, aberta no slide `pagina`, com
 * vídeos e carrosséis funcionando. Roda isolada do portal (outro endereço),
 * sem acesso ao login de quem está vendo. Só carrega perto da tela, porque
 * cada janela abre a apresentação inteira.
 */
export function JanelaLink({ url, pagina, titulo, sempre = false }: {
  url: string; pagina: number; titulo: string; sempre?: boolean;
}) {
  const { ref, perto } = usePertoDaTela<HTMLDivElement>();
  const [carregada, setCarregada] = useState(false);
  const ativa = sempre || perto;
  useEffect(() => { if (!ativa) setCarregada(false); }, [ativa]);
  return (
    <div ref={ref} className="janela-link">
      <div className="janela-link-quadro">
        {ativa && (
          <iframe
            key={`${url}#${pagina}`}
            src={urlDoSlide(url, pagina)}
            title={titulo}
            loading="lazy"
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation"
            allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
            allowFullScreen
            onLoad={() => setCarregada(true)}
          />
        )}
        {!carregada && <span className="janela-link-espera">Abrindo a apresentação…</span>}
      </div>
      <a className="janela-link-abrir" href={urlDoSlide(url, pagina)} target="_blank" rel="noopener noreferrer">
        <LuExternalLink aria-hidden /> Abrir em tela cheia
      </a>
    </div>
  );
}
