import {randomBytes, scrypt, timingSafeEqual} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {promisify} from 'node:util';

const deriveKey = promisify(scrypt);
const sessionDuration = 7 * 24 * 60 * 60 * 1000;

async function readJson(request) {
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') return null;
  const chunks = [];
  let length = 0;
  for await (const chunk of request.iterator({destroyOnReturn: false})) {
    length += chunk.length;
    if (length > 16_384) {
      // Drain the remaining request so the client can receive the error.
      request.resume();
      return null;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

function accountCookie(token, maxAge) {
  const secure = process.env.PONTO_SECURE_COOKIE === '1' ? '; Secure' : '';
  return {'Set-Cookie': `ponto_account=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Strict${secure}`};
}

export function createMessaging(dbPath, json) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      salt BLOB NOT NULL,
      password_hash BLOB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS account_sessions (
      token TEXT PRIMARY KEY,
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expiry ON account_sessions(expires_at);
    CREATE TABLE IF NOT EXISTS direct_messages (
      id INTEGER PRIMARY KEY,
      sender_id INTEGER NOT NULL REFERENCES accounts(id),
      recipient_id INTEGER NOT NULL REFERENCES accounts(id),
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      CHECK (sender_id <> recipient_id)
    );
    CREATE TABLE IF NOT EXISTS general_messages (
      id INTEGER PRIMARY KEY,
      author TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS direct_messages_pair ON direct_messages(sender_id, recipient_id, id);
  `);

  const findAccount = db.prepare('SELECT * FROM accounts WHERE username = ?');
  const addAccount = db.prepare('INSERT INTO accounts (username, salt, password_hash) VALUES (?, ?, ?) ON CONFLICT(username) DO NOTHING RETURNING id, username');
  const findSession = db.prepare(`
    SELECT accounts.id, accounts.username FROM account_sessions
    JOIN accounts ON accounts.id = account_sessions.account_id
    WHERE token = ? AND expires_at > ?
  `);
  const addSession = db.prepare('INSERT INTO account_sessions VALUES (?, ?, ?)');
  const deleteSession = db.prepare('DELETE FROM account_sessions WHERE token = ?');
  const deleteExpired = db.prepare('DELETE FROM account_sessions WHERE expires_at <= ?');
  const listAccounts = db.prepare('SELECT id, username FROM accounts WHERE id <> ? ORDER BY username');
  const findContact = db.prepare('SELECT id FROM accounts WHERE id = ?');
  const messageColumns = 'id, sender_id AS senderId, recipient_id AS recipientId, body, created_at AS createdAt';
  const addMessage = db.prepare(`
    INSERT INTO direct_messages (sender_id, recipient_id, body, created_at)
    VALUES (?, ?, ?, ?) RETURNING ${messageColumns}
  `);
  const listMessages = db.prepare(`
    SELECT ${messageColumns} FROM direct_messages
    WHERE ((sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?))
      AND id < ?
    ORDER BY id DESC LIMIT 51
  `);

  async function handle(request, response, url) {
    const {pathname, searchParams} = url;
    const {method} = request;
    const token = request.headers.cookie?.match(/(?:^|;\s*)ponto_account=([a-f0-9]{64})(?=;|$)/)?.[1];
    const now = Date.now();
    const send = (status, payload, headers) => json(response, status, payload, headers);
    const error = (status, message) => send(status, {error: message});

    if (method === 'POST' && ['/api/accounts/register', '/api/accounts/login'].includes(pathname)) {
      const data = await readJson(request);
      const username = typeof data?.username === 'string' ? data.username.trim().toLowerCase() : '';
      const password = data?.password;
      if (!/^[a-z0-9_]{3,32}$/.test(username) || typeof password !== 'string' || password.length < 8 || password.length > 128) {
        return error(400, 'Use um usuário de 3 a 32 caracteres (letras, números ou _) e uma senha de 8 a 128 caracteres.');
      }

      if (pathname.endsWith('/register')) {
        const salt = randomBytes(16);
        const hash = await deriveKey(password, salt, 64);
        const account = addAccount.get(username, salt, hash);
        return account ? send(201, account) : error(409, 'Esse usuário já existe.');
      }

      const account = findAccount.get(username);
      const hash = await deriveKey(password, account?.salt ?? Buffer.alloc(16), 64);
      if (!account || !timingSafeEqual(hash, account.password_hash)) return error(401, 'Usuário ou senha inválidos.');
      deleteExpired.run(now);
      if (token) deleteSession.run(token);
      const newToken = randomBytes(32).toString('hex');
      addSession.run(newToken, account.id, now + sessionDuration);
      return send(200, {id: account.id, username}, accountCookie(newToken, sessionDuration / 1000));
    }

    if (method === 'POST' && pathname === '/api/accounts/logout') {
      if (token) deleteSession.run(token);
      return send(200, {}, accountCookie('', 0));
    }

    const account = token && findSession.get(token, now);
    if (!account) return error(401, 'Entre na sua conta.');
    if (method === 'GET' && pathname === '/api/accounts/me') return send(200, account);
    if (method === 'GET' && pathname === '/api/accounts') return send(200, {users: listAccounts.all(account.id)});

    const match = pathname.match(/^\/api\/messages\/([1-9]\d*)$/);
    if (!match || !['GET', 'POST'].includes(method)) return error(404, 'Rota indisponível.');
    const contactId = Number(match[1]);
    if (!Number.isSafeInteger(contactId) || contactId === account.id || !findContact.get(contactId)) {
      return error(404, 'Destinatário indisponível.');
    }

    if (method === 'POST') {
      const data = await readJson(request);
      const body = typeof data?.body === 'string' ? data.body.trim() : '';
      if (!body || body.length > 2000) return error(400, 'Escreva uma mensagem de 1 a 2000 caracteres.');
      return send(201, addMessage.get(account.id, contactId, body, new Date().toISOString()));
    }

    const cursor = searchParams.get('before');
    const before = cursor === null ? Number.MAX_SAFE_INTEGER : Number(cursor);
    if (!Number.isSafeInteger(before) || before < 1) return error(400, 'Informe um cursor válido.');
    const rows = listMessages.all(account.id, contactId, contactId, account.id, before);
    const messages = rows.slice(0, 50).reverse();
    return send(200, {messages, nextBefore: rows.length > 50 ? messages[0].id : null});
  }

  const addGeneral = db.prepare('INSERT INTO general_messages (author, body, created_at) VALUES (?, ?, ?)');
  const listGeneral = db.prepare('SELECT id, author, body, created_at AS createdAt FROM general_messages ORDER BY id DESC LIMIT 100');

  async function handleGeneral(request, response, session) {
    if (!session) return json(response, 401, {error: 'Entre para acessar o canal.'});
    if (request.method === 'GET') return json(response, 200, {messages: listGeneral.all().reverse()});
    if (request.method !== 'POST') return json(response, 405, {error: 'Método indisponível.'}, {Allow: 'GET, POST'});

    const data = await readJson(request);
    const body = typeof data?.body === 'string' ? data.body.trim() : '';
    if (!body || body.length > 1000) return json(response, 400, {error: 'Escreva uma mensagem de 1 a 1000 caracteres.'});
    addGeneral.run(session.name, body, new Date().toISOString());
    return json(response, 201, {messages: listGeneral.all().reverse()});
  }

  return {handle, handleGeneral, close: () => db.close()};
}
