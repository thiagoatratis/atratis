import { useState, type ReactNode } from "react";
import { LuBuilding2, LuHistory, LuImages, LuLogOut, LuMenu, LuSettings, LuUserRound, LuUsers, LuWallet, LuX } from "react-icons/lu";
import { Link, useRouter } from "../lib/router";
import { useAuth } from "../lib/auth";
import { PERFIL_ROTULO } from "../types";

interface ItemMenu { to: string; rotulo: string; icone: ReactNode; so?: "admin" }

const MENU: ItemMenu[] = [
  { to: "/criativos", rotulo: "Criativos", icone: <LuImages /> },
  { to: "/orcamentos", rotulo: "Orçamentos", icone: <LuWallet /> },
  { to: "/clientes", rotulo: "Clientes", icone: <LuBuilding2 /> },
  { to: "/usuarios", rotulo: "Usuários", icone: <LuUsers />, so: "admin" },
  { to: "/historico", rotulo: "Histórico", icone: <LuHistory />, so: "admin" },
  { to: "/configuracoes", rotulo: "Dados da agência", icone: <LuSettings />, so: "admin" },
];

export function ShellInterno({ children }: { children: ReactNode }) {
  const { perfil, sair } = useAuth();
  const { path } = useRouter();
  const [aberto, setAberto] = useState(false);
  const itens = MENU.filter((i) => !i.so || perfil?.role === i.so);

  return (
    <div className="shell">
      <a href="#conteudo" className="pular">Pular para o conteúdo</a>
      <aside className={`lateral ${aberto ? "aberta" : ""}`}>
        <div className="lateral-topo">
          <Link to="/clientes" className="marca" onClick={() => setAberto(false)}>
            <img src="/logo-atratis.png" alt="Atratis Digital" />
          </Link>
          <span className="marca-app">Approval</span>
          <button className="icone-btn so-mobile" onClick={() => setAberto(false)} aria-label="Fechar menu">
            <LuX />
          </button>
        </div>
        <nav aria-label="Principal">
          <ul className="menu">
            {itens.map((i) => {
              const ativo = path === i.to || path.startsWith(`${i.to}/`);
              return (
                <li key={i.to}>
                  <Link
                    to={i.to}
                    className={ativo ? "ativo" : ""}
                    aria-current={ativo ? "page" : undefined}
                    onClick={() => setAberto(false)}
                  >
                    {i.icone}
                    {i.rotulo}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="lateral-rodape">
          <Link to="/perfil" className="eu" onClick={() => setAberto(false)}>
            <LuUserRound />
            <span>
              <strong>{perfil?.nome || perfil?.email}</strong>
              <small>{perfil ? PERFIL_ROTULO[perfil.role] : ""}</small>
            </span>
          </Link>
          <button className="sair" onClick={() => void sair()}>
            <LuLogOut /> Sair
          </button>
        </div>
      </aside>
      {aberto && <div className="lateral-fundo" onClick={() => setAberto(false)} />}
      <div className="principal">
        <div className="barra-mobile">
          <button className="icone-btn" onClick={() => setAberto(true)} aria-label="Abrir menu">
            <LuMenu />
          </button>
          <img src="/logo-atratis.png" alt="Atratis Digital" />
        </div>
        <main id="conteudo" className="conteudo">{children}</main>
      </div>
    </div>
  );
}

export function ShellCliente({ children }: { children: ReactNode }) {
  const { perfil, sair } = useAuth();
  return (
    <div className="portal">
      <a href="#conteudo" className="pular">Pular para o conteúdo</a>
      <header className="portal-topo">
        <Link to="/" className="marca">
          <img src="/logo-atratis.png" alt="Atratis Digital" />
        </Link>
        <div className="portal-usuario">
          <Link to="/perfil">{perfil?.nome || perfil?.email}</Link>
          <button className="sair" onClick={() => void sair()}>
            <LuLogOut /> Sair
          </button>
        </div>
      </header>
      <main id="conteudo" className="portal-conteudo">{children}</main>
    </div>
  );
}
