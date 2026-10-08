// Termo de vistoria (entrada/saída) e termo aditivo.
import { app, db, helpers, Modal, avisar } from './comum.js';
import { Anexos } from './anexos.js';
import { pastaDoContrato, gerarVistoriaDocx, gerarAditivoDocx } from './acoes.js';
import * as D from '../db.js';
import { clone, novoId, hojeISO, mesAtual, somaMesesData, diaMenos1, arred2 } from '../util.js';

const ESTADOS = ['Novo', 'Bom', 'Regular', 'Ruim', 'Não se aplica'];
const AMB_COMERCIAL = ['Fachada / porta de enrolar', 'Piso', 'Paredes e pintura', 'Teto / forro', 'Iluminação e tomadas',
  'Quadro de energia', 'Instalações hidráulicas', 'Banheiro', 'Portas e fechaduras', 'Vidros e janelas'];
const AMB_RESIDENCIAL = ['Sala', 'Cozinha', 'Quarto 1', 'Quarto 2', 'Banheiro social', 'Área de serviço', 'Iluminação e tomadas',
  'Instalações hidráulicas', 'Portas e fechaduras', 'Pintura geral'];

export const VistoriaModal = {
  components: { Modal, Anexos },
  props: { contrato: Object, vistoria: Object },
  emits: ['fechar'],
  setup() { return { ...helpers, ESTADOS }; },
  data() {
    if (this.vistoria) return { f: clone(this.vistoria), salvando: false };
    const c = this.contrato;
    const entrada = c.vistorias.filter((x) => x.tipo === 'entrada').sort((a, b) => b.data.localeCompare(a.data))[0];
    const tipo = entrada ? 'saida' : 'entrada';
    const base = entrada ? entrada.ambientes.map((a) => a.nome) : (c.finalidade === 'residencial' ? AMB_RESIDENCIAL : AMB_COMERCIAL);
    return {
      salvando: false,
      f: { id: novoId(), tipo, data: hojeISO(), vistoriador: app.usuario, leituraEnergia: '', leituraAgua: '', leituraGas: '', chaves: '',
        ambientes: base.map((nome) => ({ nome, estado: 'Bom', observacao: '' })), observacoes: '', fotos: [] },
    };
  },
  computed: {
    db,
    pasta() { return `${pastaDoContrato(this.contrato)}/Vistoria ${this.f.tipo === 'saida' ? 'saída' : 'entrada'} ${this.f.data}`; },
    entrada() { return this.contrato.vistorias.filter((x) => x.tipo === 'entrada' && x.id !== this.f.id).sort((a, b) => b.data.localeCompare(a.data))[0]; },
  },
  methods: {
    estadoEntrada(nome) { return this.entrada?.ambientes.find((a) => a.nome === nome)?.estado; },
    async salvar(gerar) {
      const f = clone(this.f);
      const cid = this.contrato.id;
      const existe = this.contrato.vistorias.some((x) => x.id === f.id);
      app.store.commit(`Vistoria de ${f.tipo === 'saida' ? 'saída' : 'entrada'} ${existe ? 'alterada' : 'registrada'} (${this.fmtData(f.data)})`, (d) => {
        const c = D.porId(d.contratos, cid);
        if (existe) Object.assign(D.porId(c.vistorias, f.id), f); else c.vistorias.push(f);
      });
      if (gerar) {
        this.salvando = true;
        try { await gerarVistoriaDocx(cid, f.id); } catch (e) { avisar('Erro ao gerar: ' + e.message, 'erro'); }
        this.salvando = false;
      }
      this.$emit('fechar');
    },
  },
  template: `
  <Modal :titulo="'Vistoria de ' + (f.tipo === 'saida' ? 'saída' : 'entrada')" largo @fechar="$emit('fechar')">
    <div class="form-grid">
      <label class="c2">Tipo<select v-model="f.tipo"><option value="entrada">Entrada</option><option value="saida">Saída</option></select></label>
      <label class="c2">Data<input type="date" v-model="f.data"></label>
      <label class="c2">Vistoriador<input v-model="f.vistoriador"></label>
      <label class="c1">Leitura energia<input v-model="f.leituraEnergia" inputmode="numeric"></label>
      <label class="c1">Leitura água<input v-model="f.leituraAgua" inputmode="numeric"></label>
      <label class="c1">Leitura gás<input v-model="f.leituraGas" inputmode="numeric"></label>
      <label class="c3">Chaves entregues<input v-model="f.chaves" placeholder="ex.: 3 chaves da porta, 1 do portão"></label>
    </div>
    <h3 style="margin-top:16px">Ambientes e itens</h3>
    <table class="tabela compacta">
      <thead><tr><th>Ambiente / item</th><th v-if="f.tipo === 'saida' && entrada">Na entrada</th><th>Estado</th><th>Observação</th><th></th></tr></thead>
      <tbody><tr v-for="(a, k) in f.ambientes" :key="k">
        <td><input v-model="a.nome"></td>
        <td v-if="f.tipo === 'saida' && entrada"><small>{{ estadoEntrada(a.nome) || '—' }}</small></td>
        <td><select v-model="a.estado"><option v-for="e in ESTADOS">{{ e }}</option></select></td>
        <td><input v-model="a.observacao"></td>
        <td><button class="pequeno perigo" @click="f.ambientes.splice(k, 1)" aria-label="Remover">✕</button></td>
      </tr></tbody>
    </table>
    <button class="pequeno" @click="f.ambientes.push({ nome: '', estado: 'Bom', observacao: '' })">+ Item</button>
    <div class="form-grid" style="margin-top:12px"><label class="c6">Observações gerais<textarea v-model="f.observacoes" rows="2"></textarea></label></div>
    <h3 style="margin-top:16px">Fotos</h3>
    <Anexos :lista="f.fotos" :pasta="pasta" aceitar="image/*" rotulo="+ Adicionar fotos"
      @adicionar="(n) => f.fotos.push(...n.map(a => ({ ...a, descricao: a.nome.replace(/\\.[^.]+$/, '') })))"
      @remover="(a) => f.fotos = f.fotos.filter(x => x !== a)" />
    <div v-if="f.fotos.length" class="form-grid" style="margin-top:8px">
      <label v-for="(ft, k) in f.fotos" :key="k" class="c3">Legenda da foto {{ k + 1 }}<input v-model="ft.descricao"></label>
    </div>
    <template #rodape>
      <button @click="$emit('fechar')">Cancelar</button>
      <button @click="salvar(false)" :disabled="salvando">Salvar</button>
      <button class="primario" @click="salvar(true)" :disabled="salvando">{{ salvando ? 'Gerando…' : 'Salvar e gerar termo (.docx)' }}</button>
    </template>
  </Modal>`,
};

