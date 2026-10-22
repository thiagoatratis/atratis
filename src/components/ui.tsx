import {
  createContext, useCallback, useContext, useEffect, useId, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode,
  type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from "react";
import { LuX } from "react-icons/lu";

// ---------------- Botão ----------------

type Variante = "primario" | "secundario" | "fantasma" | "perigo";

export function Botao({
  variante = "secundario", carregando, children, className = "", disabled, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante; carregando?: boolean }) {
  return (
    <button
      className={`btn btn-${variante} ${className}`}
      disabled={disabled || carregando}
      aria-busy={carregando || undefined}
      {...rest}
    >
      {carregando && <span className="spinner" aria-hidden />}
      {children}
    </button>
  );
}

// ---------------- Campos ----------------

interface CampoBase {
  rotulo: string;
  ajuda?: ReactNode;
  erro?: string | null;
  obrigatorio?: boolean;
}

function CampoMoldura({
  id, rotulo, ajuda, erro, obrigatorio, children, className = "",
}: CampoBase & { id: string; children: ReactNode; className?: string }) {
  return (
    <div className={`campo ${erro ? "campo-erro" : ""} ${className}`}>
      <label htmlFor={id}>
        {rotulo}
        {obrigatorio && <span className="obrig" aria-hidden> *</span>}
      </label>
      {children}
      {erro ? (
        <p className="campo-msg erro" id={`${id}-msg`} role="alert">{erro}</p>
      ) : ajuda ? (
        <p className="campo-msg" id={`${id}-msg`}>{ajuda}</p>
      ) : null}
    </div>
  );
}

export function Campo({
  rotulo, ajuda, erro, obrigatorio, className, ...rest
}: CampoBase & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <CampoMoldura id={id} rotulo={rotulo} ajuda={ajuda} erro={erro} obrigatorio={obrigatorio} className={className}>
      <input
        id={id}
        aria-invalid={erro ? true : undefined}
        aria-describedby={erro || ajuda ? `${id}-msg` : undefined}
        required={obrigatorio}
        {...rest}
      />
    </CampoMoldura>
  );
}

export function CampoTexto({
  rotulo, ajuda, erro, obrigatorio, className, ...rest
}: CampoBase & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <CampoMoldura id={id} rotulo={rotulo} ajuda={ajuda} erro={erro} obrigatorio={obrigatorio} className={className}>
      <textarea id={id} aria-invalid={erro ? true : undefined} required={obrigatorio} {...rest} />
    </CampoMoldura>
  );
}

export function CampoSelecao({
  rotulo, ajuda, erro, obrigatorio, className, children, ...rest
}: CampoBase & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <CampoMoldura id={id} rotulo={rotulo} ajuda={ajuda} erro={erro} obrigatorio={obrigatorio} className={className}>
      <select id={id} aria-invalid={erro ? true : undefined} required={obrigatorio} {...rest}>
        {children}
      </select>
    </CampoMoldura>
  );
}

export function Alternador({
  marcado, onChange, rotulo, descricao, disabled,
}: { marcado: boolean; onChange: (v: boolean) => void; rotulo: string; descricao?: string; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="alternador">
      <button
        type="button"
        role="switch"
        id={id}
        aria-checked={marcado}
        className="switch"
        onClick={() => onChange(!marcado)}
        disabled={disabled}
      >
        <span />
      </button>
      <label htmlFor={id}>
        <span>{rotulo}</span>
        {descricao && <small>{descricao}</small>}
      </label>
    </div>
  );
}

// ---------------- Selo de status ----------------

export type Tom = "neutro" | "ok" | "atencao" | "alerta" | "info";

export function Selo({ tom = "neutro", children }: { tom?: Tom; children: ReactNode }) {
  return <span className={`selo selo-${tom}`}>{children}</span>;
}

// ---------------- Estados ----------------

export function Vazio({ titulo, children, acao }: { titulo: string; children?: ReactNode; acao?: ReactNode }) {
  return (
    <div className="vazio">
      <p className="vazio-titulo">{titulo}</p>
      {children && <div className="vazio-texto">{children}</div>}
      {acao && <div className="vazio-acao">{acao}</div>}
    </div>
  );
}

export function Carregando({ texto = "Carregando…" }: { texto?: string }) {
  return (
    <div className="carregando" role="status">
      <span className="spinner" aria-hidden />
      {texto}
    </div>
  );
}

export function AvisoErro({ erro, tentarDeNovo }: { erro: Error | string; tentarDeNovo?: () => void }) {
  return (
    <div className="aviso aviso-erro" role="alert">
      <p>{typeof erro === "string" ? erro : erro.message}</p>
      {tentarDeNovo && <Botao variante="fantasma" onClick={tentarDeNovo}>Tentar de novo</Botao>}
    </div>
  );
}

// ---------------- Janela modal ----------------

export function Modal({
  aberto, titulo, onFechar, children, rodape, largura = 560,
}: {
  aberto: boolean; titulo: string; onFechar: () => void; children: ReactNode; rodape?: ReactNode; largura?: number;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const tituloId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (aberto && !d.open) d.showModal();
    if (!aberto && d.open) d.close();
  }, [aberto]);

  return (
    <dialog
      ref={ref}
      className="modal"
      style={{ maxWidth: largura }}
      aria-labelledby={tituloId}
      onCancel={(e) => {
        e.preventDefault();
        onFechar();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onFechar();
      }}
    >
      {aberto && (
        <div className="modal-corpo">
          <header className="modal-topo">
            <h2 id={tituloId}>{titulo}</h2>
            <button type="button" className="icone-btn" onClick={onFechar} aria-label="Fechar">
              <LuX />
            </button>
          </header>
          <div className="modal-conteudo">{children}</div>
          {rodape && <footer className="modal-rodape">{rodape}</footer>}
        </div>
      )}
    </dialog>
  );
}

// ---------------- Avisos rápidos (toast) ----------------

interface Toast { id: number; texto: string; tom: "ok" | "erro" }
const ToastContext = createContext<(texto: string, tom?: "ok" | "erro") => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [itens, setItens] = useState<Toast[]>([]);
  const avisar = useCallback((texto: string, tom: "ok" | "erro" = "ok") => {
    const id = Date.now() + Math.random();
    setItens((l) => [...l, { id, texto, tom }]);
    setTimeout(() => setItens((l) => l.filter((t) => t.id !== id)), tom === "erro" ? 7000 : 3500);
  }, []);
  return (
    <ToastContext.Provider value={avisar}>
      {children}
      <div className="toasts" aria-live="polite">
        {itens.map((t) => (
          <div key={t.id} className={`toast toast-${t.tom}`}>{t.texto}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useAviso = () => useContext(ToastContext);

// ---------------- Cabeçalho de página ----------------

export function CabecalhoPagina({
  titulo, descricao, acoes, voltar,
}: { titulo: ReactNode; descricao?: ReactNode; acoes?: ReactNode; voltar?: ReactNode }) {
  return (
    <header className="pagina-topo">
      {voltar && <div className="pagina-voltar">{voltar}</div>}
      <div className="pagina-linha">
        <div>
          <h1>{titulo}</h1>
          {descricao && <p className="pagina-desc">{descricao}</p>}
        </div>
        {acoes && <div className="pagina-acoes">{acoes}</div>}
      </div>
    </header>
  );
}
