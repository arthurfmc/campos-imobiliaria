// Armazenamento: pasta do OneDrive via Microsoft Graph (uso real) ou memória (demonstração).
// Interface comum:
//   conectar() -> { nome, webUrl }
//   lerJson(rel) -> { data, etag } | null
//   gravarJson(rel, data, etag|null) -> etag      (lança ConflitoError se outro usuário salvou antes)
//   gravarArquivo(rel, blob, sobrescrever) -> { webUrl, nome }

export class ConflitoError extends Error {
  constructor() { super('O arquivo foi alterado por outra pessoa'); this.conflito = true; }
}

export class PastaNaoEncontradaError extends Error {
  constructor(msg) { super(msg); this.pastaNaoEncontrada = true; }
}

const caminho = (rel) => rel.split('/').map(encodeURIComponent).join('/');

export class GraphStorage {
  constructor({ getToken, pastaPadrao, chaveLocal, graphBase = 'https://graph.microsoft.com/v1.0' }) {
    this.getToken = getToken;
    this.pastaPadrao = pastaPadrao;          // ex.: 'Campos_Patrimonial/Imobiliaria'
    this.chaveLocal = chaveLocal;            // chave no localStorage para lembrar a pasta
    this.base = graphBase;
    this.pasta = null;                       // { driveId, id, nome, webUrl }
    this.pastasCriadas = new Set();
  }

  async req(metodo, url, { corpo, headers = {}, aceitar = [] } = {}) {
    const token = await this.getToken();
    const r = await fetch(url.startsWith('http') ? url : this.base + url, {
      method: metodo,
      headers: { Authorization: `Bearer ${token}`, ...headers },
      body: corpo,
    });
    if (r.ok || aceitar.includes(r.status)) return r;
    let detalhe = '';
    try { detalhe = (await r.json()).error?.message || ''; } catch { /* sem corpo */ }
    const e = new Error(`OneDrive: ${r.status} ${detalhe}`);
    e.status = r.status;
    throw e;
  }

  async getJson(url) {
    const r = await this.req('GET', url, { aceitar: [404] });
    return r.status === 404 ? null : r.json();
  }

  // Normaliza um driveItem (inclusive atalhos/pastas compartilhadas) para { driveId, id }
  static alvo(item) {
    if (item.remoteItem) {
      return { driveId: item.remoteItem.parentReference.driveId, id: item.remoteItem.id,
        nome: item.remoteItem.name || item.name, webUrl: item.remoteItem.webUrl || item.webUrl };
    }
    return { driveId: item.parentReference.driveId, id: item.id, nome: item.name, webUrl: item.webUrl };
  }

  async conectar() {
    const salvo = localStorage.getItem(this.chaveLocal);
    if (salvo) {
      try {
        const p = JSON.parse(salvo);
        const item = await this.getJson(`/drives/${p.driveId}/items/${p.id}`);
        if (item) return this.usar(GraphStorage.alvo(item));
      } catch { /* tenta descobrir de novo */ }
    }

    // 1) Pasta no próprio OneDrive (dono) ou atalho adicionado em "Meus arquivos"
    const partes = this.pastaPadrao.split('/');
    for (let i = 0; i < partes.length; i++) {
      const rel = partes.slice(i).join('/');
      const item = await this.getJson(`/me/drive/root:/${caminho(rel)}`);
      if (item) return this.usar(GraphStorage.alvo(item));
    }

    // 2) Pastas compartilhadas comigo
    try {
      const comp = await this.getJson('/me/drive/sharedWithMe');
      for (const nome of [...partes].reverse()) {
        const it = comp?.value?.find((v) => (v.remoteItem?.name || v.name) === nome && (v.remoteItem?.folder || v.folder));
        if (!it) continue;
        let alvo = GraphStorage.alvo(it);
        const resto = partes.slice(partes.indexOf(nome) + 1).join('/');
        if (resto) {
          const sub = await this.getJson(`/drives/${alvo.driveId}/items/${alvo.id}:/${caminho(resto)}`);
          if (!sub) continue;
          alvo = GraphStorage.alvo(sub);
        }
        return this.usar(alvo);
      }
    } catch { /* API pode não estar disponível para a conta */ }

    throw new PastaNaoEncontradaError(
      `Não encontrei a pasta "${this.pastaPadrao}" no seu OneDrive nem entre as pastas compartilhadas com você.`);
  }

  // Conecta usando o link de compartilhamento da pasta (copiado do OneDrive).
  async conectarPorLink(link) {
    const b64 = btoa(unescape(encodeURIComponent(link.trim())))
      .replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
    const item = await this.getJson(`/shares/u!${b64}/driveItem`);
    if (!item) throw new PastaNaoEncontradaError('Link não encontrado ou sem permissão.');
    return this.usar(GraphStorage.alvo(item));
  }