export const AditivoModal = {
  components: { Modal },
  props: { contrato: Object },
  emits: ['fechar'],
  setup() { return helpers; },
  data() {
    const c = this.contrato;
    return {
      salvando: false, aplicar: true,
      f: { id: novoId(), numero: (c.aditivos?.length || 0) + 1, data: hojeISO(), prorrogarMeses: 0, novoValor: 0,
        vigenciaValor: mesAtual(), texto: '' },
    };
  },
  computed: {
    novaDataFim() {
      const c = this.contrato;
      const n = Number(this.f.prorrogarMeses) || 0;
      return n ? diaMenos1(somaMesesData(c.dataInicio, Number(c.prazoMeses) + n)) : '';
    },
  },
  methods: {
    async salvar() {
      const f = { ...clone(this.f), novaDataFim: this.novaDataFim, criadoPor: app.usuario, criadoEm: new Date().toISOString() };
      if (!f.prorrogarMeses && !f.novoValor && !f.texto.trim()) { avisar('Informe ao menos uma alteração.', 'erro'); return; }
      const c0 = this.contrato;
      const aplicar = this.aplicar;
      const valorAnterior = D.valorVigente(c0, f.vigenciaValor);
      app.store.commit(`${f.numero}º aditivo registrado`, (d) => {
        const c = D.porId(d.contratos, c0.id);
        c.aditivos.push(f);
        if (!aplicar) return;
        if (f.prorrogarMeses) { c.prazoMeses = Number(c.prazoMeses) + Number(f.prorrogarMeses); c.dataFim = f.novaDataFim; }
        if (f.novoValor) {
          c.reajustes = c.reajustes.filter((r) => r.vigenciaDesde !== f.vigenciaValor);
          c.reajustes.push({ id: novoId(), tipo: 'aditivo', indice: `${f.numero}º aditivo`, vigenciaDesde: f.vigenciaValor,
            valorAnterior, valorNovo: Number(f.novoValor), pct: arred2((Number(f.novoValor) / valorAnterior - 1) * 100),
            pctAplicado: null, aplicadoEm: f.criadoEm, aplicadoPor: app.usuario });
        }
      });
      this.salvando = true;
      try { await gerarAditivoDocx(c0.id, f.id); } catch (e) { avisar('Erro ao gerar: ' + e.message, 'erro'); }
      this.salvando = false;
      this.$emit('fechar');
    },
  },
  template: `
  <Modal :titulo="f.numero + 'º termo aditivo'" largo @fechar="$emit('fechar')">
    <div class="form-grid">
      <label class="c2">Data<input type="date" v-model="f.data"></label>
      <label class="c2">Prorrogar prazo (meses)<input type="number" min="0" v-model.number="f.prorrogarMeses">
        <small v-if="novaDataFim">novo término: {{ fmtData(novaDataFim) }}</small></label>
      <span class="c2"></span>
      <label class="c2">Novo valor do aluguel (R$)<input type="number" step="0.01" min="0" v-model.number="f.novoValor">
        <small>atual: {{ fmtMoeda(valorVigente(contrato)) }}</small></label>
      <label class="c2">A partir do aluguel de<input type="month" v-model="f.vigenciaValor"></label>
      <label class="c6">Outras alterações (cada linha vira uma cláusula)<textarea v-model="f.texto" rows="3" placeholder="ex.: O LOCATÁRIO fica autorizado a instalar toldo na fachada, às suas expensas."></textarea></label>
      <label class="c6 check"><input type="checkbox" v-model="aplicar"> Atualizar o contrato no sistema com o novo prazo/valor</label>
    </div>
    <template #rodape>
      <button @click="$emit('fechar')">Cancelar</button>
      <button class="primario" @click="salvar" :disabled="salvando">{{ salvando ? 'Gerando…' : 'Salvar e gerar aditivo (.docx)' }}</button>
    </template>
  </Modal>`,
};
