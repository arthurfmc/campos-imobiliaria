// Importação da planilha de pagamentos (ex.: "Pagamentos 2026.xlsx").
import { app, db, helpers, Modal, avisar } from './comum.js';
import * as D from '../db.js';
import { novoId } from '../util.js';

const XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm';
const COLS = { mes: 'Mês', data: 'Data do pagamento', valor: 'Valor pago (R$)', acresc: 'Multa/juros cobrados (R$)', forma: 'Forma', obs: 'Observação', codigo: 'Código (não alterar)' };

// Data do Excel (número de série ou texto dd/mm/aaaa) -> 'AAAA-MM-DD'
function dataISO(v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5).toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : 'invalida';
}
const num = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[R$\s]/g, '');
  return Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s) || 0;
};

export async function lerPlanilha(arquivo) {
  const XLSX = await import(XLSX_URL);
  const wb = XLSX.read(await arquivo.arrayBuffer(), { type: 'array' });
  for (const nome of wb.SheetNames) {
    const linhas = XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, raw: true, blankrows: false });
    const cab = (linhas[0] || []).map((x) => String(x ?? '').trim());
    const idx = Object.fromEntries(Object.entries(COLS).map(([k, h]) => [k, cab.indexOf(h)]));
    if (idx.codigo < 0 || idx.mes < 0 || idx.data < 0 || idx.valor < 0) continue;
    return { aba: nome, linhas: linhas.slice(1).map((l, k) => ({
      linha: k + 2, codigo: String(l[idx.codigo] ?? '').trim(), mes: String(l[idx.mes] ?? '').trim(),
      data: dataISO(l[idx.data]), valor: num(l[idx.valor]), acresc: idx.acresc >= 0 ? num(l[idx.acresc]) : 0,
      forma: idx.forma >= 0 ? String(l[idx.forma] ?? '').trim() : '', obs: idx.obs >= 0 ? String(l[idx.obs] ?? '').trim() : '',
    })) };
  }
  throw new Error('Não encontrei a aba com as colunas "Mês", "Data do pagamento", "Valor pago (R$)" e "Código (não alterar)".');
}

// Compara a planilha com os pagamentos já registrados.
export function analisar(d, linhas, indices) {
  const res = { novos: [], atualizados: [], iguais: 0, semData: 0, problemas: [] };
  for (const l of linhas) {
    if (!l.codigo) continue;
    if (!l.data) { res.semData++; continue; }
    const c = D.porId(d.contratos, l.codigo);
    if (!c) { res.problemas.push({ ...l, motivo: 'contrato não encontrado (código alterado?)' }); continue; }
    if (!/^\d{4}-\d{2}$/.test(l.mes)) { res.problemas.push({ ...l, motivo: `mês "${l.mes}" inválido` }); continue; }
    if (l.data === 'invalida') { res.problemas.push({ ...l, motivo: 'data do pagamento inválida' }); continue; }
    if (!(l.valor > 0)) { res.problemas.push({ ...l, motivo: 'data preenchida sem valor pago' }); continue; }
    const [cob] = D.cobrancasDoMes({ ...d, contratos: [{ ...c, controleDesde: l.mes, status: 'ativo' }] }, l.mes, indices);
    const venc = cob?.vencimento || `${l.mes}-${String(c.diaVencimento).padStart(2, '0')}`;
    const esperado = cob?.valor ?? D.valorVigente(c, l.mes);
    const enc = D.calcularEncargos(c, esperado, venc, l.data, indices);
    const item = { ...l, contrato: c, inq: D.porId(d.inquilinos, c.inquilinoId), venc, esperado, enc,
      existente: d.pagamentos.find((p) => p.contratoId === c.id && p.competencia === l.mes) };
    if (!item.existente) res.novos.push(item);
    else if (item.existente.dataPagamento !== l.data || Number(item.existente.valorPago) !== l.valor
      || Number(item.existente.acrescimos || 0) !== l.acresc || (l.forma && item.existente.forma !== l.forma)
      || (l.obs && item.existente.observacao !== l.obs)) res.atualizados.push(item);
    else res.iguais++;
  }
  return res;
}

