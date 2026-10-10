import { app, db, helpers, Chip, Modal, Kpi, avisar } from './comum.js';
import { gerarReciboDocx } from './acoes.js';
import * as D from '../db.js';
import { novoId, hojeISO, mesAtual, somaMeses, arred2 } from '../util.js';

export const CATEGORIAS_DESPESA = ['IPTU', 'Condomínio', 'Manutenção/Reforma', 'Seguro', 'Água/Energia', 'Taxas/Cartório', 'Honorários', 'Impostos', 'Outros'];
const FORMAS = ['PIX', 'Transferência', 'Depósito', 'Boleto', 'Dinheiro', 'Cheque'];

export const PagamentoModal = {
  components: { Modal },
  props: { cobranca: Object },
  emits: ['fechar'],
  setup() { return { app, ...helpers, FORMAS, arred2 }; },
  data() {
    const p = this.cobranca.pagamento;
    return {
      f: p ? { ...p } : { id: novoId(), contratoId: this.cobranca.contrato.id, competencia: this.cobranca.competencia,
        dataPagamento: hojeISO(), valorPago: this.cobranca.valor, acrescimos: 0, descontos: 0, forma: 'PIX', observacao: '' },
    };
  },
  computed: {
    db,
    inq() { return D.porId(this.db.inquilinos, this.cobranca.contrato.inquilinoId); },
    enc() {
      if (!this.f.dataPagamento) return null;
      return D.calcularEncargos(this.cobranca.contrato, this.cobranca.valor, this.cobranca.vencimento, this.f.dataPagamento, app.indices);
    },
  },
  watch: {
    'f.acrescimos'() { this.recalcular(); },
    'f.descontos'() { this.recalcular(); },
  },
  methods: {
    recalcular() { this.f.valorPago = arred2(this.cobranca.valor + (Number(this.f.acrescimos) || 0) - (Number(this.f.descontos) || 0)); },
    salvar() {
      if (!this.f.dataPagamento || !(Number(this.f.valorPago) > 0)) { avisar('Informe a data e o valor pago.', 'erro'); return; }
      const p = { ...this.f, valorPago: Number(this.f.valorPago), registradoPor: app.usuario, registradoEm: new Date().toISOString() };
      const existe = !!this.cobranca.pagamento;
      app.store.commit(`Pagamento ${this.fmtMes(p.competencia)} — ${this.inq?.nome}: ${this.fmtMoeda(p.valorPago)}`, (d) => {
        if (existe) Object.assign(D.porId(d.pagamentos, p.id), p);
        else d.pagamentos.push(p);
      });
      avisar('Pagamento registrado.');
      this.$emit('fechar');
    },
    excluir() {
      if (!confirm('Excluir este pagamento?')) return;
      const id = this.f.id;
      app.store.commit(`Pagamento ${this.fmtMes(this.f.competencia)} — ${this.inq?.nome} excluído`, (d) => {
        d.pagamentos = d.pagamentos.filter((p) => p.id !== id);
      });
      this.$emit('fechar');
    },
  },
  template: `
  <Modal :titulo="(cobranca.pagamento ? 'Editar' : 'Registrar') + ' pagamento — ' + fmtMes(cobranca.competencia)" @fechar="$emit('fechar')">
    <p><b>{{ inq?.nome }}</b><br><small>Aluguel {{ fmtMoeda(cobranca.valor) }} · vencimento {{ fmtData(cobranca.vencimento) }}</small></p>
    <div class="form-grid">
      <label class="c3">Data do pagamento<input type="date" v-model="f.dataPagamento"></label>
      <label class="c3">Forma<select v-model="f.forma"><option v-for="x in FORMAS">{{ x }}</option></select></label>
      <label class="c2">Multa/juros (R$)<input type="number" step="0.01" v-model.number="f.acrescimos"></label>
      <label class="c2">Descontos (R$)<input type="number" step="0.01" v-model.number="f.descontos"></label>
      <label class="c2">Valor pago (R$)<input type="number" step="0.01" v-model.number="f.valorPago"></label>
      <div v-if="enc && enc.dias" class="c6 aviso-bloco">
        <b>Pago com {{ enc.dias }} dia(s) de atraso.</b> Pelo contrato, deveria ser cobrado <b>{{ fmtMoeda(enc.total) }}</b>:
        multa {{ enc.regra.multaPct }}% = {{ fmtMoeda(enc.multa) }}<template v-if="enc.juros">; juros {{ enc.regra.jurosMesPct }}% a.m. pro rata = {{ fmtMoeda(enc.juros) }}</template><template v-if="enc.correcao">; correção ({{ cobranca.contrato.indice }}) = {{ fmtMoeda(enc.correcao) }}</template>.
        <span v-if="!enc.juros && enc.regra.jurosMesPct && enc.dias <= enc.regra.jurosAposDias"> Juros e correção só a partir de {{ enc.regra.jurosAposDias }} dias de atraso.</span>
        <div class="linha-botoes" style="margin-top:6px">
          <button class="pequeno" @click="f.acrescimos = enc.total">Cobrar {{ fmtMoeda(enc.total) }}</button>
          <label class="check"><input type="checkbox" :checked="!!f.encargosDispensados" @change="f.encargosDispensados = $event.target.checked ? Math.max(0, arred2(enc.total - (f.acrescimos || 0))) : 0"> Dispensar a diferença (tolerância)</label>
        </div>
      </div>
      <p v-else-if="f.dataPagamento" class="dica c6">Pago em dia: sem multa ou juros.</p>
      <label class="c6">Observação<input v-model="f.observacao"></label>
    </div>
    <template #rodape>
      <button v-if="cobranca.pagamento" class="perigo" @click="excluir">Excluir</button>
      <span class="espaco"></span>
      <button @click="$emit('fechar')">Cancelar</button><button class="primario" @click="salvar">Salvar</button>
    </template>
  </Modal>`,
};

