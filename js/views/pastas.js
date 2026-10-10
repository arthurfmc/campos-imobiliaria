// Organização das pastas de contratos no OneDrive: Vigentes <-> Encerrados.
import { app, db, helpers, Modal, avisar, CONFIG } from './comum.js';
import * as D from '../db.js';

const sem = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Chave de busca: as duas primeiras palavras do nome do inquilino (ex.: "raquel pedruzzi").
export function chaveInquilino(d, c) {
  const nome = D.porId(d.inquilinos, c.inquilinoId)?.nome || '';
  return sem(nome.replace(/\(.*?\)/g, '')).split(/\s+/).filter(Boolean).slice(0, 2).join(' ');
}

export const pastaDestino = (status) => (status === 'encerrado' ? CONFIG.pastaEncerrados : CONFIG.pastaContratos);
const pastaOposta = (status) => (status === 'encerrado' ? CONFIG.pastaContratos : CONFIG.pastaEncerrados);

// Arquivos de um contrato que estão na pasta errada para o status atual.
export async function arquivosForaDoLugar(c) {
  const d = db();
  const chave = chaveInquilino(d, c);
  if (!chave) return [];
  const origem = pastaOposta(c.status);
  const itens = await app.storage.listarPasta(origem);
  return itens.filter((it) => sem(it.nome).includes(chave)).map((it) => ({ ...it, origem, destino: pastaDestino(c.status), contratoId: c.id, marcado: true }));
}

// Varre as duas pastas e propõe o que mover, conforme o status dos contratos.
export async function verificarPastas() {
  const d = db();
  const contratos = d.contratos.filter((c) => c.status !== 'cancelado').map((c) => ({ c, chave: chaveInquilino(d, c) })).filter((x) => x.chave);
  const propostas = [];
  for (const [origem, statusEsperado] of [[CONFIG.pastaContratos, 'encerrado'], [CONFIG.pastaEncerrados, 'ativo']]) {
    const itens = await app.storage.listarPasta(origem);
    for (const it of itens) {
      const donos = contratos.filter((x) => sem(it.nome).includes(x.chave));
      if (!donos.length || !donos.every((x) => x.c.status === statusEsperado)) continue;
      const c = donos[0].c;
      propostas.push({ ...it, origem, destino: pastaDestino(c.status), contratoId: c.id, marcado: true });
    }
  }
  return propostas;
}

