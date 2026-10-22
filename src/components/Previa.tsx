import { useEffect, useState } from "react";
import { LuDownload, LuExternalLink, LuFileText, LuLink } from "react-icons/lu";
import { urlArquivo } from "../lib/criativos";
import { formatarTamanho } from "../lib/canais";
import type { Versao } from "../types";

/** Mostra o conteúdo de uma versão: imagem, vídeo, PDF ou link externo. */
export function Previa({ versao, grande = false }: { versao: Versao; grande?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setUrl(null);
    setErro(null);
    if (versao.tipo === "arquivo" && versao.storage_path) {
      urlArquivo(versao.storage_path)
        .then((u) => vivo && setUrl(u))
        .catch((e: Error) => vivo && setErro(e.message));
    }
    return () => {
      vivo = false;
    };
  }, [versao.id, versao.tipo, versao.storage_path]);

  const classe = `previa ${grande ? "previa-grande" : ""}`;

  if (versao.tipo === "link") {
    let dominio = versao.link_url ?? "";
    try {
      dominio = new URL(versao.link_url ?? "").hostname.replace(/^www\./, "");
    } catch { /* link inválido: mostra como veio */ }
    return (
      <div className={`${classe} previa-link`}>
        <LuLink aria-hidden />
        <div>
          <p className="previa-titulo">Material em link externo</p>
          <p className="previa-sub">{dominio}</p>
        </div>
        <a className="btn btn-secundario" href={versao.link_url ?? "#"} target="_blank" rel="noopener noreferrer">
          <LuExternalLink /> Abrir material
        </a>
      </div>
    );
  }

  if (erro) return <div className={`${classe} previa-vazia`}>{erro}</div>;
  if (!url) return <div className={`${classe} previa-vazia`}><span className="spinner" aria-hidden /> Carregando arquivo…</div>;

  const baixar = async () => {
    if (!versao.storage_path) return;
    try {
      window.location.href = await urlArquivo(versao.storage_path, true);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  };

  if (versao.mime_type?.startsWith("image/")) {
    return (
      <figure className={classe}>
        <a href={url} target="_blank" rel="noopener noreferrer" title="Abrir em tamanho real">
          <img src={url} alt={versao.nome_arquivo ?? "Prévia da peça"} loading="lazy" />
        </a>
      </figure>
    );
  }
  if (versao.mime_type === "video/mp4") {
    return (
      <figure className={classe}>
        <video src={url} controls preload="metadata" playsInline />
      </figure>
    );
  }
  return (
    <div className={`${classe} previa-link`}>
      <LuFileText aria-hidden />
      <div>
        <p className="previa-titulo">{versao.nome_arquivo ?? "Documento PDF"}</p>
        <p className="previa-sub">PDF {formatarTamanho(versao.tamanho_bytes)}</p>
      </div>
      <div className="previa-acoes">
        <a className="btn btn-secundario" href={url} target="_blank" rel="noopener noreferrer"><LuExternalLink /> Ver</a>
        <button type="button" className="btn btn-fantasma" onClick={() => void baixar()}><LuDownload /> Baixar</button>
      </div>
    </div>
  );
}
