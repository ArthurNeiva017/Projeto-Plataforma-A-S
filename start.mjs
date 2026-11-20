import {createAppServer} from './server.mjs';

const host = process.env.PONTO_HOST || '0.0.0.0';
const port = Number(process.env.PONTO_PORT || 8080);
createAppServer().listen(port, host, () => console.log(`Ponto de Encontro em http://${host}:${port}`));