// Lançamento do histórico de pagamentos de um contrato, mês a mês.
export const HistoricoModal = {
  components: { Modal },
  props: { contrato: Object },
  emits: ['fechar'],
  setup() { return { app, ...helpers, FORMAS }; },
  data() {
    const c = this.contrato;
    return { desde: (c.dataInicio || hojeISO()).slice(0, 7), linhas: [], formaPadrao: 'PIX' };
  },
  created() { this.montar(); },
  computed: { db },
  watch: { desde() { this.montar(); } },
  methods: {
    montar() {
      const c = this.contrato;
      const ate = c.status === 'encerrado' ? (c.dataEncerramento || D.fimContrato(c)).slice(0, 7) : mesAtual();
      const linhas = [];
      for (let ym = this.desde; ym <= ate && linhas.length < 120; ym = somaMeses(ym, 1)) {
        if (c.dataInicio && ym < c.dataInicio.slice(0, 7)) continue;
        const [cob] = D.cobrancasDoMes({ ...this.db, contratos: [{ ...c, controleDesde: this.desde, status: 'ativo' }] }, ym);
        if (!cob) continue;
        const p = cob.pagamento;
        linhas.push({ ym, venc: cob.vencimento, valor: cob.valor, existente: p || null,
          data: p?.dataPagamento || '', pago: p ? Number(p.valorPago) : null, acrescimos: p ? Number(p.acrescimos) || 0 : 0, forma: p?.forma || '' });
      }
      this.linhas = linhas;
    },
    enc(l) { return l.data ? D.calcularEncargos(this.contrato, l.valor, l.venc, l.data, app.indices) : null; },
    emDia(l) { l.data = l.venc; l.pago = l.valor; l.acrescimos = 0; },
    todosEmDia() { for (const l of this.linhas) if (!l.data) this.emDia(l); },
    limpar(l) { l.data = ''; l.pago = null; l.acrescimos = 0; },
    salvar() {
      const c = this.contrato;
      const novos = [];
      const removidos = [];
      for (const l of this.linhas) {
        if (l.data && Number(l.pago) > 0) {
          novos.push({ ...(l.existente || { id: novoId(), contratoId: c.id, competencia: l.ym, descontos: 0, observacao: '' }),
            dataPagamento: l.data, valorPago: Number(l.pago), acrescimos: Number(l.acrescimos) || 0, forma: l.forma || this.formaPadrao,
            registradoPor: app.usuario, registradoEm: new Date().toISOString() });
        } else if (l.existente) removidos.push(l.existente.id);
      }
      const desde = this.desde;
      app.store.commit(`Histórico de pagamentos de ${D.porId(this.db.inquilinos, c.inquilinoId)?.nome}: ${novos.length} lançamento(s)`, (d) => {
        for (const p of novos) {
          const atual = d.pagamentos.find((x) => x.id === p.id || (x.contratoId === p.contratoId && x.competencia === p.competencia));
          if (atual) Object.assign(atual, p, { id: atual.id }); else d.pagamentos.push(p);
        }
        d.pagamentos = d.pagamentos.filter((x) => !removidos.includes(x.id));
        const cc = D.porId(d.contratos, c.id);
        if (!cc.controleDesde || desde < cc.controleDesde) cc.controleDesde = desde;
      });
      avisar(`${novos.length} pagamento(s) salvos.`);
      this.$emit('fechar');
    },
  },
  template: `
  <Modal titulo="Histórico de pagamentos" largo @fechar="$emit('fechar')">
    <div class="linha-botoes">
      <label class="check">Lançar a partir de <input type="month" v-model="desde" style="width:170px"></label>
      <select v-model="formaPadrao" aria-label="Forma padrão" style="width:auto"><option v-for="x in FORMAS">{{ x }}</option></select>
      <button class="pequeno" @click="todosEmDia">Marcar todos em aberto como pagos no vencimento</button>
    </div>
    <p class="dica">Preencha a data e o valor de cada mês pago. A coluna "Devido" mostra multa, juros e correção calculados pela regra do contrato para a data informada.</p>
    <div style="overflow-x:auto">
    <table class="tabela compacta historico">
      <thead><tr><th>Mês</th><th>Venc.</th><th class="num">Aluguel</th><th>Pago em</th><th class="num">Valor pago</th><th class="num">Multa/juros cobrados</th><th class="num">Devido</th><th></th></tr></thead>
      <tbody><tr v-for="l in linhas" :key="l.ym" :class="{ atrasado: enc(l)?.dias }">
        <td>{{ fmtMes(l.ym) }}</td><td>{{ fmtData(l.venc).slice(0, 5) }}</td><td class="num">{{ fmtMoeda(l.valor) }}</td>
        <td><input type="date" v-model="l.data"></td>
        <td class="num"><input type="number" step="0.01" v-model.number="l.pago" style="max-width:110px"></td>
        <td class="num"><input type="number" step="0.01" v-model.number="l.acrescimos" style="max-width:100px"></td>
        <td class="num"><template v-if="enc(l)?.dias"><b :class="{ 'texto-ruim': enc(l).total > (l.acrescimos || 0) + 0.009 }">{{ fmtMoeda(enc(l).total) }}</b><br><small>{{ enc(l).dias }} dia(s)</small></template><small v-else-if="l.data">em dia</small></td>
        <td class="acoes-linha"><button class="pequeno" @click="emDia(l)">Em dia</button><button v-if="l.data" class="pequeno" @click="limpar(l)" aria-label="Limpar">✕</button></td>
      </tr></tbody>
    </table>
    </div>
    <template #rodape><button @click="$emit('fechar')">Cancelar</button><button class="primario" @click="salvar">Salvar histórico</button></template>
  </Modal>`,
};

