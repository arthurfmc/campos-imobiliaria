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
  setup() { return { app, ...helpers, FORMAS }; },
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
    diasAtraso() {
      const ms = new Date(this.f.dataPagamento + 'T12:00:00') - new Date(this.cobranca.vencimento + 'T12:00:00');
      return Math.max(0, Math.round(ms / 86400000));
    },
    encargoSugerido() {
      if (!this.diasAtraso) return 0;
      const cfg = this.db.config;
      const v = this.cobranca.valor;
      return arred2(v * cfg.multaAtrasoPct / 100 + v * cfg.jurosMesPct / 100 / 30 * this.diasAtraso);
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
      <p v-if="encargoSugerido" class="dica c6">Pago com {{ diasAtraso }} dia(s) de atraso. Multa {{ db.config.multaAtrasoPct }}% + juros {{ db.config.jurosMesPct }}% a.m. = {{ fmtMoeda(encargoSugerido) }}.
        <button class="link" @click="f.acrescimos = encargoSugerido">Aplicar</button></p>
      <label class="c6">Observação<input v-model="f.observacao"></label>
    </div>
    <template #rodape>
      <button v-if="cobranca.pagamento" class="perigo" @click="excluir">Excluir</button>
      <span class="espaco"></span>
      <button @click="$emit('fechar')">Cancelar</button><button class="primario" @click="salvar">Salvar</button>
    </template>
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
  data() { return { ym: mesAtual(), pagamento: null, despesa: null, ano: mesAtual().slice(0, 4) }; },
  computed: {
    db,
    cobrancas() {
      return D.cobrancasDoMes(this.db, this.ym).map((c) => ({
        ...c, inq: D.porId(this.db.inquilinos, c.contrato.inquilinoId), im: D.porId(this.db.imoveis, c.contrato.imovelId) }));
    },
    esperado() { return this.cobrancas.reduce((s, c) => s + c.valor, 0); },
    recebido() { return this.cobrancas.reduce((s, c) => s + (Number(c.pagamento?.valorPago) || 0), 0); },
    despesasMes() {
      return this.db.despesas.filter((d) => d.data?.slice(0, 7) === this.ym)
        .map((d) => ({ d, im: D.porId(this.db.imoveis, d.imovelId) })).sort((a, b) => a.d.data.localeCompare(b.d.data));
    },
    totalDespesas() { return this.despesasMes.reduce((s, x) => s + Number(x.d.valor), 0); },
    atrasos() {
      return D.cobrancasEmAtraso(this.db).map((c) => ({
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
      <h2>Aluguéis de {{ fmtMesLongo(ym) }}</h2>
      <table class="tabela">
        <thead><tr><th>Venc.</th><th>Inquilino</th><th>Imóvel</th><th class="num">Valor</th><th>Status</th><th>Pago em</th><th class="num">Pago</th><th></th></tr></thead>
        <tbody>
          <tr v-for="c in cobrancas" :key="c.contrato.id">
            <td>{{ fmtData(c.vencimento).slice(0, 5) }}</td>
            <td><a :href="'#/contrato/' + c.contrato.id">{{ c.inq?.nome }}</a></td>
            <td>Ref. {{ c.im?.ref }}<small v-if="c.contrato.unidade"> · {{ c.contrato.unidade }}</small></td>
            <td class="num">{{ fmtMoeda(c.valor) }}</td><td><Chip :status="c.status" /></td>
            <td>{{ fmtData(c.pagamento?.dataPagamento) }}</td><td class="num">{{ c.pagamento ? fmtMoeda(c.pagamento.valorPago) : '' }}</td>
            <td class="acoes-linha">
              <button v-if="!c.pagamento" class="pequeno primario" @click="pagamento = c">Registrar pagamento</button>
              <template v-else><button class="pequeno" @click="pagamento = c">Editar</button><button class="pequeno" @click="recibo(c)">Recibo</button></template>
            </td>
          </tr>
          <tr v-if="!cobrancas.length"><td colspan="8" class="vazio">Nenhum contrato com cobrança neste mês. As cobranças aparecem a partir dos contratos cadastrados.</td></tr>
        </tbody>
      </table>
    </div>

    <div class="cartao" v-if="atrasos.length">
      <h2>Em atraso (todos os meses)</h2>
      <table class="tabela">
        <thead><tr><th>Competência</th><th>Inquilino</th><th>Imóvel</th><th>Vencimento</th><th class="num">Em aberto</th><th></th></tr></thead>
        <tbody><tr v-for="c in atrasos" :key="c.contrato.id + c.competencia">
          <td>{{ fmtMes(c.competencia) }}</td><td><a :href="'#/contrato/' + c.contrato.id">{{ c.inq?.nome }}</a></td><td>Ref. {{ c.im?.ref }}</td>
          <td>{{ fmtData(c.vencimento) }}</td><td class="num">{{ fmtMoeda(c.valor - (c.pagamento?.valorPago || 0)) }}</td>
          <td class="acoes-linha"><button class="pequeno" @click="pagamento = c">Registrar</button></td></tr></tbody>
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