export const ImportarModal = {
  components: { Modal },
  emits: ['fechar'],
  setup() { return { app, ...helpers }; },
  data() { return { arquivo: null, lendo: false, erro: '', aba: '', r: null }; },
  computed: {
    db,
    todos() { return this.r ? [...this.r.novos, ...this.r.atualizados] : []; },
    naoRecebido() { return this.todos.reduce((s, x) => s + Math.max(0, x.enc.total - x.acresc), 0); },
  },
  methods: {
    async escolher(ev) {
      const f = ev.target.files[0];
      ev.target.value = '';
      if (!f) return;
      this.arquivo = f.name; this.lendo = true; this.erro = ''; this.r = null;
      try {
        const { aba, linhas } = await lerPlanilha(f);
        this.aba = aba;
        this.r = analisar(this.db, linhas, app.indices);
      } catch (e) { this.erro = e.message; }
      this.lendo = false;
    },
    importar() {
      const itens = this.todos.map((x) => ({
        pag: { ...(x.existente || { id: novoId(), contratoId: x.contrato.id, competencia: x.mes, descontos: 0 }),
          dataPagamento: x.data, valorPago: x.valor, acrescimos: x.acresc, forma: x.forma || x.existente?.forma || 'PIX',
          observacao: x.obs || x.existente?.observacao || '', registradoPor: app.usuario, registradoEm: new Date().toISOString(), origem: this.arquivo },
        cid: x.contrato.id, mes: x.mes }));
      const n = itens.length;
      app.store.commit(`Importação de pagamentos (${this.arquivo}): ${this.r.novos.length} novo(s), ${this.r.atualizados.length} atualizado(s)`, (d) => {
        for (const { pag, cid, mes } of itens) {
          const atual = d.pagamentos.find((p) => p.contratoId === cid && p.competencia === mes);
          if (atual) Object.assign(atual, pag, { id: atual.id }); else d.pagamentos.push(pag);
          const c = D.porId(d.contratos, cid);
          if (c && (!c.controleDesde || mes < c.controleDesde)) c.controleDesde = mes;
        }
      });
      avisar(`${n} pagamento(s) importado(s).`);
      this.$emit('fechar');
    },
  },
  template: `
  <Modal titulo="Importar planilha de pagamentos" largo @fechar="$emit('fechar')">
    <p style="margin-top:0">Escolha a planilha preenchida (por exemplo <code>Pagamentos 2026.xlsx</code>, na pasta Imobiliaria do OneDrive). Nada é gravado antes de você confirmar.</p>
    <label class="botao" :class="{ desativado: lendo }"><input type="file" accept=".xlsx,.xls" @change="escolher" hidden :disabled="lendo">{{ lendo ? 'Lendo…' : (arquivo ? 'Escolher outro arquivo' : 'Escolher planilha') }}</label>
    <p v-if="erro" class="erro-campo">{{ erro }}</p>
    <template v-if="r">
      <p class="resumo-pag" style="margin-top:12px">Aba <b>{{ aba }}</b>: <b>{{ r.novos.length }}</b> pagamento(s) novo(s), <b>{{ r.atualizados.length }}</b> para atualizar,
        {{ r.iguais }} já iguais no sistema, {{ r.semData }} mês(es) sem data (ignorados)<span v-if="r.problemas.length" class="texto-ruim">, {{ r.problemas.length }} com problema</span>.</p>
      <div v-if="r.problemas.length" class="aviso-bloco erro" style="margin:8px 0">
        <b>Linhas com problema (não serão importadas):</b>
        <div v-for="p in r.problemas.slice(0, 10)" :key="p.linha">Linha {{ p.linha }}: {{ p.motivo }}</div>
      </div>
      <div v-if="todos.length" style="overflow-x:auto; max-height:360px; overflow-y:auto">
        <table class="tabela compacta">
          <thead><tr><th></th><th>Inquilino</th><th>Mês</th><th>Venc.</th><th class="num">Aluguel</th><th>Pago em</th><th class="num">Pago</th><th class="num">Atraso</th><th class="num">Multa/juros devidos</th><th class="num">Cobrado</th></tr></thead>
          <tbody><tr v-for="x in todos" :key="x.codigo + x.mes">
            <td><span class="chip" :class="x.existente ? 'chip-parcial' : 'chip-ativo'">{{ x.existente ? 'atualizar' : 'novo' }}</span></td>
            <td>{{ x.inq?.nome }}</td><td>{{ fmtMes(x.mes) }}</td><td>{{ fmtData(x.venc) }}</td><td class="num">{{ fmtMoeda(x.esperado) }}</td>
            <td>{{ fmtData(x.data) }}</td><td class="num">{{ fmtMoeda(x.valor) }}</td><td class="num">{{ x.enc.dias ? x.enc.dias + ' d' : '' }}</td>
            <td class="num">{{ x.enc.total ? fmtMoeda(x.enc.total) : '' }}</td><td class="num">{{ x.acresc ? fmtMoeda(x.acresc) : '' }}</td></tr></tbody>
        </table>
      </div>
      <p v-if="naoRecebido > 0.009" class="dica">Pela regra dos contratos, estes pagamentos somam <b>{{ fmtMoeda(naoRecebido) }}</b> de multa/juros não cobrados (com correção monetária).</p>
    </template>
    <template #rodape>
      <button @click="$emit('fechar')">Cancelar</button>
      <button class="primario" :disabled="!todos.length" @click="importar">Importar {{ todos.length }} pagamento(s)</button>
    </template>
  </Modal>`,
};
