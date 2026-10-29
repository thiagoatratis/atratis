import { useEffect, useMemo, useState } from "react";
import { LuBan, LuDownload, LuFileText, LuMail, LuPlus, LuSend, LuX } from "react-icons/lu";
import { useAsync } from "../lib/useAsync";
import { listarVinculos, obterAgencia } from "../lib/api";
import {
  baixarPdf, cancelarPI, emailPadrao, emitirPIs, enviarPisPeloSistema, lerEmails, listarEnviosPI, listarPIs, salvarPdf,
} from "../lib/pi";
import { gerarPdfPI, type DadosPdfPI } from "../lib/pdfPi";
import { formatarMes, formatarMoeda } from "../lib/dinheiro";
import { formatarData, formatarDataHora } from "../lib/format";
import { Link } from "../lib/router";
import { Botao, Campo, CampoTexto, Carregando, Modal, Selo, useAviso } from "./ui";
import type {
  Agencia, CamposEmissaoPI, Cliente, DadosEmpresaPI, EnvioPI, Orcamento, PedidoInsercao, VersaoOrcamento,
} from "../types";

const PRAZO_PADRAO = "Data do vencimento do boleto";

/** "2026-11-01" → "01/11/2026 a 30/11/2026". */
function periodoDoMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return `01/${mm}/${a} a ${ultimo}/${mm}/${a}`;
}

const hojeBrasilia = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

const empresa = (c: Pick<Cliente, "nome_comercial" | "razao_social" | "cnpj" | "endereco" | "bairro" | "cidade" | "uf" | "cep" | "telefone" | "email_contato">): DadosEmpresaPI => ({
  nome: c.nome_comercial, razao_social: c.razao_social, cnpj: c.cnpj, endereco: c.endereco, bairro: c.bairro,
  cidade: c.cidade, uf: c.uf, cep: c.cep, telefone: c.telefone, email: c.email_contato,
});
const agenciaPI = (a: Agencia | null): DadosEmpresaPI => ({
  nome: a?.nome ?? "Atratis Digital", razao_social: a?.razao_social ?? null, cnpj: a?.cnpj ?? null, endereco: a?.endereco ?? null,
  bairro: a?.bairro ?? null, cidade: a?.cidade ?? null, uf: a?.uf ?? null, cep: a?.cep ?? null, telefone: a?.telefone ?? null,
  email: a?.email ?? null,
});

/**
 * Seção de P.I.s do orçamento. A equipe emite (só de orçamento aprovado),
 * baixa, envia por e-mail (pelo sistema ou pelo próprio e-mail) e cancela;
 * o cliente vê e baixa.
 */
