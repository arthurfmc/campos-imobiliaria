// Servidor local de desenvolvimento.
//   node dev/servidor.mjs [porta] [pasta-que-simula-o-onedrive]
// - Serve os arquivos do sistema em http://localhost:8080
// - Em /mock-graph imita o Microsoft Graph usando uma pasta local (MOCK_ROOT) como "OneDrive",
//   para testar o sistema sem login: http://localhost:8080/?mock=Teste
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORTA = Number(process.argv[2]) || 8080;
const MOCK_ROOT = path.resolve(process.argv[3] || process.env.MOCK_ROOT || path.join(RAIZ, 'dev', 'mock-onedrive'));
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.md': 'text/plain; charset=utf-8' };

const idDe = (rel) => Buffer.from(rel || '/').toString('base64url');
const relDe = (id) => (Buffer.from(id, 'base64url').toString() === '/' ? '' : Buffer.from(id, 'base64url').toString());
const abs = (rel) => {
  const p = path.resolve(MOCK_ROOT, rel);
  if (!p.startsWith(MOCK_ROOT)) throw new Error('caminho inválido');
  return p;
};
const etagDe = (p) => `"${crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex')}"`;

function meta(rel) {
  const p = abs(rel);
  if (!fs.existsSync(p)) return null;
  const st = fs.statSync(p);
  const m = { id: idDe(rel), name: path.basename(p), webUrl: `http://localhost:${PORTA}/mock-download/${idDe(rel)}`,
    parentReference: { driveId: 'd1' } };
  if (st.isDirectory()) m.folder = { childCount: fs.readdirSync(p).length };
  else Object.assign(m, { file: {}, size: st.size, eTag: etagDe(p), '@microsoft.graph.downloadUrl': `http://localhost:${PORTA}/mock-download/${idDe(rel)}` });
  return m;
}

