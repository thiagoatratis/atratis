import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { emailValido } from "../lib/format";
import { Botao, Campo } from "../components/ui";

type Etapa = "email" | "codigo";
const ESPERA_REENVIO = 60;

/**
 * Lê o endereço atual para saber se a pessoa chegou por um link que não
 * completou a entrada (aberto em outro navegador, já usado ou vencido).
 * Limpa os parâmetros do endereço em seguida.
 */
function falhaDoLink(): string | null {
  const busca = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const veioDeLink = busca.has("code") || busca.has("error") || hash.has("error") || hash.has("access_token");
  if (!veioDeLink) return null;
  window.history.replaceState(null, "", window.location.pathname);
  const descricao = (busca.get("error_description") || hash.get("error_description") || "").toLowerCase();
  if (/expired|invalid/.test(descricao)) {
    return "Esse link já foi usado ou venceu. Peça um código novo abaixo.";
  }
  return "Não deu para entrar por esse link. Isso acontece quando ele é aberto em outro navegador ou no celular. Peça um código abaixo e digite-o aqui.";
}

export function Entrar() {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [codigo, setCodigo] = useState("");
  const [comSenha, setComSenha] = useState(false);
  const [etapa, setEtapa] = useState<Etapa>("email");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [avisoLink, setAvisoLink] = useState<string | null>(null);
  const [espera, setEspera] = useState(0);

  useEffect(() => {
    setAvisoLink(falhaDoLink());
  }, []);

  useEffect(() => {
    if (espera <= 0) return;
    const t = setTimeout(() => setEspera((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [espera]);

  const alvo = email.trim().toLowerCase();

  async function pedirCodigo(): Promise<boolean> {
    const { error } = await supabase.auth.signInWithOtp({
      email: alvo,
      options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/` },
    });
    // Por segurança, a resposta é a mesma para e-mail cadastrado ou não,
    // exceto quando o limite de envios foi atingido.
    if (error && /rate|limit|seconds|security purposes/i.test(error.message)) {
      setErro("Muitos pedidos em pouco tempo. Aguarde um minuto e tente de novo.");
      return false;
    }
    setEspera(ESPERA_REENVIO);
    return true;
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!emailValido(alvo)) {
      setErro("Digite um e-mail válido, como nome@empresa.com.br.");
      return;
    }
    setEnviando(true);
    try {
      if (comSenha) {
        const { error } = await supabase.auth.signInWithPassword({ email: alvo, password: senha });
        if (error) setErro("E-mail ou senha não conferem. Se ainda não definiu uma senha, entre com o código por e-mail.");
      } else if (await pedirCodigo()) {
        setAvisoLink(null);
        setCodigo("");
        setEtapa("codigo");
      }
    } finally {
      setEnviando(false);
    }
  }

  async function confirmarCodigo(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const token = codigo.replace(/\D/g, "");
    if (token.length < 6) {
      setErro("Digite os dígitos do código que chegou no e-mail.");
      return;
    }
    setEnviando(true);
    try {
      const { error } = await supabase.auth.verifyOtp({ email: alvo, token, type: "email" });
      if (error) {
        setErro(/expired|invalid/i.test(error.message)
          ? "Código inválido ou vencido. Confira os dígitos ou peça um código novo."
          : `Não foi possível entrar: ${error.message}`);
      }
      // Com sucesso, o AuthProvider recebe a sessão e a tela muda sozinha.
    } finally {
      setEnviando(false);
    }
  }

  async function reenviar() {
    setErro(null);
    setEnviando(true);
    try {
      if (await pedirCodigo()) setCodigo("");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="entrar">
      <div className="entrar-arte" aria-hidden>
        <img src="/logo-mark.svg" alt="" />
      </div>
      <div className="entrar-painel">
        <img className="entrar-logo" src="/logo-atratis.png" alt="Atratis Digital" />
        {etapa === "email" ? (
          <form onSubmit={enviar} noValidate>
            <h1>Aprovações de mídia</h1>
            <p className="entrar-texto">
              Criativos, orçamentos e pedidos de inserção da sua conta, num lugar só. Entre com o e-mail
              cadastrado pela Atratis.
            </p>
            {avisoLink && <div className="aviso aviso-atencao" role="alert"><p>{avisoLink}</p></div>}
            <Campo
              rotulo="E-mail"
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              erro={!comSenha ? erro : null}
              autoFocus
            />
            {comSenha && (
              <Campo
                rotulo="Senha"
                type="password"
                autoComplete="current-password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                erro={erro}
              />
            )}
            <Botao type="submit" variante="primario" carregando={enviando} className="largura-total">
              {comSenha ? "Entrar" : "Receber código de acesso"}
            </Botao>
            <button
              type="button"
              className="link-discreto"
              onClick={() => {
                setComSenha(!comSenha);
                setErro(null);
              }}
            >
              {comSenha ? "Entrar com código por e-mail" : "Sou da equipe e tenho senha"}
            </button>
          </form>
        ) : (
          <form onSubmit={confirmarCodigo} noValidate>
            <h1>Digite o código</h1>
            <p className="entrar-texto">
              Se <strong>{alvo}</strong> estiver cadastrado, um e-mail com o código de acesso chega em
              instantes. O código funciona em qualquer aparelho.
            </p>
            <Campo
              autoFocus
              rotulo="Código de acesso"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={10}
              className="campo-codigo"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/[^\d]/g, ""))}
              erro={erro}
              ajuda="Se preferir, clique no link do e-mail, mas abra-o neste mesmo navegador."
            />
            <Botao type="submit" variante="primario" carregando={enviando} className="largura-total">
              Entrar
            </Botao>
            <div className="entrar-acoes">
              <button type="button" className="link-discreto" disabled={espera > 0 || enviando} onClick={() => void reenviar()}>
                {espera > 0 ? `Reenviar código em ${espera}s` : "Reenviar código"}
              </button>
              <button type="button" className="link-discreto" onClick={() => { setEtapa("email"); setErro(null); }}>
                Usar outro e-mail
              </button>
            </div>
            <p className="entrar-texto suave">
              Não chegou? Veja a caixa de spam ou peça à Atratis para confirmar o seu cadastro.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
