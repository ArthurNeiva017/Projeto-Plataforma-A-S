import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createMessaging} from './messaging.mjs';

const assets = new Map([
  ['/', ['index.html', 'text/html']],
  ['/index.html', ['index.html', 'text/html']],
  ['/style.css', ['style.css', 'text/css']],
  ['/app.js', ['app.js', 'text/javascript']],
]);
const sessions = new Map();
const sessionLifetime = 60_000;

function json(response, status, body, headers = {}) {
  response.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers});
  response.end(JSON.stringify(body));
}

async function readName(request) {
  if (request.headers['content-type'] !== 'application/json') return '';
  let body = '';
  for await (const chunk of request.setEncoding('utf8')) {
    body += chunk;
    if (body.length > 1024) return '';
  }
  try {
    const {name} = JSON.parse(body);
    if (typeof name === 'string' && name.trim().length <= 32) return name.trim();
  } catch {}
  return '';
}

export function createAppServer({dbPath = process.env.PONTO_DB_PATH || 'ponto.sqlite'} = {}) {
  const messaging = createMessaging(dbPath, json);
  const server = createServer(async (request, response) => {
    const url = new URL('http://localhost' + request.url);
    const path = url.pathname;
    if (path === '/api/accounts' || path.startsWith('/api/accounts/') || path === '/api/messages' || path.startsWith('/api/messages/')) {
      try {
        return await messaging.handle(request, response, url);
      } catch (error) {
        console.error(error);
        return json(response, 500, {error: 'Erro interno do servidor.'});
      }
    }
    const {method} = request;
    const cookie = request.headers.cookie?.match(/(?:^|;\s*)ponto_session=([a-f0-9-]+)/)?.[1];
    const now = Date.now();

    if (path.startsWith('/api/')) {
      for (const [id, session] of sessions) {
        if (now - session.lastSeen > sessionLifetime) sessions.delete(id);
      }
      if (path === '/api/channels/geral/messages') {
        try {
          return await messaging.handleGeneral(request, response, sessions.get(cookie));
        } catch (error) {
          console.error(error);
          return json(response, 500, {error: 'Erro interno do servidor.'});
        }
      }
      if (method === 'POST' && path === '/api/login') {
        const name = await readName(request);
        if (!name) return json(response, 400, {error: 'Informe um nome de teste com até 32 caracteres.'});
        if ([...sessions].some(([id, session]) => id !== cookie && session.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'))) {
          return json(response, 409, {error: 'Esse nome já está online. Escolha outro.'});
        }
        sessions.delete(cookie);
        const id = randomUUID();
        sessions.set(id, {name, lastSeen: Date.now()});
        return json(response, 200, {name}, {'Set-Cookie': `ponto_session=${id}; HttpOnly; SameSite=Strict; Path=/`});
      }
      if (method === 'POST' && path === '/api/logout') {
        sessions.delete(cookie);
        return json(response, 200, {}, {'Set-Cookie': 'ponto_session=; Max-Age=0; HttpOnly; SameSite=Strict; Path=/'});
      }
      if (method === 'GET' && path === '/api/presence') {
        const current = sessions.get(cookie);
        if (!current) return json(response, 401, {error: 'Entre para ver quem está online.'});
        current.lastSeen = now;
        const online = [...sessions].filter(([id]) => id !== cookie).map(([, session]) => session.name);
        return json(response, 200, {name: current.name, online});
      }
      return json(response, 404, {error: 'Rota indisponível.'});
    }

    const asset = assets.get(path);
    if (!asset || !['GET', 'HEAD'].includes(method)) return response.writeHead(404).end();
    try {
      const body = await readFile(new URL(asset[0], import.meta.url));
      response.writeHead(200, {'Content-Type': asset[1] + '; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
      response.end(method === 'HEAD' ? undefined : body);
    } catch {
      response.writeHead(500).end();
    }
  });
  server.on('close', messaging.close);
  return server;
}
