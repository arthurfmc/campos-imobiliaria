// Fotos e documentos anexados (salvos numa subpasta do OneDrive).
import { app, avisar, helpers } from './comum.js';
import { prepararImagem, ehImagem, nomeArquivo } from '../util.js';

// Envia arquivos escolhidos pelo usuário para `pasta` e devolve os registros de anexo.
export async function enviarArquivos(arquivos, pasta, extra = {}) {
  const res = [];
  for (const arq of arquivos) {
    const { blob, largura, altura } = await prepararImagem(arq);
    let nome = nomeArquivo(arq.name);
    if (blob !== arq && !/\.jpe?g$/i.test(nome)) nome = nome.replace(/\.[^.]+$/, '') + '.jpg';
    const r = await app.storage.gravarArquivo(`${pasta}/${nome}`, blob);
    res.push({ id: r.id || null, nome: r.nome || nome, webUrl: r.webUrl, imagem: ehImagem(nome), largura, altura,
      tamanho: blob.size, criadoEm: new Date().toISOString(), criadoPor: app.usuario, ...extra, blob });
  }
  return res;
}

const Miniatura = {
  props: { anexo: Object },
  data() { return { url: null }; },
  async mounted() {
    if (this.anexo.id && app.storage.miniatura) this.url = await app.storage.miniatura(this.anexo.id);
  },
  template: `<a :href="anexo.webUrl" target="_blank" rel="noopener" class="miniatura" :title="anexo.nome">
    <img v-if="url" :src="url" :alt="anexo.descricao || anexo.nome" loading="lazy"><span v-else class="mini-ic">🖼</span>
    <small>{{ anexo.descricao || anexo.nome }}</small></a>`,
};

export const Anexos = {
  components: { Miniatura },
  props: { lista: Array, pasta: String, aceitar: { type: String, default: 'image/*,application/pdf,.doc,.docx,.xls,.xlsx' },
    rotulo: { type: String, default: '+ Adicionar fotos/documentos' }, categorias: Array },
  emits: ['adicionar', 'remover'],
  setup() { return helpers; },
  data() { return { enviando: 0, categoria: this.categorias?.[0] || '' }; },
  computed: {
    fotos() { return (this.lista || []).filter((a) => a.imagem); },
    docs() { return (this.lista || []).filter((a) => !a.imagem); },
  },
  methods: {
    async escolher(ev) {
      const arquivos = [...ev.target.files];
      ev.target.value = '';
      if (!arquivos.length) return;
      this.enviando = arquivos.length;
      try {
        const novos = await enviarArquivos(arquivos, this.pasta, this.categoria ? { categoria: this.categoria } : {});
        this.$emit('adicionar', novos.map(({ blob, ...a }) => a));
        avisar(`${novos.length} arquivo(s) enviado(s) para o OneDrive.`);
      } catch (e) {
        avisar('Erro ao enviar: ' + e.message, 'erro');
      }
      this.enviando = 0;
    },
    remover(a) {
      if (confirm(`Remover "${a.nome}" da lista? O arquivo continua guardado na pasta do OneDrive.`)) this.$emit('remover', a);
    },
  },
  template: `
  <div class="anexos">
    <div class="linha-botoes">
      <select v-if="categorias" v-model="categoria" aria-label="Tipo do anexo"><option v-for="c in categorias">{{ c }}</option></select>
      <label class="botao" :class="{ desativado: enviando }">
        <input type="file" multiple :accept="aceitar" @change="escolher" :disabled="!!enviando" hidden>
        {{ enviando ? 'Enviando ' + enviando + ' arquivo(s)…' : rotulo }}
      </label>
      <small>Fotos são reduzidas automaticamente antes do envio.</small>
    </div>
    <div v-if="fotos.length" class="galeria">
      <div v-for="a in fotos" :key="a.webUrl + a.nome" class="item-galeria">
        <Miniatura :anexo="a" />
        <button class="icone remover" @click="remover(a)" aria-label="Remover">✕</button>
      </div>
    </div>
    <ul v-if="docs.length" class="docs">
      <li v-for="a in docs" :key="a.webUrl + a.nome">
        <span><a :href="a.webUrl" target="_blank" rel="noopener">{{ a.nome }}</a> <small v-if="a.categoria" class="chip">{{ a.categoria }}</small></span>
        <span><small>{{ fmtData(a.criadoEm) }} · {{ a.criadoPor }}</small> <button class="pequeno perigo" @click="remover(a)">Remover</button></span>
      </li>
    </ul>
    <p v-if="!lista?.length" class="vazio">Nenhum arquivo anexado.</p>
  </div>`,
};
