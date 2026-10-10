// Estado global, componentes compartilhados e ações de documentos.
import * as U from '../util.js';
import * as D from '../db.js';
import { paraDocx, imprimir } from '../documentos.js';
import { CONFIG } from '../config.js';

const { reactive } = Vue;

export const app = reactive({
  store: null,        // Store (markRaw)
  storage: null,
  auth: null,
  usuario: '',
  pasta: null,        // { nome, webUrl }
  modo: '',           // 'onedrive' | 'demo'
  indices: null,
  indicesErro: '',
  toast: null,
});

export const db = () => app.store?.state.db;

export function avisar(texto, tipo = 'ok') {
  app.toast = { texto, tipo, id: Date.now() };
  const id = app.toast.id;
  setTimeout(() => { if (app.toast?.id === id) app.toast = null; }, tipo === 'erro' ? 8000 : 3500);
}

export const ir = (hash) => { location.hash = hash; };

// Disponibiliza utilitários nos templates.
export const helpers = {
  ...U,
  nomeImovel: D.nomeImovel,
  valorVigente: D.valorVigente,
  proximoReajuste: D.proximoReajuste,
  fimContrato: D.fimContrato,
  porId: D.porId,
  situacaoImovel: D.situacaoImovel,
  naoRecebido: D.naoRecebido,
  ir,
};

// Gera um .docx, salva no OneDrive (pasta indicada) e baixa no computador.
// `blocos` pode ser a lista de blocos ou um Blob já pronto (modelo do Word preenchido).
export async function gerarDocx(blocos, nome, subpasta) {
  const blob = blocos instanceof Blob ? blocos : await paraDocx(blocos);
  let webUrl = null;
  let nomeFinal = nome;
  if (app.modo === 'onedrive') {
    try {
      const r = await app.storage.gravarArquivo(`${subpasta}/${nome}`, blob);
      webUrl = r.webUrl;
      nomeFinal = r.nome;
    } catch (e) {
      avisar(`Documento baixado, mas não foi salvo no OneDrive: ${e.message}`, 'erro');
    }
  }
  U.baixarBlob(blob, nomeFinal);
  return { nome: nomeFinal, webUrl, pasta: subpasta, criadoEm: new Date().toISOString(), criadoPor: app.usuario };
}

export { imprimir, CONFIG };

export const Modal = {
  props: { titulo: String, largo: Boolean },
  emits: ['fechar'],
  template: `
  <div class="modal-fundo" @mousedown.self="$emit('fechar')">
    <div class="modal" :class="{ largo }" role="dialog" aria-modal="true">
      <header><h3>{{ titulo }}</h3><button class="icone" @click="$emit('fechar')" aria-label="Fechar">✕</button></header>
      <div class="modal-corpo"><slot /></div>
      <footer v-if="$slots.rodape"><slot name="rodape" /></footer>
    </div>
  </div>`,
};

export const Chip = {
  props: { status: String },
  computed: {
    rotulo() {
      return { pago: 'Pago', aberto: 'Em aberto', atrasado: 'Atrasado', parcial: 'Parcial', ativo: 'Ativo',
        encerrado: 'Encerrado', cancelado: 'Cancelado', Alugado: 'Alugado', Vago: 'Vago',
        'Uso próprio': 'Uso próprio', 'Indisponível': 'Indisponível' }[this.status] || this.status;
    },
  },
  template: `<span class="chip" :class="'chip-' + String(status).replace(/\\s|ó/g, '')">{{ rotulo }}</span>`,
};

export const Kpi = {
  props: { rotulo: String, valor: [String, Number], sub: String, tom: String },
  template: `<div class="kpi" :class="tom"><span class="kpi-rotulo">{{ rotulo }}</span><strong>{{ valor }}</strong><small v-if="sub">{{ sub }}</small></div>`,
};
