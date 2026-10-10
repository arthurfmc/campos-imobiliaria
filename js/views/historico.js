// Histórico completo por imóvel ou por inquilino.
import { app, db, helpers, Chip, Kpi, ir } from './comum.js';
import * as D from '../db.js';
import { baixarBlob, hojeISO, mesAtual, somaMeses } from '../util.js';
import { TIPOS_GARANTIA } from '../modelos.js';

export const Historico = {
  components: { Chip, Kpi },
  props: { query: Object },
  setup() { return { app, ...helpers, TIPOS_GARANTIA }; },
  data() {
    const q = this.query || {};
    return { modo: q.inquilino ? 'inquilino' : 'imovel', alvo: q.inquilino || q.imovel || '', soAtrasos: false, verTodos: false };
  },
  watch: {
    modo() { this.alvo = ''; },
    alvo(v) { if (v) history.replaceState(null, '', `#/historico?${this.modo}=${v}`); },
  },
  computed: {
    db,
    opcoes() {
      if (this.modo === 'imovel') {
        const comContrato = new Set(this.db.contratos.map((c) => c.imovelId));
        return this.db.imoveis.slice().sort((a, b) => a.ref - b.ref)
          .map((i) => ({ id: i.id, rot: `Ref. ${i.ref} · ${i.descricao.slice(0, 80)}${comContrato.has(i.id) ? '' : ' (sem contratos)'}` }));
      }
      return this.db.inquilinos.slice().sort((a, b) => a.nome.localeCompare(b.nome)).map((q) => ({ id: q.id, rot: q.nome }));
    },
    imovel() { return this.modo === 'imovel' ? D.porId(this.db.imoveis, this.alvo) : null; },
    inquilino() { return this.modo === 'inquilino' ? D.porId(this.db.inquilinos, this.alvo) : null; },
    contratos() {
      if (!this.alvo) return [];
      return this.db.contratos.filter((c) => (this.modo === 'imovel' ? c.imovelId : c.inquilinoId) === this.alvo)
        .sort((a, b) => (b.dataInicio || '').localeCompare(a.dataInicio || ''));
    },
    cobrancas() { return D.todasCobrancas(this.db, this.contratos, app.indices); },
    resumo() { return D.resumoCobrancas(this.cobrancas); },
    linhasPag() {
      const l = this.soAtrasos ? this.cobrancas.filter((x) => x.pagoComAtraso || x.status === 'atrasado' || x.status === 'parcial') : this.cobrancas;
      return this.verTodos ? l : l.slice(0, 36);
    },
    despesas() {
      if (!this.imovel) return [];
      return this.db.despesas.filter((d) => d.imovelId === this.imovel.id).sort((a, b) => b.data.localeCompare(a.data));
    },
    totalDespesas() { return this.despesas.reduce((s, d) => s + Number(d.valor), 0); },
    eventos() {
      const ev = D.eventosContratos(this.db, this.contratos);
      if (this.inquilino) for (const o of this.inquilino.ocorrencias || []) ev.push({ data: o.data, tipo: 'Ocorrência', texto: `${o.texto} (${o.por})` });
      for (const d of this.despesas) ev.push({ data: d.data, tipo: 'Despesa', texto: `${d.categoria}: ${d.descricao || ''} — ${this.fmtMoeda(d.valor)}` });
      return ev.sort((a, b) => b.data.localeCompare(a.data));
    },
    recebido12m() {
      const lim = somaMeses(mesAtual(), -11);
      return this.cobrancas.filter((x) => x.pagamento && x.competencia >= lim).reduce((s, x) => s + Number(x.pagamento.valorPago), 0);
    },
    ocupacao() {
      // Meses com contrato desde o primeiro contrato do imóvel.
      if (!this.imovel || !this.contratos.length) return null;
      const ini = this.contratos.map((c) => c.dataInicio?.slice(0, 7)).filter(Boolean).sort()[0];
      if (!ini) return null;
      let total = 0; let ocupados = 0;
      for (let ym = ini; ym <= mesAtual(); ym = somaMeses(ym, 1)) {
        total++;
        if (this.contratos.some((c) => {
          const fim = c.status === 'encerrado' ? (c.dataEncerramento || D.fimContrato(c)).slice(0, 7) : '9999-12';
          return c.dataInicio.slice(0, 7) <= ym && ym <= fim;
        })) ocupados++;
      }
      return { total, ocupados, pct: Math.round(ocupados / total * 100) };
    },
  },
  methods: {
    rotulo(c) {
      return this.modo === 'imovel'
        ? `${D.porId(this.db.inquilinos, c.inquilinoId)?.nome || '—'}${c.unidade ? ` · ${c.unidade}` : ''}`
        : D.nomeImovel(D.porId(this.db.imoveis, c.imovelId));
    },
    csv() {
      const cab = ['Competência', 'Contrato', 'Vencimento', 'Aluguel', 'Pago em', 'Valor pago', 'Dias de atraso', 'Multa/juros devidos', 'Multa/juros cobrados', 'Deixou de receber', 'Situação'];
      const n = (v) => (Number(v) || 0).toFixed(2).replace('.', ',');
      const linhas = this.cobrancas.map((x) => [x.competencia, this.rotulo(x.contrato), x.vencimento, n(x.valor), x.pagamento?.dataPagamento || '',
        x.pagamento ? n(x.pagamento.valorPago) : '', x.encargos.dias || 0, n(x.encargos.total), n(x.pagamento?.acrescimos), n(D.naoRecebido(x)), x.status]);
      const txt = [cab, ...linhas].map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
      const nome = (this.imovel ? `Ref ${this.imovel.ref}` : this.inquilino?.nome || 'historico').replace(/[\\/:*?"<>|]/g, '-');
      baixarBlob(new Blob(['﻿' + txt], { type: 'text/csv;charset=utf-8' }), `Histórico de pagamentos - ${nome} - ${hojeISO()}.csv`);
    },
    imprimir() { window.print(); },
  },
  template: `
  <section class="historico-pagina">
    <div class="titulo-pagina">
      <h1>Histórico</h1>
      <div class="acoes" v-if="alvo"><button @click="csv">Baixar planilha (CSV)</button><button @click="imprimir">Imprimir / PDF</button></div>
    </div>
    <div class="filtros nao-imprimir">
      <div class="alternador" style="margin:0">
        <label><input type="radio" value="imovel" v-model="modo"> Por imóvel</label>
        <label><input type="radio" value="inquilino" v-model="modo"> Por inquilino</label>
      </div>
      <select v-model="alvo" style="flex:1 1 300px" aria-label="Escolha"><option value="">{{ modo === 'imovel' ? 'Escolha o imóvel…' : 'Escolha o inquilino…' }}</option>
        <option v-for="o in opcoes" :value="o.id">{{ o.rot }}</option></select>
    </div>

    <p v-if="!alvo" class="vazio">Escolha um imóvel ou inquilino para ver contratos, pagamentos, atrasos e acontecimentos.</p>
    <template v-else>
      <div class="cartao">
        <template v-if="imovel">
          <h2>Ref. {{ imovel.ref }} — {{ imovel.descricao }}</h2>
          <p class="sub-info">{{ imovel.endereco }} · {{ imovel.tipo }} · <Chip :status="situacaoImovel(db, imovel)" /> · valor de mercado {{ fmtMoeda(imovel.valorMercado) }}
            · <a :href="'#/imovel/' + imovel.id">abrir ficha</a></p>
        </template>
        <template v-else-if="inquilino">
          <h2>{{ inquilino.nome }}</h2>
          <p class="sub-info">{{ inquilino.tipo === 'PJ' ? 'CNPJ' : 'CPF' }} {{ fmtCpfCnpj(inquilino.cpfCnpj) || '—' }} · {{ inquilino.telefone || 'sem telefone' }} · {{ inquilino.email || 'sem e-mail' }}
            · <a :href="'#/inquilino/' + inquilino.id">abrir cadastro</a></p>
        </template>
        <div class="kpis compactos">
          <Kpi rotulo="Contratos" :valor="contratos.length" :sub="contratos.filter(c => c.status === 'ativo').length + ' ativo(s)'" />
          <Kpi rotulo="Recebido (controle)" :valor="fmtMoeda(resumo.recebido)" :sub="resumo.pagos + ' de ' + resumo.meses + ' meses pagos'" tom="bom" />
          <Kpi rotulo="Pontualidade" :valor="resumo.pontualidade != null ? resumo.pontualidade + '%' : '—'" :sub="resumo.pagosComAtraso + ' com atraso · média ' + resumo.atrasoMedio + ' dia(s)'" />
          <Kpi rotulo="Em aberto hoje" :valor="fmtMoeda(resumo.valorEmAberto)" :sub="resumo.emAberto + ' mês(es) + ' + fmtMoeda(resumo.encargosEmAberto) + ' de encargos'" :tom="resumo.emAberto ? 'ruim' : ''" />
          <Kpi rotulo="Multa/juros não recebidos" :valor="fmtMoeda(resumo.naoRecebido)" :sub="fmtMoeda(resumo.encargosCobrados) + ' cobrados de ' + fmtMoeda(resumo.encargosDevidos)" :tom="resumo.naoRecebido > 0 ? 'ruim' : ''" />
          <Kpi v-if="imovel && ocupacao" rotulo="Ocupação" :valor="ocupacao.pct + '%'" :sub="ocupacao.ocupados + ' de ' + ocupacao.total + ' meses com contrato'" />
          <Kpi v-if="imovel" rotulo="Despesas" :valor="fmtMoeda(totalDespesas)" :sub="despesas.length + ' lançamento(s)'" />
          <Kpi v-if="imovel && imovel.valorMercado" rotulo="Rentabilidade (12 meses)" :valor="fmtPct((recebido12m - despesas.filter(d => d.data >= somaMeses(mesAtual(), -11)).reduce((s, d) => s + Number(d.valor), 0)) / imovel.valorMercado * 100)" sub="recebido menos despesas ÷ valor de mercado" />
        </div>
      </div>

      <div class="cartao">
        <h2>Contratos</h2>
        <p v-if="!contratos.length" class="vazio">Nenhum contrato cadastrado.</p>
        <table v-else class="tabela">
          <thead><tr><th>{{ modo === 'imovel' ? 'Inquilino' : 'Imóvel' }}</th><th>Início</th><th>Fim / encerramento</th><th class="num">Aluguel inicial</th><th class="num">Aluguel atual</th><th>Garantia</th><th>Status</th></tr></thead>
          <tbody><tr v-for="c in contratos" :key="c.id" class="clicavel" @click="ir('#/contrato/' + c.id)">
            <td>{{ rotulo(c) }}</td><td>{{ fmtData(c.dataInicio) }}</td>
            <td>{{ fmtData(c.status === 'encerrado' ? (c.dataEncerramento || fimContrato(c)) : fimContrato(c)) }}<small v-if="c.motivoEncerramento"><br>{{ c.motivoEncerramento }}</small></td>
            <td class="num">{{ fmtMoeda(c.valorInicial) }}</td><td class="num">{{ fmtMoeda(valorVigente(c)) }}</td>
            <td><small>{{ c.garantia?.tipo === 'fiador' ? 'Fiança: ' + ((c.garantia.fiadores || []).map(f => f.nome).filter(Boolean).join(', ') || '—') : (TIPOS_GARANTIA[c.garantia?.tipo] || '—') }}</small></td>
            <td><Chip :status="c.status" /></td></tr></tbody>
        </table>
      </div>

      <div class="cartao">
        <div class="cab-cartao"><h2>Pagamentos e atrasos</h2>
          <label class="check nao-imprimir"><input type="checkbox" v-model="soAtrasos"> Só atrasos e pendências</label></div>
        <p v-if="!cobrancas.length" class="vazio">Sem pagamentos controlados. Lance o histórico no contrato ("Lançar histórico de pagamentos").</p>
        <table v-else class="tabela compacta">
          <thead><tr><th>Mês</th><th v-if="contratos.length > 1">{{ modo === 'imovel' ? 'Inquilino' : 'Imóvel' }}</th><th>Venc.</th><th class="num">Aluguel</th><th>Pago em</th><th class="num">Pago</th><th class="num">Atraso</th><th class="num">Multa/juros devidos</th><th class="num">Cobrado</th><th class="num">Não recebido</th><th>Situação</th></tr></thead>
          <tbody><tr v-for="x in linhasPag" :key="x.contrato.id + x.competencia">
            <td>{{ fmtMes(x.competencia) }}</td><td v-if="contratos.length > 1"><small>{{ rotulo(x.contrato) }}</small></td>
            <td>{{ fmtData(x.vencimento) }}</td><td class="num">{{ fmtMoeda(x.valor) }}</td>
            <td>{{ fmtData(x.pagamento?.dataPagamento) }}</td><td class="num">{{ x.pagamento ? fmtMoeda(x.pagamento.valorPago) : '' }}</td>
            <td class="num">{{ x.encargos.dias ? x.encargos.dias + ' d' : '' }}</td>
            <td class="num">{{ x.encargos.total ? fmtMoeda(x.encargos.total) : '' }}</td>
            <td class="num">{{ x.pagamento?.acrescimos ? fmtMoeda(x.pagamento.acrescimos) : '' }}</td>
            <td class="num" :class="{ 'texto-ruim': naoRecebido(x) > 0 }">{{ naoRecebido(x) ? fmtMoeda(naoRecebido(x)) : '' }}</td>
            <td><Chip :status="x.status" /></td></tr></tbody>
        </table>
        <button v-if="!verTodos && (soAtrasos ? cobrancas.filter(x => x.pagoComAtraso || x.status === 'atrasado').length : cobrancas.length) > 36" class="pequeno nao-imprimir" @click="verTodos = true">Ver todos</button>
      </div>

      <div class="cartao">
        <h2>Linha do tempo</h2>
        <p v-if="!eventos.length" class="vazio">Nenhum acontecimento registrado.</p>
        <ul v-else class="linha-tempo">
          <li v-for="(e, k) in eventos" :key="k"><span class="lt-data">{{ fmtData(e.data) }}</span><span class="chip">{{ e.tipo }}</span>
            <a v-if="e.webUrl" :href="e.webUrl" target="_blank" rel="noopener">{{ e.texto }}</a><span v-else>{{ e.texto }}</span></li>
        </ul>
      </div>
    </template>
  </section>`,
};
