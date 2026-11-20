# Projeto-Plataforma-A-S
## API de mensagens diretas

Use Node.js 22.13 ou superior e rode `node start.mjs`. O servidor cria
`ponto.sqlite` no diretório atual. Use `PONTO_DB_PATH` para escolher outro
arquivo. Em uma implantação HTTPS, defina `PONTO_SECURE_COOKIE=1`.

| Método e rota | Uso |
| --- | --- |
| `POST /api/accounts/register` | Cria conta com JSON `{"username":"ana","password":"senha-de-teste"}`. |
| `POST /api/accounts/login` | Recebe os mesmos campos e cria uma sessão via cookie. |
| `POST /api/accounts/logout` | Encerra a sessão atual. |
| `GET /api/accounts/me` | Retorna a conta autenticada. |
| `GET /api/accounts` | Lista as outras contas com ID e nome de usuário. |
| `POST /api/messages/2` | Envia JSON `{"body":"Oi!"}` para a conta de ID 2. |
| `GET /api/messages/2` | Retorna as últimas 50 mensagens entre a conta autenticada e a conta de ID 2. Use `?before=<nextBefore>` para carregar mensagens anteriores. |

Envie `Content-Type: application/json` nas requisições com corpo e preserve o
cookie retornado no login. O histórico vem em ordem de envio dentro de cada
página. A página atual do app usa o login e o chat da prévia. A API de mensagens
diretas está disponível para integração com a interface.