export const DespesaModal = {
  components: { Modal },
  props: { despesa: Object },
  emits: ['fechar'],
  setup() { return { app, ...helpers, CATEGORIAS_DESPESA }; },
  data() { return { f: { ...this.despesa } }; },
  computed: { db, imoveis() { return this.db.imoveis.slice().sort((a, b) => a.ref - b.ref); } },
  methods: {
    salvar() {
      if (!this.f.data || !(Number(this.f.valor) > 0)) { avisar('Informe data e valor.', 'erro'); return; }
      const x = { ...this.f, valor: Number(this.f.valor), registradoPor: app.usuario };
      const existe = this.db.despesas.some((d) => d.id === x.id);
      app.store.commit(`Despesa ${x.categoria}: ${this.fmtMoeda(x.valor)}`, (d) => {
        if (existe) Object.assign(D.porId(d.despesas, x.id), x); else d.despesas.push(x);
      });
      this.$emit('fechar');
    },
    excluir() {
      if (!confirm('Excluir esta despesa?')) return;
      const id = this.f.id;
      app.store.commit('Despesa excluída', (d) => { d.despesas = d.despesas.filter((x) => x.id !== id); });
      this.$emit('fechar');
    },
  },
  template: `
  <Modal titulo="Despesa" @fechar="$emit('fechar')">
    <div class="form-grid">
      <label class="c6">Imóvel<select v-model="f.imovelId"><option value="">Geral (sem imóvel)</option><option v-for="i in imoveis" :value="i.id">{{ i.ref }} · {{ i.descricao.slice(0, 70) }}</option></select></label>
      <label class="c2">Data<input type="date" v-model="f.data"></label>
      <label class="c2">Categoria<select v-model="f.categoria"><option v-for="c in CATEGORIAS_DESPESA">{{ c }}</option></select></label>
      <label class="c2">Valor (R$)<input type="number" step="0.01" v-model.number="f.valor"></label>
      <label class="c6">Descrição<input v-model="f.descricao"></label>
    </div>
    <template #rodape>
      <button v-if="db.despesas.some(d => d.id === f.id)" class="perigo" @click="excluir">Excluir</button>
      <span class="espaco"></span>
      <button @click="$emit('fechar')">Cancelar</button><button class="primario" @click="salvar">Salvar</button>
    </template>
  </Modal>`,
};

