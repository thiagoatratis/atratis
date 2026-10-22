-- =====================================================================
-- Atratis Approval · Dados iniciais
-- Dados da agência conforme o P.I. de referência (Atlântico, 18/09/2026).
-- Telefone: confirmado (85) 3122-4408, do cabeçalho do P.I.
-- Clientes: só o nome comercial. Razão social, CNPJ e endereço são
-- preenchidos depois, na tela de cadastro, com dados confirmados.
-- =====================================================================

insert into public.agency_settings
  (id, nome, razao_social, cnpj, endereco, bairro, cidade, uf, cep, telefone)
values
  (true, 'Atratis Digital', 'Atratis Digital LTDA', '11647486000170',
   'Av. Rogaciano Leite, 300, Casa 08', 'Salinas', 'Fortaleza', 'CE', '60810786',
   '(85) 3122-4408')
on conflict (id) do nothing;

insert into public.clients (nome_comercial)
select v.nome
from (values
  ('Fortes São Paulo'),
  ('Fortes Teresina'),
  ('Jacauna Decorações'),
  ('M7 Investimentos'),
  ('About Brasil'),
  ('Nortis Energia'),
  ('Dasart Engenharia')
) as v(nome)
where not exists (
  select 1 from public.clients c where lower(btrim(c.nome_comercial)) = lower(v.nome)
);
