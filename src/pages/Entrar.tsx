import { useEffect, useState, type FormEvent } from "react";
import { provedoresAtivos, supabase } from "../lib/supabase";
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
  if (/signup|sign up|not allowed/.test(descricao)) {
    return "Esta conta Google não está cadastrada no sistema. Entre com o e-mail que a Atratis cadastrou para você, ou peça para cadastrarem este endereço.";
  }
  if (/expired|invalid/.test(descricao)) {
    return "Esse link já foi usado ou venceu. Peça um novo abaixo.";
  }
  return "Não deu para entrar por esse link. Peça um novo abaixo; cada link só funciona uma vez.";
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
  const [temCodigo, setTemCodigo] = useState(false);

  const [comGoogle, setComGoogle] = useState(false);

  useEffect(() => {
    setAvisoLink(falhaDoLink());
    void provedoresAtivos().then((p) => setComGoogle(p.google));
  }, []);

  async function entrarComGoogle() {
    setErro(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}${window.location.pathname}`, queryParams: { prompt: "select_account" } },
    });
    if (error) setErro(`Não foi possível abrir o Google: ${error.message}`);
  }

  useEffect(() => {
    if (espera <= 0) return;
    const t = setTimeout(() => setEspera((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [espera]);

  const alvo = email.trim().toLowerCase();

  async function pedirCodigo(): Promise<boolean> {
    const { error } = await supabase.auth.signInWithOtp({
      email: alvo,
      options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}${window.location.pathname}` },
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
        if (error) setErro("E-mail ou senha não conferem. Se ainda não definiu uma senha, entre pelo link por e-mail.");
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
              {comSenha ? "Entrar" : "Receber link de acesso"}
            </Botao>
            {comGoogle && !comSenha && (
              <>
                <div className="ou" aria-hidden><span>ou</span></div>
                <Botao type="button" className="largura-total botao-google" onClick={() => void entrarComGoogle()}>
                  <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden>
                    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z" />
                    <path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17z" />
                    <path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z" />
                    <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.8l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
                  </svg>
                  Entrar com Google
                </Botao>
              </>
            )}
            <button
              type="button"
              className="link-discreto"
              onClick={() => {
                setComSenha(!comSenha);
                setErro(null);
              }}
            >
              {comSenha ? "Entrar com link por e-mail" : "Sou da equipe e tenho senha"}
            </button>
          </form>
        ) : (
          <form onSubmit={confirmarCodigo} noValidate>
            <h1>Confira seu e-mail</h1>
            <p className="entrar-texto">
              Se <strong>{alvo}</strong> estiver cadastrado, um e-mail com o link de acesso chega em instantes.
              Abra o link no computador ou no celular: ele funciona em qualquer aparelho.
            </p>
            {!temCodigo ? (
              <button type="button" className="link-discreto" onClick={() => setTemCodigo(true)}>
                O e-mail trouxe um código de acesso?
              </button>
            ) : (
              <>
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
                />
                <Botao type="submit" variante="primario" carregando={enviando} className="largura-total">
                  Entrar com o código
                </Botao>
              </>
            )}
            <div className="entrar-acoes">
              <button type="button" className="link-discreto" disabled={espera > 0 || enviando} onClick={() => void reenviar()}>
                {espera > 0 ? `Reenviar e-mail em ${espera}s` : "Reenviar e-mail"}
              </button>
              <button type="button" className="link-discreto" onClick={() => { setEtapa("email"); setErro(null); }}>
                Usar outro e-mail
              </button>
            </div>
            {!temCodigo && erro && <p className="campo-msg erro" role="alert">{erro}</p>}
            <p className="entrar-texto suave">
              Não chegou? Veja a caixa de spam ou peça à Atratis para confirmar o seu cadastro.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
