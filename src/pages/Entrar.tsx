import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { emailValido } from "../lib/format";
import { Botao, Campo } from "../components/ui";

type Etapa = "email" | "enviado";

export function Entrar() {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [comSenha, setComSenha] = useState(false);
  const [etapa, setEtapa] = useState<Etapa>("email");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const alvo = email.trim().toLowerCase();
    if (!emailValido(alvo)) {
      setErro("Digite um e-mail válido, como nome@empresa.com.br.");
      return;
    }
    setEnviando(true);
    try {
      if (comSenha) {
        const { error } = await supabase.auth.signInWithPassword({ email: alvo, password: senha });
        if (error) setErro("E-mail ou senha não conferem. Se ainda não definiu uma senha, entre pelo link.");
      } else {
        const { error } = await supabase.auth.signInWithOtp({
          email: alvo,
          options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/` },
        });
        // Por segurança, a resposta é a mesma para e-mail cadastrado ou não,
        // exceto quando o limite de envios foi atingido.
        if (error && /rate|limit|seconds/i.test(error.message)) {
          setErro("Muitos pedidos de link em pouco tempo. Aguarde um minuto e tente de novo.");
        } else {
          setEtapa("enviado");
        }
      }
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="entrar">
      <div className="entrar-arte" aria-hidden>
        <img src="/logo-mark.png" alt="" />
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
          <div>
            <h1>Confira seu e-mail</h1>
            <p className="entrar-texto">
              Se <strong>{email.trim().toLowerCase()}</strong> estiver cadastrado, um link de acesso chega em
              instantes. Abra o link neste mesmo navegador.
            </p>
            <p className="entrar-texto suave">
              Não chegou? Veja a caixa de spam ou peça à Atratis para confirmar o seu cadastro.
            </p>
            <Botao variante="secundario" onClick={() => setEtapa("email")}>
              Usar outro e-mail
            </Botao>
          </div>
        )}
      </div>
    </div>
  );
}