  usar(alvo) {
    this.pasta = alvo;
    localStorage.setItem(this.chaveLocal, JSON.stringify(alvo));
    return { nome: alvo.nome, webUrl: alvo.webUrl };
  }

  item(rel) {
    return `/drives/${this.pasta.driveId}/items/${this.pasta.id}:/${caminho(rel)}:`;
  }

  async garantirPasta(relDir) {
    if (!relDir || this.pastasCriadas.has(relDir)) return;
    const partes = relDir.split('/');
    for (let i = 0; i < partes.length; i++) {
      const atual = partes.slice(0, i + 1).join('/');
      if (this.pastasCriadas.has(atual)) continue;
      const existe = await this.getJson(this.item(atual));
      if (!existe) {
        const pai = i === 0
          ? `/drives/${this.pasta.driveId}/items/${this.pasta.id}/children`
          : `${this.item(partes.slice(0, i).join('/'))}/children`;
        await this.req('POST', pai, {
          corpo: JSON.stringify({ name: partes[i], folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }),
          headers: { 'Content-Type': 'application/json' },
          aceitar: [409],
        });
      }
      this.pastasCriadas.add(atual);
    }
  }

  async lerJson(rel) {
    const meta = await this.getJson(this.item(rel));
    if (!meta) return null;
    const r = await fetch(meta['@microsoft.graph.downloadUrl'], { cache: 'no-store' });
    if (!r.ok) throw new Error(`OneDrive: falha ao baixar ${rel} (${r.status})`);
    return { data: await r.json(), etag: meta.eTag };
  }

  async gravarJson(rel, data, etag) {
    const dir = rel.split('/').slice(0, -1).join('/');
    await this.garantirPasta(dir);
    const headers = { 'Content-Type': 'application/json' };
    let url = `${this.item(rel)}/content`;
    if (etag) headers['If-Match'] = etag;
    else url += '?@microsoft.graph.conflictBehavior=fail';
    const r = await this.req('PUT', url, {
      corpo: JSON.stringify(data, null, 1), headers, aceitar: [409, 412],
    });
    if (r.status === 409 || r.status === 412) throw new ConflitoError();
    return (await r.json()).eTag;
  }

  async gravarArquivo(rel, blob, sobrescrever = false) {
    const dir = rel.split('/').slice(0, -1).join('/');
    await this.garantirPasta(dir);
    const comportamento = sobrescrever ? 'replace' : 'rename';
    let item;
    if (blob.size > 4 * 1024 * 1024) {
      item = await this.enviarGrande(rel, blob, comportamento);
    } else {
      const r = await this.req('PUT',
        `${this.item(rel)}/content?@microsoft.graph.conflictBehavior=${comportamento}`,
        { corpo: blob, headers: { 'Content-Type': blob.type || 'application/octet-stream' } });
      item = await r.json();
    }
    return { webUrl: item.webUrl, nome: item.name, id: item.id };
  }