export function PedidosInsercao({ orcamento, versao, cliente, campanha, equipe }: {
  orcamento: Orcamento;
  versao: VersaoOrcamento | undefined;
  cliente: Cliente | undefined;
  campanha: string | undefined;
  equipe: boolean;
}) {
  const avisar = useAviso();
  const pis = useAsync(() => listarPIs(orcamento.id), [orcamento.id, orcamento.status]);
  const envios = useAsync(() => (equipe ? listarEnviosPI(orcamento.id) : Promise.resolve([] as EnvioPI[])), [orcamento.id, equipe]);
  const [emitindo, setEmitindo] = useState(false);
  const [email, setEmail] = useState<PedidoInsercao[] | null>(null);
  const [cancelando, setCancelando] = useState<PedidoInsercao | null>(null);
  const [baixando, setBaixando] = useState<string | null>(null);

  const podeEmitir = equipe && orcamento.status === "aprovado" && versao?.status === "aprovado";
  const lista = pis.data ?? [];
  const emitidos = lista.filter((p) => p.status === "emitido");
  if (!podeEmitir && !lista.length && !pis.loading) return null;

  async function baixar(p: PedidoInsercao) {
    setBaixando(p.id);
    try {
      await baixarPdf(p, equipe);
      if (!p.pdf_path) void pis.reload();
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "erro");
    } finally {
      setBaixando(null);
    }
  }

  return (
    <section className="pis" aria-labelledby="titulo-pis">
      <div className="secao-topo">
        <h2 id="titulo-pis" className="titulo-secao">Pedidos de Inserção</h2>
        {(podeEmitir || (equipe && emitidos.length > 0)) && (
          <div className="acoes-topo">
            {equipe && emitidos.length > 0 && <Botao onClick={() => setEmail(emitidos)}><LuMail /> Enviar por e-mail</Botao>}
            {podeEmitir && <Botao variante="primario" onClick={() => setEmitindo(true)}><LuPlus /> Gerar P.I.</Botao>}
          </div>
        )}
      </div>
      {pis.loading && !pis.data ? <Carregando /> : !lista.length ? (
        <p className="suave">Orçamento aprovado. Gere o P.I. consolidado ou um por plataforma.</p>
      ) : (
        <div className="tabela-moldura">
          <table className="tabela">
            <thead>
              <tr>
                <th>Número</th>
                <th>Veiculação</th>
                <th className="num">Valor</th>
                <th className="col-opcional">Emissão</th>
                <th><span className="sr">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {lista.map((p) => (
                <tr key={p.id} className={p.status === "cancelado" ? "linha-cancelada" : ""}>
                  <td className="tab-num">
                    <strong>{p.numero}</strong>
                    {p.status === "cancelado" && <> <Selo tom="neutro">Cancelado</Selo></>}
                  </td>
                  <td>{p.veiculacao}{p.status === "cancelado" && p.motivo_cancelamento && <span className="celula-sub">Motivo: {p.motivo_cancelamento}</span>}</td>
                  <td className="num tab-num">{formatarMoeda(p.valor)}</td>
                  <td className="col-opcional tab-num">{formatarData(p.data_emissao)}</td>
                  <td className="acoes-linha">
                    <Botao variante="fantasma" carregando={baixando === p.id} onClick={() => void baixar(p)}>
                      <LuDownload /> PDF
                    </Botao>
                    {equipe && p.status === "emitido" && (
                      <>
                        <button type="button" className="icone-btn" title="Enviar por e-mail" aria-label={`Enviar o P.I. ${p.numero} por e-mail`}
                          onClick={() => setEmail([p])}><LuMail /></button>
                        <button type="button" className="icone-btn perigo-texto" title="Cancelar P.I." aria-label={`Cancelar o P.I. ${p.numero}`}
                          onClick={() => setCancelando(p)}><LuBan /></button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {equipe && (envios.data?.length ?? 0) > 0 && (
        <div className="envios-pi">
          <h3 className="titulo-sub">Enviados por e-mail pelo sistema</h3>
          <ul>
            {envios.data!.map((e) => (
              <li key={e.id}>
                <span className="tab-num">{formatarDataHora(e.created_at)}</span>
                {" · "}{e.numeros.length === 1 ? `P.I. ${e.numeros[0]}` : `P.I.s ${e.numeros.join(", ")}`} para {e.para.join(", ")}
                {e.enviado_por_nome && <span className="suave"> · por {e.enviado_por_nome}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {equipe && versao && cliente && (
        <EmitirPI aberto={emitindo} orcamento={orcamento} versao={versao} cliente={cliente}
          campanhaPadrao={campanha || cliente.nome_comercial}
          jaEmitidos={lista.filter((p) => p.status === "emitido")}
          onFechar={() => setEmitindo(false)}
          onEmitidos={(novos, falhas) => {
            setEmitindo(false);
            void pis.reload();
            avisar(falhas
              ? `${novos.length} P.I.(s) emitido(s), mas ${falhas} PDF(s) não subiram. Use "PDF" na lista para gerar de novo.`
              : `${novos.length === 1 ? `P.I. ${novos[0].numero} emitido` : `${novos.length} P.I.s emitidos`}.`, falhas ? "erro" : undefined);
            setEmail(novos);
          }} />
      )}
      {email && (
        <EmailPIs pis={email} orcamento={orcamento} cliente={cliente} onFechar={() => setEmail(null)}
          onEnviado={() => { setEmail(null); void envios.reload(); void pis.reload(); }} />
      )}
      <CancelarPI pi={cancelando} onFechar={() => setCancelando(null)}
        onPronto={() => { setCancelando(null); avisar("P.I. cancelado. O número não será reaproveitado."); void pis.reload(); }} />
    </section>
  );
}

// ------------------------------------------------------------------

function EmitirPI({ aberto, orcamento, versao, cliente, campanhaPadrao, jaEmitidos, onFechar, onEmitidos }: {
  aberto: boolean; orcamento: Orcamento; versao: VersaoOrcamento; cliente: Cliente; campanhaPadrao: string;
  jaEmitidos: PedidoInsercao[]; onFechar: () => void; onEmitidos: (pis: PedidoInsercao[], falhasPdf: number) => void;
}) {
  const agencia = useAsync(() => obterAgencia(), []);
  const plataformas = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of versao.linhas) m.set(l.plataforma, Math.round(((m.get(l.plataforma) ?? 0) + l.valor) * 100) / 100);
    return [...m.entries()].map(([plataforma, valor]) => ({ plataforma, valor }));
  }, [versao]);
  const total = plataformas.reduce((s, p) => s + p.valor, 0);

  const [porPlataforma, setPorPlataforma] = useState(false);
  const [campos, setCampos] = useState<CamposEmissaoPI>({
    campanha: "", periodo: "", prazo_pagamento: PRAZO_PADRAO, faturamento: "bruto", entrega_fatura: "cliente",
    observacoes: null, observacao_faturamento: null,
  });
  const [previa, setPrevia] = useState<{ url: string; rotulo: string }[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [gerando, setGerando] = useState(false);
  const [confirmar, setConfirmar] = useState(false);

  const detalhamento = plataformas.length > 1
    ? ["Valores por plataforma:", ...plataformas.map((p) => `${p.plataforma}: ${formatarMoeda(p.valor)}`)].join("\n")
    : null;

  useEffect(() => {
    if (!aberto) return;
    setPorPlataforma(false);
    setCampos({
      campanha: campanhaPadrao, periodo: periodoDoMes(orcamento.mes_referencia), prazo_pagamento: PRAZO_PADRAO,
      faturamento: "bruto", entrega_fatura: "cliente", observacoes: detalhamento, observacao_faturamento: null,
    });
    setPrevia(null);
    setErro(null);
    setConfirmar(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  useEffect(() => () => previa?.forEach((p) => URL.revokeObjectURL(p.url)), [previa]);

  const set = <K extends keyof CamposEmissaoPI>(k: K, v: CamposEmissaoPI[K]) => { setCampos((c) => ({ ...c, [k]: v })); setPrevia(null); };
  const faltando = [
    !cliente.razao_social && "razão social", !cliente.cnpj && "CNPJ", !cliente.endereco && "endereço",
  ].filter(Boolean) as string[];
  const quantos = porPlataforma ? plataformas.length : 1;

  function grupos(): { plataforma: string; veiculacao: string; valor: number }[] {
    return porPlataforma
      ? plataformas.map((p) => ({ plataforma: p.plataforma, veiculacao: p.plataforma, valor: p.valor }))
      : [{ plataforma: "", veiculacao: plataformas.map((p) => p.plataforma).join(", "), valor: total }];
  }

  function validar(): boolean {
    if (!campos.campanha.trim() || !campos.periodo.trim() || !campos.prazo_pagamento.trim()) {
      setErro("Preencha campanha, período e prazo para pagamento.");
      return false;
    }
    setErro(null);
    return true;
  }

  async function verPrevia() {
    if (!validar()) return;
    setGerando(true);
    try {
      const hoje = hojeBrasilia();
      const arquivos = [];
      for (const g of grupos()) {
        const dados: DadosPdfPI = {
          ...campos, numero: "", data_emissao: hoje, veiculacao: g.veiculacao, valor: g.valor,
          mes_referencia: orcamento.mes_referencia,
          observacoes: porPlataforma ? null : campos.observacoes,
          dados_cliente: empresa(cliente), dados_agencia: agenciaPI(agencia.data ?? null),
        };
        const bytes = await gerarPdfPI(dados, { previa: true });
        arquivos.push({ url: URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" })), rotulo: g.veiculacao });
      }
      setPrevia(arquivos);
    } catch (e) {
      setErro(e instanceof Error ? `Não deu para montar a prévia: ${e.message}` : String(e));
    } finally {
      setGerando(false);
    }
  }

  async function emitir() {
    if (!validar()) return;
    setGerando(true);
    try {
      const { pis, falhasPdf } = await emitirPIs(orcamento.id, porPlataforma, {
        ...campos,
        campanha: campos.campanha.trim(), periodo: campos.periodo.trim(), prazo_pagamento: campos.prazo_pagamento.trim(),
        observacoes: porPlataforma ? null : campos.observacoes?.trim() || null,
        observacao_faturamento: campos.observacao_faturamento?.trim() || null,
      });
      onEmitidos(pis, falhasPdf);
    } catch (e) {
      setConfirmar(false);
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setGerando(false);
    }
  }

  return (
    <Modal aberto={aberto} titulo="Gerar Pedido de Inserção" onFechar={onFechar} largura={previa ? 1100 : 720}
      rodape={confirmar ? <>
        <span className="rodape-aviso">Emitir {quantos === 1 ? "1 P.I." : `${quantos} P.I.s`} agora? {quantos === 1 ? "O número é definitivo" : "Os números são definitivos"}.</span>
        <Botao variante="fantasma" onClick={() => setConfirmar(false)}>Voltar</Botao>
        <Botao variante="primario" carregando={gerando} onClick={() => void emitir()}>Confirmar emissão</Botao>
      </> : <>
        <Botao variante="fantasma" onClick={onFechar}>Cancelar</Botao>
        <Botao carregando={gerando && !confirmar} onClick={() => void verPrevia()}><LuFileText /> Ver prévia</Botao>
        <Botao variante="primario" onClick={() => validar() && setConfirmar(true)}>Emitir {quantos === 1 ? "P.I." : `${quantos} P.I.s`}</Botao>
      </>}>
      <div className={previa ? "emitir-pi com-previa" : "emitir-pi"}>
        <div className="pilha">
          {erro && <div className="aviso aviso-erro" role="alert"><p>{erro}</p></div>}
          {faltando.length > 0 && (
            <div className="aviso aviso-atencao">
              <p>O cadastro de {cliente.nome_comercial} está sem {faltando.join(", ")}. O P.I. sai com esses campos em branco.{" "}
                <Link to={`/clientes/${cliente.id}`}>Completar cadastro</Link></p>
            </div>
          )}
          {jaEmitidos.length > 0 && (
            <div className="aviso aviso-info">
              <p>Este orçamento já tem P.I. emitido ({jaEmitidos.map((p) => p.numero).join(", ")}). Emitir de novo gera números novos; cancele o anterior se for substituí-lo.</p>
            </div>
          )}

          <fieldset className="grupo">
            <legend>Como emitir</legend>
            <div className="opcoes-radio">
              <label className="check">
                <input type="radio" name="modo" checked={!porPlataforma} onChange={() => { setPorPlataforma(false); setPrevia(null); }} />
                <span>Um P.I. consolidado <small className="suave">({plataformas.map((p) => p.plataforma).join(", ")}: {formatarMoeda(total)})</small></span>
              </label>
              {plataformas.length > 1 && (
                <label className="check">
                  <input type="radio" name="modo" checked={porPlataforma} onChange={() => { setPorPlataforma(true); setPrevia(null); }} />
                  <span>Um P.I. por plataforma <small className="suave">({plataformas.map((p) => `${p.plataforma} ${formatarMoeda(p.valor)}`).join("; ")})</small></span>
                </label>
              )}
            </div>
          </fieldset>

          <div className="grade-2">
            <Campo rotulo="Campanha" value={campos.campanha} onChange={(e) => set("campanha", e.target.value)} maxLength={160} />
            <Campo rotulo="Período" value={campos.periodo} onChange={(e) => set("periodo", e.target.value)} maxLength={120}
              ajuda={<button type="button" className="link-discreto" onClick={() => set("periodo", campos.periodo === "Permanente" ? periodoDoMes(orcamento.mes_referencia) : "Permanente")}>
                {campos.periodo === "Permanente" ? "Usar as datas do mês" : "Usar \"Permanente\""}</button>} />
            <Campo rotulo="Prazo para pagamento" className="span-2" value={campos.prazo_pagamento} maxLength={120}
              onChange={(e) => set("prazo_pagamento", e.target.value)} />
          </div>

          <div className="grade-2">
            <fieldset className="grupo">
              <legend>Forma de faturamento</legend>
              <div className="opcoes-radio linha">
                {(["bruto", "liquido"] as const).map((v) => (
                  <label key={v} className="check"><input type="radio" name="fat" checked={campos.faturamento === v} onChange={() => set("faturamento", v)} />
                    <span>{v === "bruto" ? "Bruto" : "Líquido"}</span></label>
                ))}
              </div>
            </fieldset>
            <fieldset className="grupo">
              <legend>Entrega da fatura</legend>
              <div className="opcoes-radio linha">
                {(["cliente", "agencia"] as const).map((v) => (
                  <label key={v} className="check"><input type="radio" name="ent" checked={campos.entrega_fatura === v} onChange={() => set("entrega_fatura", v)} />
                    <span>{v === "cliente" ? "Cliente" : "Agência"}</span></label>
                ))}
              </div>
            </fieldset>
          </div>

          {!porPlataforma && (
            <CampoTexto rotulo="Observações" rows={4} value={campos.observacoes ?? ""} maxLength={1500}
              onChange={(e) => set("observacoes", e.target.value || null)}
              ajuda={plataformas.length > 1 ? "Já vem com o valor de cada plataforma. Edite se quiser." : "Opcional. Aparece no quadro ao lado dos dados da campanha."} />
          )}
          <Campo rotulo="Observação do faturamento" value={campos.observacao_faturamento ?? ""} maxLength={500}
            onChange={(e) => set("observacao_faturamento", e.target.value || null)} ajuda="Opcional. Aparece no fim do P.I." />
        </div>

        {previa && (
          <div className="previa-pi">
            {previa.map((p) => (
              <figure key={p.url}>
                <figcaption>Prévia: {p.rotulo}</figcaption>
                <iframe src={`${p.url}#toolbar=0&view=FitH`} title={`Prévia do P.I. ${p.rotulo}`} />
              </figure>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

type ModoEnvio = "sistema" | "manual";

/**
 * E-mail dos P.I.s. Duas formas: o sistema envia pelo Gmail da Atratis com os
 * PDFs anexos (e registra o envio), ou a pessoa copia o texto, baixa os PDFs
 * e manda pelo próprio e-mail. Destinatários: sugere os aprovadores do
 * cliente e o e-mail de contato do cadastro; a equipe tira e põe na hora.
 */
function EmailPIs({ pis, orcamento, cliente, onFechar, onEnviado }: {
  pis: PedidoInsercao[]; orcamento: Orcamento; cliente: Cliente | undefined; onFechar: () => void; onEnviado: () => void;
}) {
  const avisar = useAviso();
  const link = `${window.location.origin}/orcamentos/${orcamento.id}`;
  const padrao = useMemo(() => emailPadrao(pis, link), [pis, link]);
  const vinculos = useAsync(() => listarVinculos(orcamento.client_id), [orcamento.client_id]);
  const [modo, setModo] = useState<ModoEnvio>("sistema");
  const [para, setPara] = useState<string[] | null>(null);
  const [novo, setNovo] = useState("");
  const [erroPara, setErroPara] = useState<string | null>(null);
  const [assunto, setAssunto] = useState(padrao.assunto);
  const [corpo, setCorpo] = useState(padrao.corpo);
  const [baixando, setBaixando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Sugestões: aprovadores ativos do cliente + e-mail de contato do cadastro.
  const sugestoes = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of vinculos.data ?? []) {
      const e = v.profile?.email?.trim().toLowerCase();
      if (e && v.ativo && v.pode_aprovar && v.profile?.ativo) m.set(e, v.profile.nome?.trim() || e);
    }
    const contato = cliente?.email_contato?.trim().toLowerCase();
    if (contato && !m.has(contato)) m.set(contato, "Contato do cadastro");
    return [...m].map(([email, nome]) => ({ email, nome }));
  }, [vinculos.data, cliente?.email_contato]);

  // Começa com todas as sugestões marcadas; a equipe tira o que não quiser.
  useEffect(() => {
    if (para === null && !vinculos.loading) setPara(sugestoes.map((s) => s.email));
  }, [para, vinculos.loading, sugestoes]);

  const lista = para ?? [];
  const nomeDe = (e: string) => sugestoes.find((s) => s.email === e)?.nome;
  const rotulo = (e: string) => { const n = nomeDe(e); return n && n !== e ? `${n} (${e})` : e; };
  const naoMarcadas = sugestoes.filter((s) => !lista.includes(s.email));

  function adicionar(): boolean {
    const { validos, invalidos } = lerEmails(novo);
    if (invalidos.length) {
      setErroPara(`E-mail inválido: ${invalidos.join(", ")}`);
      return false;
    }
    if (validos.length) setPara([...new Set([...lista, ...validos])]);
    setNovo("");
    setErroPara(null);
    return true;
  }

  async function copiar(texto: string, oque: string) {
    try {
      await navigator.clipboard.writeText(texto);
      avisar(`${oque} copiado.`);
    } catch {
      avisar("Não deu para copiar. Selecione o texto e copie manualmente.", "erro");
    }
  }

  async function enviarPeloSistema() {
    setErro(null);
    if (novo.trim() && !adicionar()) return;
    const destino = [...new Set([...lista, ...lerEmails(novo).validos])];
    if (!destino.length) return setErro("Escolha pelo menos um destinatário.");
    if (destino.length > 10) return setErro("Use no máximo 10 destinatários.");
    if (!assunto.trim() || !corpo.trim()) return setErro("Preencha o assunto e a mensagem.");
    if (!window.confirm(`Enviar agora para ${destino.join(", ")}?\n\n${pis.length === 1 ? "O PDF vai anexo." : `Os ${pis.length} PDFs vão anexos.`}`)) return;
    setEnviando(true);
    try {
      // O e-mail anexa o PDF guardado; se algum ainda não foi gerado, gera agora.
      for (const p of pis) if (!p.pdf_path) await salvarPdf(p);
      await enviarPisPeloSistema({ pis: pis.map((p) => p.id), para: destino, assunto: assunto.trim(), corpo });
      avisar(`E-mail enviado para ${destino.join(", ")}.`);
      onEnviado();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setEnviando(false);
    }
  }

  const mailto = `mailto:${lista.map(encodeURIComponent).join(",")}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`;

  return (
    <Modal aberto titulo={pis.length === 1 ? `E-mail do P.I. ${pis[0].numero}` : `E-mail dos P.I.s ${pis.map((p) => p.numero).join(", ")}`}
      onFechar={onFechar} largura={660}
      rodape={modo === "sistema" ? <>
        <Botao variante="fantasma" onClick={onFechar}>Fechar</Botao>
        <Botao variante="primario" carregando={enviando} onClick={() => void enviarPeloSistema()}><LuSend /> Enviar agora</Botao>
      </> : <>
        <Botao variante="fantasma" onClick={onFechar}>Fechar</Botao>
        <Botao carregando={baixando} onClick={async () => {
          setBaixando(true);
          try { for (const p of pis) await baixarPdf(p, true); } catch (e) { avisar(e instanceof Error ? e.message : String(e), "erro"); } finally { setBaixando(false); }
        }}><LuDownload /> Baixar {pis.length === 1 ? "PDF" : "PDFs"}</Botao>
        <Botao variante="primario" onClick={() => void copiar(`${assunto}\n\n${corpo}`, "E-mail")}><LuMail /> Copiar e-mail</Botao>
      </>}>
      <div className="pilha">
        <div className="segmentado" role="group" aria-label="Como enviar">
          <button type="button" className={modo === "sistema" ? "on" : ""} aria-pressed={modo === "sistema"} onClick={() => setModo("sistema")}>
            Enviar pelo sistema
          </button>
          <button type="button" className={modo === "manual" ? "on" : ""} aria-pressed={modo === "manual"} onClick={() => setModo("manual")}>
            Enviar pelo meu e-mail
          </button>
        </div>
        {modo === "sistema" ? (
          <p className="suave">O e-mail sai do Gmail da Atratis com {pis.length === 1 ? "o PDF anexo" : `os ${pis.length} PDFs anexos`} e fica
            registrado neste orçamento. Respostas do cliente vão para o seu e-mail.</p>
        ) : (
          <p className="suave">Copie o texto, baixe {pis.length === 1 ? "o PDF" : "os PDFs"} e mande pelo seu e-mail.
            {lista.length > 0 && <> Ou <a href={mailto}>abra no seu programa de e-mail</a> (anexe {pis.length === 1 ? "o PDF" : "os PDFs"} antes de enviar).</>}</p>
        )}
        {erro && <div className="aviso aviso-erro" role="alert"><p>{erro}</p></div>}

        <fieldset className="grupo">
          <legend>Para</legend>
          {vinculos.loading && para === null ? <p className="suave pequeno">Carregando os aprovadores do cliente…</p> : (
            <div className="pilha-curta">
              {lista.length > 0 ? (
                <div className="chips">
                  {lista.map((e) => (
                    <button key={e} type="button" className="chip on" title="Tirar da lista" aria-label={`Tirar ${e} da lista`}
                      onClick={() => setPara(lista.filter((x) => x !== e))}>
                      {rotulo(e)} <LuX aria-hidden />
                    </button>
                  ))}
                </div>
              ) : <p className="suave pequeno">Ninguém na lista ainda.</p>}
              {naoMarcadas.length > 0 && (
                <div className="chips" aria-label="Sugestões">
                  {naoMarcadas.map((s) => (
                    <button key={s.email} type="button" className="chip" onClick={() => setPara([...lista, s.email])}>
                      <LuPlus aria-hidden /> {rotulo(s.email)}
                    </button>
                  ))}
                </div>
              )}
              <form className="linha-adicionar" onSubmit={(e) => { e.preventDefault(); adicionar(); }}>
                <Campo rotulo="Adicionar e-mail" type="text" inputMode="email" value={novo} erro={erroPara}
                  placeholder="nome@empresa.com.br" onChange={(e) => { setNovo(e.target.value); setErroPara(null); }}
                  ajuda={!sugestoes.length ? "O cliente não tem aprovador nem e-mail de contato no cadastro." : "Separe vários com vírgula."} />
                <Botao type="submit" disabled={!novo.trim()}><LuPlus /> Adicionar</Botao>
              </form>
            </div>
          )}
        </fieldset>

        <Campo rotulo="Assunto" value={assunto} maxLength={200} onChange={(e) => setAssunto(e.target.value)}
          ajuda={modo === "manual" && <button type="button" className="link-discreto" onClick={() => void copiar(assunto, "Assunto")}>Copiar só o assunto</button>} />
        <CampoTexto rotulo="Mensagem" rows={12} value={corpo} onChange={(e) => setCorpo(e.target.value)} />
        <p className="suave pequeno">{formatarMes(orcamento.mes_referencia)}. Emitido em {formatarDataHora(pis[0]?.created_at)}.</p>
      </div>
    </Modal>
  );
}

function CancelarPI({ pi, onFechar, onPronto }: { pi: PedidoInsercao | null; onFechar: () => void; onPronto: () => void }) {
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { if (pi) { setMotivo(""); setErro(null); } }, [pi]);
  return (
    <Modal aberto={!!pi} titulo={`Cancelar o P.I. ${pi?.numero ?? ""}`} onFechar={onFechar} largura={480}
      rodape={<>
        <Botao variante="fantasma" onClick={onFechar}>Voltar</Botao>
        <Botao variante="perigo" carregando={salvando} onClick={async () => {
          if (!pi) return;
          setSalvando(true);
          setErro(null);
          try {
            await cancelarPI(pi.id, motivo);
            onPronto();
          } catch (e) {
            setErro(e instanceof Error ? e.message : String(e));
          } finally {
            setSalvando(false);
          }
        }}>Cancelar P.I.</Botao>
      </>}>
      <div className="pilha">
        <p>O P.I. continua no histórico, marcado como cancelado, e o número {pi?.numero} não volta a ser usado. Não dá para desfazer.</p>
        <CampoTexto rotulo="Motivo" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} erro={erro} />
      </div>
    </Modal>
  );
}
