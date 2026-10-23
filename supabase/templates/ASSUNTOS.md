# Assuntos dos e-mails (Supabase → Authentication → Emails)

| Modelo no Supabase | Arquivo | Assunto |
|---|---|---|
| Magic Link | `magic_link.html` | Seu acesso às aprovações da Atratis |
| Confirm signup | `confirmation.html` | Confirme seu e-mail no portal da Atratis |
| Invite user | `invite.html` | Seu acesso ao portal de aprovações da Atratis |
| Change Email Address | `email_change.html` | Confirme a troca de e-mail |
| Reset Password | `recovery.html` | Redefinir senha do portal da Atratis |
| Reauthentication | `reauthentication.html` | Seu código de confirmação |

Variáveis do Supabase usadas: `{{ .ConfirmationURL }}` (botão), `{{ .Token }}` (código de 6 dígitos), `{{ .NewEmail }}`.