// Move os itens e atualiza as referências guardadas nos contratos.
export async function moverItens(itens) {
  const movidos = [];
  for (const it of itens) {
    try {
      const r = await app.storage.mover(`${it.origem}/${it.nome}`, it.destino);
      movidos.push({ ...it, novoNome: r.nome || it.nome, novaUrl: r.webUrl });
    } catch (e) {
      avisar(`Não foi possível mover "${it.nome}": ${e.message}`, 'erro');
    }
  }
  if (!movidos.length) return 0;
  const barra = (p) => p.replace(/\//g, '\\');
  app.store.commit(`Pastas atualizadas: ${movidos.length} item(ns) movido(s)`, (d) => {
    for (const m of movidos) {
      const c = D.porId(d.contratos, m.contratoId);
      if (!c) continue;
      for (const doc of c.documentos || []) {
        if (doc.pasta === m.origem && doc.nome === m.nome) Object.assign(doc, { pasta: m.destino, nome: m.novoNome, ...(m.novaUrl ? { webUrl: m.novaUrl } : {}) });
      }
      if (c.observacoes) c.observacoes = c.observacoes.split(`${barra(m.origem)}\\${m.nome}`).join(`${barra(m.destino)}\\${m.novoNome}`);
    }
  });
  return movidos.length;
}

export const MoverArquivosModal = {
  components: { Modal },
  props: { contrato: Object },
  emits: ['fechar'],
  setup() { return helpers; },
  data() { return { itens: null, erro: '', movendo: false }; },
  computed: {
    destino() { return pastaDestino(this.contrato.status); },
    marcados() { return (this.itens || []).filter((x) => x.marcado); },
  },
  async created() {
    try { this.itens = await arquivosForaDoLugar(this.contrato); } catch (e) { this.erro = e.message; this.itens = []; }
  },
  methods: {
    async mover() {
      this.movendo = true;
      const n = await moverItens(this.marcados);
      this.movendo = false;
      if (n) avisar(`${n} item(ns) movido(s) para ${this.destino}.`);
      this.$emit('fechar');
    },
  },
  template: `
  <Modal titulo="Atualizar pastas do contrato" @fechar="$emit('fechar')">
    <p>O contrato está <b>{{ contrato.status === 'encerrado' ? 'encerrado' : 'vigente' }}</b>. Estes arquivos estão em outra pasta e podem ir para <code>{{ destino }}</code>:</p>
    <p v-if="itens === null" class="vazio">Procurando arquivos no OneDrive…</p>
    <p v-else-if="erro" class="erro-campo">{{ erro }}</p>
    <p v-else-if="!itens.length" class="vazio">Nenhum arquivo deste contrato fora do lugar. As pastas já estão organizadas.</p>
    <ul v-else class="lista-mover">
      <li v-for="it in itens" :key="it.id"><label class="check"><input type="checkbox" v-model="it.marcado">
        {{ it.pasta ? '📁' : '📄' }} {{ it.nome }}</label></li>
    </ul>
    <p class="dica">Os arquivos são encontrados pelo nome do inquilino. Desmarque o que não for deste contrato.</p>
    <template #rodape>
      <button @click="$emit('fechar')">{{ itens?.length ? 'Agora não' : 'Fechar' }}</button>
      <button v-if="itens?.length" class="primario" :disabled="!marcados.length || movendo" @click="mover">{{ movendo ? 'Movendo…' : 'Mover ' + marcados.length + ' item(ns)' }}</button>
    </template>
  </Modal>`,
};

// Cartão da tela Documentos: verifica todas as pastas de uma vez.
export const OrganizarPastas = {
  setup() { return helpers; },
  data() { return { propostas: null, verificando: false, movendo: false }; },
  computed: {
    db,
    marcados() { return (this.propostas || []).filter((x) => x.marcado); },
  },
  methods: {
    nomeContrato(id) {
      const c = D.porId(this.db.contratos, id);
      return `${D.porId(this.db.inquilinos, c?.inquilinoId)?.nome || ''} (${c?.status === 'encerrado' ? 'encerrado' : 'vigente'})`;
    },
    async verificar() {
      this.verificando = true;
      try { this.propostas = await verificarPastas(); } catch (e) { avisar('Erro ao verificar: ' + e.message, 'erro'); }
      this.verificando = false;
    },
    async mover() {
      this.movendo = true;
      const n = await moverItens(this.marcados);
      this.movendo = false;
      if (n) avisar(`${n} item(ns) movido(s).`);
      await this.verificar();
    },
  },
  template: `
  <div class="cartao">
    <div class="cab-cartao"><h2>Organizar pastas de contratos</h2>
      <button class="pequeno" @click="verificar" :disabled="verificando">{{ verificando ? 'Verificando…' : 'Atualizar pastas' }}</button></div>
    <p class="dica" style="margin-top:0">Confere se os arquivos de contratos encerrados ainda estão em <code>contratos/Vigentes</code> (e vice-versa) e propõe movê-los.</p>
    <template v-if="propostas">
      <p v-if="!propostas.length" class="vazio">Tudo em ordem: cada arquivo está na pasta certa.</p>
      <template v-else>
        <table class="tabela compacta">
          <thead><tr><th></th><th>Arquivo</th><th>Contrato</th><th>De → Para</th></tr></thead>
          <tbody><tr v-for="p in propostas" :key="p.id">
            <td><input type="checkbox" v-model="p.marcado" aria-label="Mover"></td>
            <td>{{ p.pasta ? '📁' : '📄' }} {{ p.nome }}</td><td>{{ nomeContrato(p.contratoId) }}</td>
            <td><small>{{ p.origem }} → {{ p.destino }}</small></td></tr></tbody>
        </table>
        <div class="linha-botoes" style="margin-top:10px"><button class="primario" :disabled="!marcados.length || movendo" @click="mover">{{ movendo ? 'Movendo…' : 'Mover ' + marcados.length + ' item(ns)' }}</button></div>
      </template>
    </template>
  </div>`,
};