  // Arquivos acima de 4 MB precisam de sessão de upload, enviada em partes.
  async enviarGrande(rel, blob, comportamento) {
    const r = await this.req('POST', `${this.item(rel)}/createUploadSession`, {
      corpo: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': comportamento } }),
      headers: { 'Content-Type': 'application/json' },
    });
    const { uploadUrl } = await r.json();
    const PARTE = 320 * 1024 * 16; // múltiplo de 320 KiB, exigido pelo OneDrive
    let resp;
    for (let ini = 0; ini < blob.size; ini += PARTE) {
      const fim = Math.min(ini + PARTE, blob.size);
      resp = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Range': `bytes ${ini}-${fim - 1}/${blob.size}` },
        body: blob.slice(ini, fim),
      });
      if (!resp.ok) throw new Error(`OneDrive: falha no envio (${resp.status})`);
    }
    return resp.json();
  }

  // Lê um arquivo pela posição na pasta (ex.: modelos/Modelo - ....docx). Retorna null se não existir.
  async lerArquivo(rel) {
    const meta = await this.getJson(this.item(rel));
    if (!meta) return null;
    const r = await fetch(meta['@microsoft.graph.downloadUrl'], { cache: 'no-store' });
    if (!r.ok) throw new Error(`OneDrive: falha ao baixar ${rel} (${r.status})`);
    return r.blob();
  }

  async infoArquivo(rel) {
    const meta = await this.getJson(this.item(rel));
    return meta ? { webUrl: meta.webUrl, modificadoEm: meta.lastModifiedDateTime, modificadoPor: meta.lastModifiedBy?.user?.displayName || '' } : null;
  }

  // Lista o conteúdo de uma subpasta: [{ nome, id, pasta, webUrl }]. Pasta inexistente = lista vazia.
  async listarPasta(rel) {
    const res = [];
    let url = `${this.item(rel)}/children?$select=id,name,folder,webUrl&$top=200`;
    while (url) {
      const r = await this.req('GET', url, { aceitar: [404] });
      if (r.status === 404) return [];
      const j = await r.json();
      for (const it of j.value || []) res.push({ nome: it.name, id: it.id, pasta: !!it.folder, webUrl: it.webUrl });
      url = j['@odata.nextLink'] || null;
    }
    return res;
  }

  // Move um arquivo ou pasta para outra subpasta (criando-a se preciso). Mantém o id do item.
  async mover(relOrigem, relPastaDestino) {
    const item = await this.getJson(this.item(relOrigem));
    if (!item) throw new Error(`Não encontrei "${relOrigem}" no OneDrive`);
    await this.garantirPasta(relPastaDestino);
    const destino = await this.getJson(this.item(relPastaDestino));
    const r = await this.req('PATCH', `/drives/${this.pasta.driveId}/items/${item.id}?@microsoft.graph.conflictBehavior=rename`, {
      corpo: JSON.stringify({ parentReference: { id: destino.id } }),
      headers: { 'Content-Type': 'application/json' },
    });
    const j = await r.json();
    return { nome: j.name, webUrl: j.webUrl, id: j.id };
  }

  // Baixa o conteúdo de um arquivo salvo (ex.: fotos para o termo de vistoria).
  async baixarArquivo(id) {
    const meta = await this.getJson(`/drives/${this.pasta.driveId}/items/${id}`);
    if (!meta) throw new Error('Arquivo não encontrado no OneDrive');
    const r = await fetch(meta['@microsoft.graph.downloadUrl']);
    if (!r.ok) throw new Error(`OneDrive: falha ao baixar (${r.status})`);
    return r.blob();
  }

  // URL temporária de miniatura de uma imagem salva no OneDrive.
  async miniatura(id) {
    try {
      const j = await this.getJson(`/drives/${this.pasta.driveId}/items/${id}/thumbnails`);
      return j?.value?.[0]?.medium?.url || null;
    } catch { return null; }
  }
}

// Armazenamento em memória (modo demonstração). Mantém semântica de eTag para testes.
export class MemoryStorage {
  constructor(arquivosIniciais = {}) {
    this.arquivos = new Map(Object.entries(arquivosIniciais).map(([k, v]) => [k, { data: v, etag: '1' }]));
    this.pasta = { nome: 'Demonstração (dados não são salvos)', webUrl: null };
  }
  async conectar() { return this.pasta; }
  async lerJson(rel) {
    const a = this.arquivos.get(rel);
    return a ? { data: JSON.parse(JSON.stringify(a.data)), etag: a.etag } : null;
  }
  async gravarJson(rel, data, etag) {
    const a = this.arquivos.get(rel);
    if ((a && a.etag !== etag) || (!a && etag)) throw new ConflitoError();
    const novo = String(Number(a?.etag || 0) + 1);
    this.arquivos.set(rel, { data: JSON.parse(JSON.stringify(data)), etag: novo });
    return novo;
  }
  async gravarArquivo(rel, blob) {
    const url = URL.createObjectURL(blob);
    this.urls ||= new Map();
    this.porCaminho ||= new Map();
    const id = `mem-${this.urls.size + 1}`;
    this.urls.set(id, url);
    this.porCaminho.set(rel, { blob, webUrl: url, modificadoEm: new Date().toISOString() });
    return { webUrl: url, nome: rel.split('/').pop(), id };
  }
  async lerArquivo(rel) { return this.porCaminho?.get(rel)?.blob || null; }
  async listarPasta(rel) {
    const res = new Map();
    for (const [caminho, a] of this.porCaminho || []) {
      if (!caminho.startsWith(rel + '/')) continue;
      const resto = caminho.slice(rel.length + 1);
      const nome = resto.split('/')[0];
      res.set(nome, { nome, id: nome, pasta: resto.includes('/'), webUrl: a.webUrl });
    }
    return [...res.values()];
  }
  async mover(relOrigem, relPastaDestino) {
    const nome = relOrigem.split('/').pop();
    for (const [caminho, a] of [...(this.porCaminho || [])]) {
      if (caminho === relOrigem || caminho.startsWith(relOrigem + '/')) {
        this.porCaminho.delete(caminho);
        this.porCaminho.set(relPastaDestino + '/' + nome + caminho.slice(relOrigem.length), a);
      }
    }
    return { nome, webUrl: null };
  }
  async infoArquivo(rel) { const a = this.porCaminho?.get(rel); return a ? { webUrl: a.webUrl, modificadoEm: a.modificadoEm, modificadoPor: '' } : null; }
  async miniatura(id) { return this.urls?.get(id) || null; }
  async baixarArquivo(id) { return (await fetch(this.urls.get(id))).blob(); }
}