const json = (res, status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const corpo = (req) => new Promise((ok) => { const b = []; req.on('data', (c) => b.push(c)); req.on('end', () => ok(Buffer.concat(b))); });

async function graph(req, res, url) {
  const p = decodeURIComponent(url.pathname.replace(/^\/mock-graph/, ''));
  let m;
  if (req.method === 'GET' && p === '/me/drive/sharedWithMe') return json(res, 200, { value: [] });
  if (req.method === 'GET' && (m = p.match(/^\/me\/drive\/root:\/(.+)$/))) {
    const it = meta(m[1]);
    return it ? json(res, 200, it) : json(res, 404, { error: { message: 'itemNotFound' } });
  }
  if (req.method === 'GET' && (m = p.match(/^\/drives\/d1\/items\/([^/:]+)\/thumbnails$/))) {
    const rel = relDe(m[1]);
    return json(res, 200, { value: /\.(jpe?g|png)$/i.test(rel) ? [{ medium: { url: `http://localhost:${PORTA}/mock-download/${m[1]}` } }] : [] });
  }
  if (req.method === 'PATCH' && (m = p.match(/^\/drives\/d1\/items\/([^/:]+)$/))) {
    const origem = relDe(m[1]);
    const dados = JSON.parse((await corpo(req)).toString());
    const destDir = relDe(dados.parentReference.id);
    let final = path.posix.join(destDir, path.posix.basename(origem));
    const ext = path.extname(final); const base = final.slice(0, -ext.length || undefined);
    for (let i = 1; fs.existsSync(abs(final)); i++) final = `${base} ${i}${ext}`;
    fs.renameSync(abs(origem), abs(final));
    console.log(`  movido: ${origem} -> ${final}`);
    return json(res, 200, meta(final));
  }
  // /drives/d1/items/{id}[:/{rel}:][/content|/children|/createUploadSession]
  m = p.match(/^\/drives\/d1\/items\/([^/:]+)(?::\/(.+?):)?(\/content|\/children|\/createUploadSession)?$/);
  if (!m) return json(res, 400, { error: { message: `rota não simulada: ${req.method} ${p}` } });
  const rel = path.posix.join(relDe(m[1]), m[2] || '');
  const acao = m[3];

  if (req.method === 'GET' && !acao) {
    const it = meta(rel);
    return it ? json(res, 200, it) : json(res, 404, { error: { message: 'itemNotFound' } });
  }
  if (req.method === 'GET' && acao === '/children') {
    const p = abs(rel);
    if (!fs.existsSync(p)) return json(res, 404, { error: { message: 'itemNotFound' } });
    return json(res, 200, { value: fs.readdirSync(p).map((n) => meta(path.posix.join(rel, n))) });
  }
  if (req.method === 'POST' && acao === '/createUploadSession') {
    let final = rel;
    const ext = path.extname(rel); const base = rel.slice(0, -ext.length || undefined);
    for (let i = 1; fs.existsSync(abs(final)); i++) final = `${base} ${i}${ext}`;
    fs.writeFileSync(abs(final), Buffer.alloc(0));
    return json(res, 200, { uploadUrl: `http://localhost:${PORTA}/mock-upload/${idDe(final)}` });
  }
  if (req.method === 'POST' && acao === '/children') {
    const dados = JSON.parse((await corpo(req)).toString());
    const novo = path.posix.join(rel, dados.name);
    if (fs.existsSync(abs(novo))) return json(res, 409, { error: { message: 'nameAlreadyExists' } });
    fs.mkdirSync(abs(novo), { recursive: true });
    return json(res, 201, meta(novo));
  }
  if (req.method === 'PUT' && acao === '/content') {
    const conteudo = await corpo(req);
    const alvo = abs(rel);
    const existe = fs.existsSync(alvo);
    const ifMatch = req.headers['if-match'];
    const comportamento = url.searchParams.get('@microsoft.graph.conflictBehavior') || 'replace';
    if (ifMatch && (!existe || etagDe(alvo) !== ifMatch)) return json(res, 412, { error: { message: 'preconditionFailed' } });
    let final = rel;
    if (existe && !ifMatch && comportamento === 'fail') return json(res, 409, { error: { message: 'nameAlreadyExists' } });
    if (existe && !ifMatch && comportamento === 'rename') {
      const ext = path.extname(rel); const base = rel.slice(0, -ext.length || undefined);
      for (let i = 1; fs.existsSync(abs(final)); i++) final = `${base} ${i}${ext}`;
    }
    if (!fs.existsSync(path.dirname(abs(final)))) return json(res, 404, { error: { message: 'parent not found' } });
    fs.writeFileSync(abs(final), conteudo);
    console.log(`  gravado: ${final} (${conteudo.length} bytes)`);
    return json(res, existe ? 200 : 201, meta(final));
  }
  return json(res, 400, { error: { message: `rota não simulada: ${req.method} ${p}` } });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORTA}`);
  try {
    if (url.pathname.startsWith('/mock-graph/')) {
      if (req.headers.authorization !== 'Bearer mock') return json(res, 401, { error: { message: 'sem token' } });
      return await graph(req, res, url);
    }
    if (url.pathname.startsWith('/mock-upload/')) {
      const rel = relDe(url.pathname.split('/').pop());
      const parte = await corpo(req);
      fs.appendFileSync(abs(rel), parte);
      const [, , fim, total] = req.headers['content-range'].match(/bytes (\d+)-(\d+)\/(\d+)/);
      const pronto = Number(fim) + 1 === Number(total);
      res.writeHead(pronto ? 201 : 202, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify(pronto ? meta(rel) : { nextExpectedRanges: [`${Number(fim) + 1}-`] }));
    }
    if (url.pathname.startsWith('/mock-download/')) {
      const p = abs(relDe(url.pathname.split('/').pop()));
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
      return res.end(fs.readFileSync(p));
    }
    let arq = path.join(RAIZ, decodeURIComponent(url.pathname));
    if (!arq.startsWith(RAIZ)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(arq) && fs.statSync(arq).isDirectory()) arq = path.join(arq, 'index.html');
    if (!fs.existsSync(arq)) { res.writeHead(404); return res.end('não encontrado'); }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arq)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(fs.readFileSync(arq));
  } catch (e) {
    json(res, 500, { error: { message: e.message } });
  }
}).listen(PORTA, () => {
  console.log(`Sistema em http://localhost:${PORTA}/`);
  console.log(`Demonstração: http://localhost:${PORTA}/?demo`);
  console.log(`OneDrive simulado (${MOCK_ROOT}): http://localhost:${PORTA}/?mock=Teste`);
});
