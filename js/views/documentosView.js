// Tela "Documentos": geração de contratos e laudos e gestão dos modelos editáveis no Word.
import { app, db, helpers, avisar } from './comum.js';
import { gerarContratoDocx, gerarLaudoEmBrancoDocx, criarModeloWord, caminhoModelo } from './acoes.js';
import { VistoriaModal, AMB_COMERCIAL, AMB_RESIDENCIAL } from './vistoria.js';
import { MODELOS, CAMPOS_AJUDA } from '../modelos.js';
import * as D from '../db.js';
import { OrganizarPastas } from './pastas.js';

const TIPOS_DOC = [
  ['contrato', 'Contrato de locação (.docx)'],
  ['vistoria_entrada', 'Laudo de vistoria de entrada (preencher no sistema)'],
  ['vistoria_saida', 'Laudo de vistoria de saída / encerramento (preencher no sistema)'],
  ['branco_entrada', 'Laudo de vistoria de entrada — em branco, para preencher à mão'],
  ['branco_saida', 'Laudo de vistoria de saída — em branco, para preencher à mão'],
];

export const Documentos = {
  components: { VistoriaModal, OrganizarPastas },
  props: { query: Object },
  setup() { return { app, ...helpers, TIPOS_DOC, MODELOS, CAMPOS_AJUDA }; },
  data() {
    return { contratoId: this.query?.contrato || '', tipo: this.query?.tipo || 'contrato', ocupado: false,
      vistoriaTipo: null, info: {}, carregandoInfo: true, ajuda: '' };
  },
  computed: {
    db,
    contratos() {
      return this.db.contratos
        .map((c) => ({ c, inq: D.porId(this.db.inquilinos, c.inquilinoId), im: D.porId(this.db.imoveis, c.imovelId) }))
        .sort((a, b) => (a.c.status === b.c.status ? (a.im?.ref || 0) - (b.im?.ref || 0) : a.c.status === 'ativo' ? -1 : 1));
    },
    contrato() { return D.porId(this.db.contratos, this.contratoId); },
  },
  mounted() { this.carregarInfo(); },
  methods: {
    async carregarInfo() {
      this.carregandoInfo = true;
      const info = {};
      for (const k of Object.keys(MODELOS)) {
        try { info[k] = await app.storage.infoArquivo?.(caminhoModelo(k)); } catch { info[k] = null; }
      }
      this.info = info;
      this.carregandoInfo = false;
    },
    async gerar() {
      const c = this.contrato;
      if (!c) { avisar('Escolha o contrato.', 'erro'); return; }
      if (this.tipo === 'vistoria_entrada' || this.tipo === 'vistoria_saida') {
        this.vistoriaTipo = this.tipo === 'vistoria_saida' ? 'saida' : 'entrada';
        return;
      }
      this.ocupado = true;
      try {
        if (this.tipo === 'contrato') await gerarContratoDocx(c.id);
        else {
          const tipo = this.tipo === 'branco_saida' ? 'saida' : 'entrada';
          await gerarLaudoEmBrancoDocx(c, tipo, c.finalidade === 'residencial' ? AMB_RESIDENCIAL : AMB_COMERCIAL);
        }
      } catch (e) { avisar('Erro ao gerar: ' + e.message, 'erro'); }
      this.ocupado = false;
    },
    async criar(k, restaurar) {
      if (restaurar && !confirm(`Substituir o modelo "${MODELOS[k].arquivo}" pelo texto padrão do sistema? As suas alterações nesse arquivo serão perdidas.`)) return;
      this.ocupado = true;
      try {
        const r = await criarModeloWord(k);
        avisar(`Modelo salvo em ${caminhoModelo(k)}. Abra no Word, edite e salve.`);
        await this.carregarInfo();
        if (r.webUrl && !restaurar) window.open(r.webUrl, '_blank', 'noopener');
      } catch (e) { avisar('Erro: ' + e.message, 'erro'); }
      this.ocupado = false;
    },
  },
  template: `
  <section>
    <div class="titulo-pagina"><h1>Documentos</h1></div>

    <div class="cartao">
      <h2>Gerar documento</h2>
      <div class="form-grid">
        <label class="c3">Contrato<select v-model="contratoId"><option value="">Escolha…</option>
          <option v-for="x in contratos" :value="x.c.id">{{ x.c.status === 'ativo' ? '' : '[encerrado] ' }}Ref. {{ x.im?.ref }} · {{ x.inq?.nome }}{{ x.c.unidade ? ' · ' + x.c.unidade : '' }}</option></select></label>
        <label class="c3">Documento<select v-model="tipo"><option v-for="[k, rot] in TIPOS_DOC" :value="k">{{ rot }}</option></select></label>
      </div>
      <div class="linha-botoes" style="margin-top:12px">
        <button class="primario" @click="gerar" :disabled="ocupado || !contratoId">{{ ocupado ? 'Gerando…' : 'Gerar' }}</button>
        <a v-if="contrato" :href="'#/contrato/' + contrato.id">Abrir o contrato →</a>
      </div>
      <p class="dica">Os arquivos são salvos no OneDrive (contratos em <code>contratos/Vigentes</code>, laudos em <code>laudos</code>) e baixados no computador. Depois de gerado, o .docx pode ser editado livremente no Word. Para mudar os dados do contrato (fiadores, garantia, valores), edite o contrato e gere de novo.</p>
    </div>

    <OrganizarPastas v-if="app.modo === 'onedrive'" />

    <div class="cartao">
      <h2>Modelos editáveis no Word</h2>
      <p class="dica" style="margin-top:0">Crie o modelo no OneDrive, abra no Word e altere o texto como quiser: cláusulas, formatação, logotipo… Mantenha os campos entre chaves, como <code>{locatario_nome}</code>, porque o sistema troca cada um pelo dado do contrato. Se o modelo existir na pasta <code>modelos</code>, ele é usado. Se não existir, o sistema usa o texto padrão.</p>
      <table class="tabela">
        <thead><tr><th>Modelo</th><th>Situação</th><th></th></tr></thead>
        <tbody><tr v-for="(m, k) in MODELOS" :key="k">
          <td>{{ m.nome }}<br><small><code>modelos/{{ m.arquivo }}</code></small></td>
          <td><small v-if="carregandoInfo">verificando…</small>
            <template v-else-if="info[k]"><span class="chip chip-ativo">Modelo próprio em uso</span><br>
              <small>alterado em {{ fmtData(info[k].modificadoEm) }}{{ info[k].modificadoPor ? ' por ' + info[k].modificadoPor : '' }}</small></template>
            <span v-else class="chip">Texto padrão do sistema</span></td>
          <td class="acoes-linha">
            <template v-if="info[k]">
              <a v-if="info[k].webUrl" class="botao pequeno" :href="info[k].webUrl" target="_blank" rel="noopener">Abrir no Word</a>
              <button class="pequeno" @click="criar(k, true)" :disabled="ocupado">Restaurar padrão</button>
            </template>
            <button v-else class="pequeno primario" @click="criar(k, false)" :disabled="ocupado">Criar modelo para editar</button>
            <button class="pequeno" @click="ajuda = ajuda === k ? '' : k">Campos</button>
          </td>
        </tr></tbody>
      </table>
      <div v-if="ajuda" class="sub-bloco">
        <h3>Campos disponíveis — {{ MODELOS[ajuda].nome }}</h3>
        <table class="tabela compacta">
          <tbody><tr v-for="[campo, desc] in CAMPOS_AJUDA[ajuda === 'contrato' ? 'contrato' : 'vistoria']" :key="campo"><td><code>{{ campo }}</code></td><td>{{ desc }}</td></tr></tbody>
        </table>
        <p class="dica">Trechos entre <code>{#campo}</code> e <code>{/campo}</code> só aparecem quando o campo existe, ou se repetem para cada item (assinaturas, linhas da tabela). Não apague essas marcas. As fotos da vistoria entram como imagens só no texto padrão. No modelo próprio, entra a lista das fotos.</p>
      </div>
    </div>

    <VistoriaModal v-if="vistoriaTipo && contrato" :contrato="contrato" :tipo-inicial="vistoriaTipo" @fechar="vistoriaTipo = null" />
  </section>`,
};