export const Financeiro = {
  components: { Chip, Kpi, PagamentoModal, DespesaModal },
  setup() { return { app, ...helpers }; },
  data() { return { ym: mesAtual(), pagamento: null, despesa: null, ano: mesAtual().slice(0, 4), selecionados: [], dataLote: hojeISO() }; },
  computed: {
    db,
    cobrancas() {
      return D.cobrancasDoMes(this.db, this.ym, app.indices).map((c) => ({
        ...c, inq: D.porId(this.db.inquilinos, c.contrato.inquilinoId), im: D.porId(this.db.imoveis, c.contrato.imovelId) }));
    },
    esperado() { return this.cobrancas.reduce((s, c) => s + c.valor, 0); },
    recebido() { return this.cobrancas.reduce((s, c) => s + (Number(c.pagamento?.valorPago) || 0), 0); },
    despesasMes() {
      return this.db.despesas.filter((d) => d.data?.slice(0, 7) === this.ym)
        .map((d) => ({ d, im: D.porId(this.db.imoveis, d.imovelId) })).sort((a, b) => a.d.data.localeCompare(b.d.data));
    },
    totalDespesas() { return this.despesasMes.reduce((s, x) => s + Number(x.d.valor), 0); },
    aCobrarEncargos() {
      return D.encargosNaoCobrados(this.db, app.indices).map((c) => ({
        ...c, inq: D.porId(this.db.inquilinos, c.contrato.inquilinoId), im: D.porId(this.db.imoveis, c.contrato.imovelId) }));
    },
    totalEncargos() { return this.aCobrarEncargos.reduce((s, c) => s + c.aCobrar, 0); },
    atrasos() {
      return D.cobrancasEmAtraso(this.db, app.indices).map((c) => ({
        ...c, inq: D.porId(this.db.inquilinos, c.contrato.inquilinoId), im: D.porId(this.db.imoveis, c.contrato.imovelId) }));
    },
    anos() {
      const s = new Set([mesAtual().slice(0, 4)]);
      for (const p of this.db.pagamentos) s.add(p.competencia.slice(0, 4));
      for (const d of this.db.despesas) if (d.data) s.add(d.data.slice(0, 4));
      return [...s].sort().reverse();
    },
    resumoAnual() {
      const linhas = [];
      for (let m = 1; m <= 12; m++) {
        const ym = `${this.ano}-${String(m).padStart(2, '0')}`;
        const cobs = D.cobrancasDoMes(this.db, ym);
        const recebido = this.db.pagamentos.filter((p) => p.competencia === ym).reduce((s, p) => s + Number(p.valorPago), 0);
        const despesas = this.db.despesas.filter((d) => d.data?.slice(0, 7) === ym).reduce((s, d) => s + Number(d.valor), 0);
        linhas.push({ ym, esperado: cobs.reduce((s, c) => s + c.valor, 0), recebido, despesas, liquido: recebido - despesas });
      }
      return linhas;
    },
    totalAnual() {
      return this.resumoAnual.reduce((t, l) => ({ esperado: t.esperado + l.esperado, recebido: t.recebido + l.recebido,
        despesas: t.despesas + l.despesas, liquido: t.liquido + l.liquido }), { esperado: 0, recebido: 0, despesas: 0, liquido: 0 });
    },
    maxAnual() { return Math.max(1, ...this.resumoAnual.map((l) => Math.max(l.esperado, l.recebido))); },
  },
  methods: {
    mes(n) { this.ym = somaMeses(this.ym, n); },
    novaDespesa() { this.despesa = { id: novoId(), imovelId: '', data: hojeISO(), categoria: 'Manutenção/Reforma', descricao: '', valor: 0 }; },
    async registrarSelecionados() {
      const itens = this.cobrancas.filter((c) => this.selecionados.includes(c.contrato.id) && !c.pagamento);
      if (!itens.length) return;
      const data = this.dataLote;
      const pags = itens.map((c) => {
        const enc = D.calcularEncargos(c.contrato, c.valor, c.vencimento, data, app.indices);
        return { id: novoId(), contratoId: c.contrato.id, competencia: c.competencia, dataPagamento: data, valorPago: c.valor,
          acrescimos: 0, descontos: 0, forma: 'PIX', observacao: enc.total ? `Multa/juros devidos não cobrados: ${this.fmtMoeda(enc.total)}` : '',
          registradoPor: app.usuario, registradoEm: new Date().toISOString() };
      });
      app.store.commit(`Pagamentos de ${this.fmtMes(this.ym)} lançados em lote (${pags.length})`, (d) => { d.pagamentos.push(...pags); });
      this.selecionados = [];
      avisar(`${pags.length} pagamento(s) registrados.`);
    },
    dispensar(c) {
      if (!confirm(`Dispensar a cobrança de ${this.fmtMoeda(c.aCobrar)} de multa/juros de ${c.inq?.nome} (${this.fmtMes(c.competencia)})?`)) return;
      const id = c.pagamento.id;
      const valor = c.aCobrar + (Number(c.pagamento.encargosDispensados) || 0);
      app.store.commit(`Multa/juros dispensados: ${c.inq?.nome} ${this.fmtMes(c.competencia)}`, (d) => { D.porId(d.pagamentos, id).encargosDispensados = valor; });
    },
    async recibo(cob) {
      try { await gerarReciboDocx(cob.contrato.id, cob.pagamento.id); } catch (e) { avisar('Erro: ' + e.message, 'erro'); }
    },
  },
  template: `
  <section>
    <div class="titulo-pagina">
      <h1>Financeiro</h1>
      <div class="seletor-mes">
        <button class="icone" @click="mes(-1)" aria-label="Mês anterior">‹</button>
        <input type="month" v-model="ym" aria-label="Competência">
        <button class="icone" @click="mes(1)" aria-label="Próximo mês">›</button>
      </div>
    </div>

    <div class="kpis">
      <Kpi rotulo="Esperado no mês" :valor="fmtMoeda(esperado)" :sub="cobrancas.length + ' cobrança(s)'" />
      <Kpi rotulo="Recebido" :valor="fmtMoeda(recebido)" :sub="cobrancas.filter(c => c.status === 'pago').length + ' pagas'" tom="bom" />
      <Kpi rotulo="A receber" :valor="fmtMoeda(Math.max(0, esperado - recebido))" :tom="cobrancas.some(c => c.status === 'atrasado') ? 'ruim' : ''" />
      <Kpi rotulo="Despesas" :valor="fmtMoeda(totalDespesas)" />
      <Kpi rotulo="Resultado do mês" :valor="fmtMoeda(recebido - totalDespesas)" />
    </div>

    <div class="cartao">
      <div class="cab-cartao"><h2>Aluguéis de {{ fmtMesLongo(ym) }}</h2>
        <div class="linha-botoes" v-if="selecionados.length">
          <label class="check">Pagos em <input type="date" v-model="dataLote" style="width:150px"></label>
          <button class="pequeno primario" @click="registrarSelecionados">Registrar {{ selecionados.length }} selecionado(s)</button>
        </div></div>
      <table class="tabela">
        <thead><tr><th></th><th>Venc.</th><th>Inquilino</th><th>Imóvel</th><th class="num">Valor</th><th>Status</th><th>Pago em</th><th class="num">Pago</th><th class="num">Multa/juros</th><th></th></tr></thead>
        <tbody>
          <tr v-for="c in cobrancas" :key="c.contrato.id">
            <td><input v-if="!c.pagamento" type="checkbox" :value="c.contrato.id" v-model="selecionados" aria-label="Selecionar"></td>
            <td>{{ fmtData(c.vencimento).slice(0, 5) }}</td>
            <td><a :href="'#/contrato/' + c.contrato.id">{{ c.inq?.nome }}</a></td>
            <td>Ref. {{ c.im?.ref }}<small v-if="c.contrato.unidade"> · {{ c.contrato.unidade }}</small></td>
            <td class="num">{{ fmtMoeda(c.valor) }}</td><td><Chip :status="c.status" /></td>
            <td>{{ fmtData(c.pagamento?.dataPagamento) }}</td><td class="num">{{ c.pagamento ? fmtMoeda(c.pagamento.valorPago) : '' }}</td>
            <td class="num"><template v-if="c.encargos.total"><span :class="{ 'texto-ruim': c.aCobrar > 0 }">{{ fmtMoeda(c.encargos.total) }}</span><br><small>{{ c.pagamento ? (c.aCobrar > 0 ? 'falta cobrar ' + fmtMoeda(c.aCobrar) : 'cobrado') : 'até hoje' }}</small></template></td>
            <td class="acoes-linha">
              <button v-if="!c.pagamento" class="pequeno primario" @click="pagamento = c">Registrar pagamento</button>
              <template v-else><button class="pequeno" @click="pagamento = c">Editar</button><button class="pequeno" @click="recibo(c)">Recibo</button></template>
            </td>
          </tr>
          <tr v-if="!cobrancas.length"><td colspan="10" class="vazio">Nenhum contrato com cobrança neste mês. As cobranças aparecem a partir dos contratos cadastrados.</td></tr>
        </tbody>
      </table>
    </div>

    <div class="cartao" v-if="atrasos.length">
      <h2>Em atraso (todos os meses)</h2>
      <table class="tabela">
        <thead><tr><th>Competência</th><th>Inquilino</th><th>Imóvel</th><th>Vencimento</th><th class="num">Em aberto</th><th class="num">Multa/juros até hoje</th><th class="num">Total atualizado</th><th></th></tr></thead>
        <tbody><tr v-for="c in atrasos" :key="c.contrato.id + c.competencia">
          <td>{{ fmtMes(c.competencia) }}</td><td><a :href="'#/contrato/' + c.contrato.id">{{ c.inq?.nome }}</a></td><td>Ref. {{ c.im?.ref }}</td>
          <td>{{ fmtData(c.vencimento) }}<br><small>{{ c.encargos.dias }} dia(s)</small></td><td class="num">{{ fmtMoeda(c.valor - (c.pagamento?.valorPago || 0)) }}</td>
          <td class="num">{{ fmtMoeda(c.encargos.total) }}</td><td class="num"><b>{{ fmtMoeda(c.valor - (c.pagamento?.valorPago || 0) + c.encargos.total) }}</b></td>
          <td class="acoes-linha"><button class="pequeno" @click="pagamento = c">Registrar</button></td></tr></tbody>
      </table>
    </div>

    <div class="cartao" v-if="aCobrarEncargos.length">
      <h2>Multas e juros a cobrar ({{ fmtMoeda(totalEncargos) }})</h2>
      <p class="dica" style="margin-top:0">Pagamentos feitos depois do vencimento em que a multa/juros previstos no contrato não foram cobrados (ou foram cobrados a menos).</p>
      <table class="tabela">
        <thead><tr><th>Competência</th><th>Inquilino</th><th>Vencimento</th><th>Pago em</th><th class="num">Devido</th><th class="num">Cobrado</th><th class="num">A cobrar</th><th></th></tr></thead>
        <tbody><tr v-for="c in aCobrarEncargos" :key="c.pagamento.id">
          <td>{{ fmtMes(c.competencia) }}</td><td><a :href="'#/contrato/' + c.contrato.id">{{ c.inq?.nome }}</a><br><small>Ref. {{ c.im?.ref }}</small></td>
          <td>{{ fmtData(c.vencimento) }}</td><td>{{ fmtData(c.pagamento.dataPagamento) }}<br><small>{{ c.encargos.dias }} dia(s)</small></td>
          <td class="num">{{ fmtMoeda(c.encargos.total) }}</td><td class="num">{{ fmtMoeda(c.pagamento.acrescimos || 0) }}</td>
          <td class="num"><b class="texto-ruim">{{ fmtMoeda(c.aCobrar) }}</b></td>
          <td class="acoes-linha"><button class="pequeno" @click="pagamento = c">Editar</button><button class="pequeno" @click="dispensar(c)">Dispensar</button></td></tr></tbody>
      </table>
    </div>

    <div class="cartao">
      <div class="cab-cartao"><h2>Despesas de {{ fmtMesLongo(ym) }}</h2><button class="pequeno" @click="novaDespesa">+ Despesa</button></div>
      <p v-if="!despesasMes.length" class="vazio">Nenhuma despesa lançada neste mês.</p>
      <table v-else class="tabela">
        <thead><tr><th>Data</th><th>Imóvel</th><th>Categoria</th><th>Descrição</th><th class="num">Valor</th></tr></thead>
        <tbody><tr v-for="{ d, im } in despesasMes" :key="d.id" class="clicavel" @click="despesa = { ...d }">
          <td>{{ fmtData(d.data) }}</td><td>{{ im ? 'Ref. ' + im.ref : 'Geral' }}</td><td>{{ d.categoria }}</td><td>{{ d.descricao }}</td><td class="num">{{ fmtMoeda(d.valor) }}</td></tr></tbody>
      </table>
    </div>

    <div class="cartao">
      <div class="cab-cartao"><h2>Resumo anual</h2>
        <select v-model="ano" aria-label="Ano"><option v-for="a in anos">{{ a }}</option></select></div>
      <table class="tabela">
        <thead><tr><th>Mês</th><th class="num">Esperado</th><th class="num">Recebido</th><th class="num">Despesas</th><th class="num">Líquido</th><th class="barra-col"></th></tr></thead>
        <tbody><tr v-for="l in resumoAnual" :key="l.ym" class="clicavel" @click="ym = l.ym">
          <td>{{ fmtMes(l.ym) }}</td><td class="num">{{ fmtMoeda(l.esperado) }}</td><td class="num">{{ fmtMoeda(l.recebido) }}</td>
          <td class="num">{{ fmtMoeda(l.despesas) }}</td><td class="num">{{ fmtMoeda(l.liquido) }}</td>
          <td class="barra-col"><span class="barra fantasma" :style="{ width: l.esperado / maxAnual * 100 + '%' }"><span class="barra" :style="{ width: (l.esperado ? Math.min(100, l.recebido / l.esperado * 100) : 0) + '%' }"></span></span></td>
        </tr></tbody>
        <tfoot><tr><td>Total</td><td class="num">{{ fmtMoeda(totalAnual.esperado) }}</td><td class="num">{{ fmtMoeda(totalAnual.recebido) }}</td>
          <td class="num">{{ fmtMoeda(totalAnual.despesas) }}</td><td class="num">{{ fmtMoeda(totalAnual.liquido) }}</td><td></td></tr></tfoot>
      </table>
    </div>

    <PagamentoModal v-if="pagamento" :cobranca="pagamento" @fechar="pagamento = null" />
    <DespesaModal v-if="despesa" :despesa="despesa" @fechar="despesa = null" />
  </section>`,
};
