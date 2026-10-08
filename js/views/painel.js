import { app, db, helpers, Kpi, Chip } from './comum.js';
import * as D from '../db.js';
import { mesAtual, somaMeses } from '../util.js';

export default {
  components: { Kpi, Chip },
  setup() { return { app, ...helpers }; },
  computed: {
    db,
    ym: () => mesAtual(),
    imoveis() { return this.db.imoveis; },
    alugados() { return this.imoveis.filter((i) => D.situacaoImovel(this.db, i) === 'Alugado'); },
    receitaMensal() { return this.imoveis.reduce((s, i) => s + D.aluguelImovel(this.db, i), 0); },
    valorMercado() { return this.imoveis.reduce((s, i) => s + (Number(i.valorMercado) || 0), 0); },
    cobrancas() { return D.cobrancasDoMes(this.db, this.ym); },
    esperadoMes() { return this.cobrancas.reduce((s, c) => s + c.valor, 0); },
    recebidoMes() { return this.cobrancas.reduce((s, c) => s + (Number(c.pagamento?.valorPago) || 0), 0); },
    atrasos() { return D.cobrancasEmAtraso(this.db); },
    totalAtraso() { return this.atrasos.reduce((s, c) => s + c.valor - (Number(c.pagamento?.valorPago) || 0), 0); },
    alertas() { return D.alertas(this.db); },
    contratos() { return this.db.contratos.filter(D.contratoAtivo).length; },
    proximosReajustes() {
      const lim = somaMeses(mesAtual(), 3);
      return this.db.contratos.filter(D.contratoAtivo)
        .map((c) => ({ c, mes: D.proximoReajuste(c), inq: D.porId(this.db.inquilinos, c.inquilinoId), im: D.porId(this.db.imoveis, c.imovelId) }))
        .filter((x) => x.mes && x.mes <= lim)
        .sort((a, b) => a.mes.localeCompare(b.mes));
    },
    semLocacao() {
      return this.imoveis.map((i) => ({ i, sit: D.situacaoImovel(this.db, i) }))
        .filter((x) => ['Vago', 'Em reforma'].includes(x.sit) && ['Loja', 'Sala', 'Apartamento', 'Casa', 'Comercial', 'Galpão'].includes(x.i.tipo));
    },
    porCidade() {
      const m = {};
      for (const i of this.imoveis) {
        const k = i.cidade ? `${i.cidade}/${i.uf}` : 'Sem cidade';
        m[k] ||= { cidade: k, qtd: 0, mercado: 0, aluguel: 0 };
        m[k].qtd++;
        m[k].mercado += Number(i.valorMercado) || 0;
        m[k].aluguel += D.aluguelImovel(this.db, i);
      }
      return Object.values(m).sort((a, b) => b.mercado - a.mercado);
    },
  },
  template: `
  <section>
    <div class="titulo-pagina"><h1>Painel</h1><span class="sub">{{ fmtMesLongo(ym) }}</span></div>

    <div class="kpis">
      <Kpi rotulo="Imóveis" :valor="imoveis.length" :sub="alugados.length + ' alugados · ' + (imoveis.length - alugados.length) + ' sem locação'" />
      <Kpi rotulo="Aluguel mensal" :valor="fmtMoeda(receitaMensal)" :sub="contratos + ' contratos no sistema'" />
      <Kpi rotulo="Recebido no mês" :valor="fmtMoeda(recebidoMes)" :sub="'de ' + fmtMoeda(esperadoMes) + ' esperados (contratos)'" />
      <Kpi rotulo="Em atraso" :valor="fmtMoeda(totalAtraso)" :sub="atrasos.length + ' cobrança(s)'" :tom="atrasos.length ? 'ruim' : ''" />
      <Kpi rotulo="Valor de mercado" :valor="fmtMoeda(valorMercado)" :sub="'Rentabilidade ' + fmtPct(valorMercado ? receitaMensal * 12 / valorMercado * 100 : 0) + ' a.a.'" />
    </div>

    <div class="grade-2">
      <div class="cartao">
        <h2>Atenção</h2>
        <p v-if="!alertas.length" class="vazio">Nenhum alerta. Tudo em dia.</p>
        <ul class="alertas">
          <li v-for="(a, k) in alertas" :key="k" :class="a.tipo"><a :href="a.link">{{ a.texto }}</a></li>
        </ul>
      </div>
      <div class="cartao">
        <h2>Próximos reajustes</h2>
        <p v-if="!proximosReajustes.length" class="vazio">Nenhum reajuste nos próximos 3 meses.</p>
        <table v-else class="tabela compacta">
          <thead><tr><th>Mês</th><th>Inquilino</th><th>Índice</th><th class="num">Aluguel atual</th></tr></thead>
          <tbody>
            <tr v-for="x in proximosReajustes" :key="x.c.id" class="clicavel" @click="ir('#/reajustes?contrato=' + x.c.id)">
              <td>{{ fmtMes(x.mes) }}</td><td>{{ x.inq?.nome }}<br><small>Ref. {{ x.im?.ref }}</small></td>
              <td>{{ x.c.indice }}</td><td class="num">{{ fmtMoeda(valorVigente(x.c)) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="cartao" v-if="semLocacao.length">
      <h2>Imóveis edificados sem locação</h2>
      <table class="tabela compacta">
        <tbody><tr v-for="{ i, sit } in semLocacao" :key="i.id" class="clicavel" @click="ir('#/imovel/' + i.id)">
          <td>Ref. {{ i.ref }}</td><td class="desc">{{ i.descricao }}</td><td><Chip :status="sit" /></td></tr></tbody>
      </table>
      <p class="dica">Lotes, terrenos e áreas rurais não entram nesta lista.</p>
    </div>

    <div class="cartao">
      <h2>Patrimônio por cidade</h2>
      <table class="tabela">
        <thead><tr><th>Cidade</th><th class="num">Imóveis</th><th class="num">Valor de mercado</th><th class="num">Aluguel mensal</th><th class="barra-col"></th></tr></thead>
        <tbody>
          <tr v-for="c in porCidade" :key="c.cidade">
            <td>{{ c.cidade }}</td><td class="num">{{ c.qtd }}</td><td class="num">{{ fmtMoeda(c.mercado) }}</td>
            <td class="num">{{ fmtMoeda(c.aluguel) }}</td>
            <td class="barra-col"><span class="barra" :style="{ width: (c.mercado / porCidade[0].mercado * 100) + '%' }"></span></td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>`,
};
