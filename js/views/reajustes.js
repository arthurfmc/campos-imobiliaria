import { app, db, helpers, avisar, imprimir } from './comum.js';
import { gerarNotificacaoDocx, reajustesPendentes, aplicarReajustes } from './acoes.js';
import * as D from '../db.js';
import { INDICES, carregarIndices, calcularReajuste, periodoSugerido, ultimoMesDisponivel } from '../indices.js';
import { notificacaoBlocos } from '../documentos.js';
import { novoId, mesAtual, somaMeses, hojeISO } from '../util.js';

export const Reajustes = {
  props: { query: Object },
  setup() { return { app, ...helpers, INDICES, ultimoMesDisponivel }; },
  data() {
    const fim = somaMeses(mesAtual(), -1);
    return {
      contratoId: '', indice: 'IGP-M', valor: 1000, ini: somaMeses(fim, -11), fim,
      naoNegativo: true, vigenciaDesde: mesAtual(), gerarNotificacao: true, atualizando: false, ocupado: false, selecionados: [],
    };
  },
  created() {
    this.naoNegativo = this.db.config.naoAplicarIndiceNegativo !== false;
    if (this.query?.contrato) this.contratoId = this.query.contrato;
    else this.ajustarPeriodo();
  },
  computed: {
    db,
    indices() { return app.indices; },
    mapa() { return this.indices?.[this.indice]; },
    ultimo() { return ultimoMesDisponivel(this.mapa); },
    contratos() {
      return this.db.contratos.filter(D.contratoAtivo)
        .map((c) => ({ c, inq: D.porId(this.db.inquilinos, c.inquilinoId), im: D.porId(this.db.imoveis, c.imovelId) }))
        .sort((a, b) => (a.im?.ref || 0) - (b.im?.ref || 0));
    },
    contrato() { return D.porId(this.db.contratos, this.contratoId); },
    resultado() {
      if (!this.mapa || !this.ini || !this.fim || this.ini > this.fim) return null;
      return calcularReajuste(this.mapa, this.valor, this.ini, this.fim, this.naoNegativo);
    },
    comparacao() {
      if (!this.indices || !this.ini || !this.fim || this.ini > this.fim) return [];
      return Object.keys(INDICES).map((k) => ({ k, r: calcularReajuste(this.indices[k], this.valor, this.ini, this.fim, this.naoNegativo) }));
    },
    previstos() { return reajustesPendentes(this.db, this.indices, this.naoNegativo); },
    selecionaveis() { return this.previstos.filter((x) => !x.r.faltando.length); },
    semNotificacao() {
      const lista = [];
      for (const c of this.db.contratos.filter(D.contratoAtivo)) {
        for (const r of c.reajustes) {
          if (r.tipo === 'indice' && !r.notificadoEm && r.vigenciaDesde >= somaMeses(mesAtual(), -3)) {
            lista.push({ c, r, inq: D.porId(this.db.inquilinos, c.inquilinoId), im: D.porId(this.db.imoveis, c.imovelId) });
          }
        }
      }
      return lista;
    },
  },
  watch: {
    contratoId() { this.carregarContrato(); },
    indices(novo, antigo) {
      if (!novo || antigo) return;
      if (this.contrato) this.carregarContrato(); else this.ajustarPeriodo();
    },
  },
  mounted() { if (this.contratoId) this.carregarContrato(); },
  methods: {
    carregarContrato() {
      const c = this.contrato;
      if (!c) return;
      this.indice = c.indice;
      this.valor = D.valorVigente(c);
      this.vigenciaDesde = D.proximoReajuste(c) || mesAtual();
      this.ajustarPeriodo(this.vigenciaDesde);
    },
    ajustarPeriodo(mesReajuste = mesAtual()) {
      if (!this.mapa) return;
      const p = periodoSugerido(this.mapa, mesReajuste);
      this.ini = p.ini; this.fim = p.fim;
    },
    todos(ev) { this.selecionados = ev.target.checked ? this.selecionaveis.map((x) => x.c.id) : []; },
    async aplicarSelecionados() {
      const itens = this.previstos.filter((x) => this.selecionados.includes(x.c.id) && !x.r.faltando.length);
      if (!itens.length) return;
      if (!confirm(`Aplicar ${itens.length} reajuste(s)?${this.gerarNotificacao ? ' As notificações serão geradas em seguida.' : ''}`)) return;
      const lote = aplicarReajustes(itens);
      this.selecionados = [];
      avisar(`${lote.length} reajuste(s) aplicado(s).`);
      if (this.gerarNotificacao) {
        this.ocupado = true;
        for (const { cid, reaj } of lote) {
          try { await gerarNotificacaoDocx(cid, reaj.id); } catch (e) { avisar('Erro ao gerar notificação: ' + e.message, 'erro'); }
        }
        this.ocupado = false;
      }
    },
    async notificar(x) {
      this.ocupado = true;
      try { await gerarNotificacaoDocx(x.c.id, x.r.id); } catch (e) { avisar('Erro: ' + e.message, 'erro'); }
      this.ocupado = false;
    },
    ultimos12() { this.ajustarPeriodo(somaMeses(this.ultimo || mesAtual(), 1)); },
    async atualizar() {
      this.atualizando = true;
      try { app.indices = await carregarIndices(true); app.indicesErro = ''; avisar('Índices atualizados.'); } catch (e) { app.indicesErro = e.message; }
      this.atualizando = false;
    },
    reajusteObj() {
      const r = this.resultado;
      return { id: novoId(), tipo: 'indice', indice: this.indice, periodoIni: this.ini, periodoFim: this.fim,
        pct: r.pct, pctAplicado: r.pctAplicado, valorAnterior: r.valorAnterior, valorNovo: r.valorNovo,
        vigenciaDesde: this.vigenciaDesde, meses: r.meses, dataNotificacao: hojeISO(),
        aplicadoEm: new Date().toISOString(), aplicadoPor: app.usuario };
    },
    async aplicar() {
      const c = this.contrato;
      const r = this.resultado;
      if (!c || !r) return;
      if (r.faltando.length) { avisar(`Faltam índices de: ${r.faltando.map(this.fmtMes).join(', ')}`, 'erro'); return; }
      if (c.reajustes?.some((x) => x.vigenciaDesde === this.vigenciaDesde)) {
        if (!confirm(`Já existe um reajuste com vigência em ${this.fmtMes(this.vigenciaDesde)}. Substituir?`)) return;
      }
      const reaj = this.reajusteObj();
      const inq = D.porId(this.db.inquilinos, c.inquilinoId);
      app.store.commit(`Reajuste ${reaj.indice} ${this.fmtPct(reaj.pctAplicado)} aplicado: ${inq?.nome} (${this.fmtMoeda(reaj.valorAnterior)} → ${this.fmtMoeda(reaj.valorNovo)})`, (d) => {
        const cc = D.porId(d.contratos, c.id);
        cc.reajustes = (cc.reajustes || []).filter((x) => x.vigenciaDesde !== reaj.vigenciaDesde);
        cc.reajustes.push(reaj);
      });
      avisar('Reajuste aplicado ao contrato.');
      if (this.gerarNotificacao) {
        this.ocupado = true;
        try { await gerarNotificacaoDocx(c.id, reaj.id); } catch (e) { avisar('Erro ao gerar notificação: ' + e.message, 'erro'); }
        this.ocupado = false;
      }
    },
    imprimirPrevia() {
      if (!this.contrato || !this.resultado) return;
      imprimir(notificacaoBlocos(this.db, this.contrato, this.reajusteObj()), 'Notificação de reajuste');
    },
  },
  template: `
  <section>
    <div class="titulo-pagina">
      <h1>Reajustes</h1>
      <div class="status-indices">
        <small v-if="indices">IGP-M até {{ fmtMes(ultimoMesDisponivel(indices['IGP-M'])) }} · IPCA até {{ fmtMes(ultimoMesDisponivel(indices['IPCA'])) }}</small>
        <small v-if="indices?.aviso" class="erro-campo">{{ indices.aviso }}</small>
        <small v-if="app.indicesErro" class="erro-campo">{{ app.indicesErro }}</small>
        <button class="pequeno" @click="atualizar" :disabled="atualizando">{{ atualizando ? 'Atualizando…' : 'Atualizar índices' }}</button>
      </div>
    </div>

    <div class="cartao" v-if="previstos.length">
      <div class="cab-cartao"><h2>Reajustes a fazer (até {{ fmtMes(somaMeses(mesAtual(), 2)) }})</h2>
        <div class="linha-botoes">
          <label class="check"><input type="checkbox" v-model="gerarNotificacao"> gerar notificações</label>
          <button class="primario pequeno" :disabled="!selecionados.length || ocupado" @click="aplicarSelecionados">Aplicar selecionados ({{ selecionados.length }})</button>
        </div></div>
      <table class="tabela">
        <thead><tr><th><input type="checkbox" @change="todos" :checked="selecionados.length && selecionados.length === selecionaveis.length" aria-label="Selecionar todos"></th>
          <th>Mês</th><th>Inquilino</th><th>Índice</th><th>Período</th><th class="num">Atual</th><th class="num">Variação</th><th class="num">Novo</th><th></th></tr></thead>
        <tbody><tr v-for="x in previstos" :key="x.c.id" :class="{ selecionada: x.c.id === contratoId }">
          <td><input type="checkbox" :value="x.c.id" v-model="selecionados" :disabled="!!x.r.faltando.length" aria-label="Selecionar"></td>
          <td :class="{ 'texto-ruim': x.mes < mesAtual() }">{{ fmtMes(x.mes) }}</td><td>{{ x.inq?.nome }}<br><small>Ref. {{ x.im?.ref }}</small></td>
          <td>{{ x.c.indice }}</td><td>{{ fmtMes(x.per.ini) }} a {{ fmtMes(x.per.fim) }}<small v-if="x.r.faltando.length" class="erro-campo"> faltam {{ x.r.faltando.length }} mês(es)</small></td>
          <td class="num">{{ fmtMoeda(x.r.valorAnterior) }}</td><td class="num">{{ fmtPct(x.r.pct) }}</td><td class="num">{{ fmtMoeda(x.r.valorNovo) }}</td>
          <td><button class="pequeno" @click="contratoId = x.c.id">Detalhar</button></td></tr></tbody>
      </table>
      <p class="dica">{{ db.config.reajusteAutomatico ? 'Reajuste automático LIGADO: no mês do aniversário o sistema aplica sozinho.' : 'Dica: em Configurações você pode ligar o reajuste automático no mês do aniversário.' }}</p>
    </div>

    <div class="cartao" v-if="semNotificacao.length">
      <h2>Reajustes aplicados sem notificação gerada</h2>
      <table class="tabela compacta">
        <tbody><tr v-for="x in semNotificacao" :key="x.r.id">
          <td>{{ x.inq?.nome }} <small>Ref. {{ x.im?.ref }}</small></td><td>{{ fmtMes(x.r.vigenciaDesde) }}</td>
          <td class="num">{{ fmtMoeda(x.r.valorAnterior) }} → {{ fmtMoeda(x.r.valorNovo) }}</td>
          <td><small v-if="x.r.automatico" class="chip">automático</small></td>
          <td class="acoes-linha"><button class="pequeno" @click="notificar(x)" :disabled="ocupado">Gerar notificação</button></td></tr></tbody>
      </table>
    </div>

    <div class="grade-calc">
      <div class="cartao">
        <h2>Calculadora</h2>
        <div class="form-grid">
          <label class="c6">Contrato (opcional)<select v-model="contratoId"><option value="">— Cálculo avulso —</option>
            <option v-for="x in contratos" :value="x.c.id">Ref. {{ x.im?.ref }} · {{ x.inq?.nome }} · {{ fmtMoeda(valorVigente(x.c)) }}</option></select></label>
          <div class="c6 alternador grande">
            <label v-for="(info, k) in INDICES" :key="k"><input type="radio" :value="k" v-model="indice"> {{ info.nome }}</label>
          </div>
          <label class="c2">Valor atual (R$)<input type="number" step="0.01" v-model.number="valor"></label>
          <label class="c2">Mês inicial<input type="month" v-model="ini"></label>
          <label class="c2">Mês final<input type="month" v-model="fim"></label>
          <div class="c6 linha-botoes">
            <button class="pequeno" @click="ultimos12">Últimos 12 meses disponíveis</button>
            <label class="check"><input type="checkbox" v-model="naoNegativo"> Não reduzir o aluguel se o índice for negativo</label>
          </div>
        </div>

        <div v-if="!indices" class="vazio">Carregando índices do Banco Central…</div>
        <template v-else-if="resultado">
          <div class="resultado">
            <div><span>Variação acumulada</span><strong :class="resultado.pct < 0 ? 'texto-ruim' : ''">{{ fmtPct(resultado.pct, 4) }}</strong></div>
            <div><span>Novo valor</span><strong>{{ fmtMoeda(resultado.valorNovo) }}</strong></div>
            <div><span>Diferença</span><strong>{{ fmtMoeda(resultado.diferenca) }}</strong></div>
          </div>
          <p v-if="resultado.faltando.length" class="aviso-bloco">Índice ainda não divulgado para: {{ resultado.faltando.map(fmtMes).join(', ') }}. O cálculo considera só os meses disponíveis.</p>
          <p v-if="resultado.pct < 0 && naoNegativo" class="dica">Variação negativa: o valor é mantido.</p>
          <p class="comparacao">
            <span v-for="x in comparacao" :key="x.k" :class="{ ativo: x.k === indice }">{{ x.k }}: {{ fmtPct(x.r.pct) }} → {{ fmtMoeda(x.r.valorNovo) }}<small v-if="x.r.faltando.length"> (sem {{ x.r.faltando.map(fmtMes).join(', ') }}, não divulgado)</small></span>
          </p>
        </template>
        <p v-else class="vazio">Informe um período válido.</p>

        <div v-if="contrato && resultado" class="sub-bloco">
          <h3>Aplicar ao contrato</h3>
          <div class="form-grid">
            <label class="c2">Vigente a partir de<input type="month" v-model="vigenciaDesde"></label>
            <label class="c4 check"><input type="checkbox" v-model="gerarNotificacao"> Gerar notificação de reajuste (.docx) ao aplicar</label>
          </div>
          <div class="linha-botoes">
            <button @click="imprimirPrevia">Prévia da notificação (PDF)</button>
            <button class="primario" @click="aplicar" :disabled="ocupado">Aplicar reajuste</button>
          </div>
        </div>
      </div>

      <div class="cartao" v-if="resultado">
        <h2>{{ indice }} mês a mês</h2>
        <table class="tabela compacta">
          <thead><tr><th>Mês</th><th class="num">No mês</th><th class="num">Acumulado</th></tr></thead>
          <tbody><tr v-for="m in resultado.meses" :key="m.mes">
            <td>{{ fmtMes(m.mes) }}</td><td class="num" :class="m.pct < 0 ? 'texto-ruim' : ''">{{ fmtPct(m.pct) }}</td><td class="num">{{ fmtPct(m.acumulado, 4) }}</td></tr></tbody>
        </table>
        <p class="dica">Fonte: Banco Central do Brasil (SGS) — séries {{ INDICES['IGP-M'].serie }} (IGP-M) e {{ INDICES['IPCA'].serie }} (IPCA).</p>
      </div>
    </div>
  </section>`,
};
