import { useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { Botao } from "../components/ui";

/** Lê "#t=<token>&d=<destino>" do link pessoal gerado pela equipe. */
function lerLink(): { token: string | null; destino: string } {
  const h = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const d = h.get("d") ?? "/";
  return { token: h.get("t"), destino: /^\/[\w/-]*$/.test(d) ? d : "/" };
}

/**
 * Entrada pelo link pessoal enviado pelo WhatsApp. O login só acontece no
 * toque em "Entrar": a pré-visualização do WhatsApp abre a página, mas não
 * gasta o link.
 */
export function Acesso() {
  const { session, perfil } = useAuth();
  const [{ token, destino }] = useState(lerLink);
  const [entrando, setEntrando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const ir = (caminho: string) => window.location.replace(caminho);

  async function entrar() {
    if (!token) return;
    setEntrando(true);
    setErro(null);
    const { error } = await supabase.auth.verifyOtp({ token_hash: token, type: "magiclink" });
    if (error) {
      setEntrando(false);
      setErro(/expired|invalid|not found/i.test(error.message)
        ? "Este link já foi usado ou venceu. Peça um novo à Atratis, ou entre com o seu e-mail."
        : `Não foi possível entrar: ${error.message}`);
      return;
    }
    ir(destino);
  }

  return (
    <div className="entrar">
      <div className="entrar-arte" aria-hidden>
        <img src="/logo-mark.svg" alt="" />
      </div>
      <div className="entrar-painel">
        <img className="entrar-logo" src="/logo-atratis.png" alt="Atratis Digital" />
        <h1>Aprovações da Atratis</h1>
        {!token ? (
          <>
            <p className="entrar-texto">Este endereço está incompleto. Abra de novo o link que a Atratis enviou, ou entre com o seu e-mail.</p>
            <Botao variante="primario" className="largura-total" onClick={() => ir("/")}>Entrar com e-mail</Botao>
          </>
        ) : (
          <>
            <p className="entrar-texto">
              A Atratis enviou este link para você ver e aprovar o material. Toque em entrar: não precisa de senha nem de código.
            </p>
            {session && (
              <div className="aviso aviso-atencao">
                <p>Este aparelho já está conectado como {perfil?.nome || perfil?.email || session.user.email}. Entrar pelo link troca para a pessoa do link.</p>
              </div>
            )}
            {erro && <div className="aviso aviso-erro" role="alert"><p>{erro}</p></div>}
            <Botao variante="primario" className="largura-total" carregando={entrando} onClick={() => void entrar()}>Entrar</Botao>
            {session && <button type="button" className="link-discreto" onClick={() => ir(destino)}>Continuar como {perfil?.nome || session.user.email}</button>}
            {erro && <button type="button" className="link-discreto" onClick={() => ir("/")}>Entrar com o meu e-mail</button>}
            <p className="entrar-texto suave pequeno nota-acesso">O link é pessoal e funciona uma vez. Depois disso, este aparelho fica conectado.</p>
          </>
        )}
      </div>
    </div>
  );
}
