import { app, db, helpers, Chip, Modal, avisar, ir, imprimir } from './comum.js';
import { gerarContratoDocx, gerarNotificacaoDocx, gerarReciboDocx, gerarVistoriaDocx, gerarAditivoDocx, blocosVistoria, pastaDoContrato } from './acoes.js';
import { VistoriaModal, AditivoModal } from './vistoria.js';
import { Anexos } from './anexos.js';
import { MoverArquivosModal } from './pastas.js';
import { INDICES } from '../indices.js';
import { InquilinoForm, inquilinoVazio, validarInquilino } from './inquilinos.js';
import { PagamentoModal, HistoricoModal } from './financeiro.js';
import * as D from '../db.js';
import { notificacaoBlocos, aditivoBlocos, foroDe } from '../documentos.js';
import { contratoBlocos, TIPOS_GARANTIA } from '../modelos.js';
import { clone, novoId, hojeISO, mesAtual, somaMeses, somaMesesData, diaMenos1, arred2 } from '../util.js';

function contratoVazio(db0, query) {
  const hoje = hojeISO();
  const imovel = query?.imovel ? D.porId(db0.imoveis, query.imovel) : null;
  const loja = imovel && !['Apartamento', 'Casa'].includes(imovel.tipo);
  return {
    id: novoId(), imovelId: imovel?.id || '', inquilinoId: query?.inquilino || '', unidade: '',
    finalidade: imovel ? (loja ? 'comercial' : 'residencial') : 'comercial', atividade: '',
    dataInicio: hoje, prazoMeses: loja ? 36 : 30, dataFim: '', diaVencimento: Number(hoje.slice(8, 10)) > 28 ? 5 : Number(hoje.slice(8, 10)),
    valorInicial: Number(imovel?.aluguelPlanilha) || 0, indice: 'IGP-M', periodicidadeMeses: 12,
    formaPagamento: 'PIX ou depósito bancário', dadosBancarios: '', foro: '',
    encargos: { iptu: true, condominio: false, agua: true, luz: true, seguro: false },
    garantia: D.normalizarGarantia({ tipo: 'fiador', fiadores: [D.fiadorVazio()] }),
    atraso: D.regrasAtrasoPadrao(db0.config, {}),
    controleDesde: mesAtual(), dataAssinatura: hoje, clausulasAdicionais: '', observacoes: '',
    status: 'ativo', reajustes: [], documentos: [], anexos: [], aditivos: [], vistorias: [],
  };
}

// ---------------------------------------------------------------------------
export const ContratosLista = {
  components: { Chip },
  setup() { return { app, ...helpers }; },
  data() { return { status: 'ativo', busca: '' }; },
  computed: {
    db,
    linhas() {
      const b = this.busca.trim().toLowerCase();
      return this.db.contratos
        .filter((c) => !this.status || c.status === this.status)
        .map((c) => ({ c, inq: D.porId(this.db.inquilinos, c.inquilinoId), im: D.porId(this.db.imoveis, c.imovelId) }))
        .filter(({ inq, im, c }) => !b || `${inq?.nome} ${im?.ref} ${im?.descricao} ${c.unidade}`.toLowerCase().includes(b))
        .sort((a, b2) => (a.im?.ref || 0) - (b2.im?.ref || 0));
    },
    total() { return this.linhas.reduce((s, x) => s + D.valorVigente(x.c), 0); },
  },
  template: `
  <section>
    <div class="titulo-pagina"><h1>Contratos</h1><button class="primario" @click="ir('#/contrato/novo')">+ Nova locação</button></div>
    <div class="filtros">
      <input v-model="busca" type="search" placeholder="Buscar inquilino ou imóvel…" aria-label="Buscar">
      <select v-model="status" aria-label="Status"><option value="ativo">Ativos</option><option value="encerrado">Encerrados</option><option value="">Todos</option></select>
    </div>
    <div class="cartao sem-padding">
      <table class="tabela">
        <thead><tr><th>Ref.</th><th>Inquilino</th><th>Imóvel</th><th>Início</th><th>Fim</th><th>Índice</th><th>Próx. reajuste</th><th class="num">Aluguel</th><th>Status</th></tr></thead>
        <tbody>
          <tr v-for="{ c, inq, im } in linhas" :key="c.id" class="clicavel" @click="ir('#/contrato/' + c.id)">
            <td>{{ im?.ref }}</td><td>{{ inq?.nome }}</td><td class="desc">{{ im?.descricao }}<small v-if="c.unidade"> · {{ c.unidade }}</small></td>
            <td>{{ fmtData(c.dataInicio) }}</td><td>{{ fmtData(fimContrato(c)) }}</td><td>{{ c.indice }}</td>
            <td>{{ c.status === 'ativo' ? fmtMes(proximoReajuste(c)) : '—' }}</td>
            <td class="num">{{ fmtMoeda(valorVigente(c)) }}</td><td><Chip :status="c.status" /></td>
          </tr>
          <tr v-if="!linhas.length"><td colspan="9" class="vazio">Nenhum contrato. Clique em “Nova locação” para cadastrar o inquilino e gerar o contrato.</td></tr>
        </tbody>
        <tfoot v-if="linhas.length"><tr><td colspan="7">{{ linhas.length }} contrato(s)</td><td class="num">{{ fmtMoeda(total) }}</td><td></td></tr></tfoot>
      </table>
    </div>
  </section>`,
};

// ---------------------------------------------------------------------------
export const ContratoForm = {
  components: { InquilinoForm },
  props: { id: String, query: Object },
  setup() { return { app, ...helpers, INDICES, TIPOS_GARANTIA, fiadorVazio: D.fiadorVazio }; },
  data() {
    return { form: null, novo: false, modoInquilino: 'existente', novoInq: inquilinoVazio(),
      emAndamento: false, valorAtual: 0, mesUltimoReajuste: '', gerando: false };
  },
  created() {
    this.novo = this.id === 'novo';
    if (this.novo) {
      this.form = contratoVazio(this.db, this.query);
      if (!this.db.inquilinos.length) this.modoInquilino = 'novo';
    } else {
      const c = D.porId(this.db.contratos, this.id);
      this.form = c ? clone(c) : null;
      if (this.form) {
        this.form.garantia = D.normalizarGarantia(this.form.garantia);
        if (this.form.garantia.tipo === 'fiador' && !this.form.garantia.fiadores.length) this.form.garantia.fiadores.push(D.fiadorVazio());
        this.form.atraso ||= D.regrasAtrasoPadrao(this.db.config, this.form);
      }
    }
  },
  computed: {
    db,
    imoveis() { return this.db.imoveis.slice().sort((a, b) => a.ref - b.ref); },
    inquilinos() { return this.db.inquilinos.slice().sort((a, b) => a.nome.localeCompare(b.nome)); },
    imovel() { return D.porId(this.db.imoveis, this.form.imovelId); },
    dataFim() {
      if (!this.form.dataInicio || !this.form.prazoMeses) return '';
      return diaMenos1(somaMesesData(this.form.dataInicio, Number(this.form.prazoMeses)));
    },
    foroPadrao() { return foroDe(this.db, { ...this.form, foro: '' }); },
    outrosContratos() {
      return this.db.contratos.filter((c) => c.imovelId === this.form.imovelId && c.id !== this.form.id && D.contratoAtivo(c));
    },
  },
  watch: {
    'form.imovelId'(id) {
      const im = D.porId(this.db.imoveis, id);
      if (this.novo && im && !this.form.valorInicial) this.form.valorInicial = Number(im.aluguelPlanilha) || 0;
    },
    'form.garantia.tipo'(t) {
      if (t === 'fiador' && !this.form.garantia.fiadores.length) this.form.garantia.fiadores.push(D.fiadorVazio());
    },
    'form.dataInicio'(v) {
      if (this.novo && v) this.form.controleDesde = v.slice(0, 7) > mesAtual() ? v.slice(0, 7) : mesAtual();
      if (this.novo && v && v < hojeISO()) this.emAndamento = true;
    },
  },
  methods: {
    validar() {
      const f = this.form;
      if (this.modoInquilino === 'novo' && this.novo) {
        const e = validarInquilino(this.novoInq);
        if (e) return e;
      } else if (!f.inquilinoId) return 'Escolha o inquilino.';
      if (!f.imovelId) return 'Escolha o imóvel.';
      if (!f.dataInicio) return 'Informe a data de início.';
      if (!(Number(f.prazoMeses) > 0)) return 'Informe o prazo em meses.';
      if (!(Number(f.valorInicial) > 0)) return 'Informe o valor do aluguel.';
      const dia = Number(f.diaVencimento);
      if (!(dia >= 1 && dia <= 31)) return 'Dia de vencimento inválido.';
      return null;
    },
    async salvar(gerar) {
      const erro = this.validar();
      if (erro) { avisar(erro, 'erro'); return; }
      const f = clone(this.form);
      f.dataFim = this.dataFim;
      const quando = new Date().toISOString();
      let inq = null;
      if (this.novo && this.modoInquilino === 'novo') {
        inq = { ...clone(this.novoInq), criadoEm: quando, criadoPor: app.usuario };
        f.inquilinoId = inq.id;
      }
      if (this.novo && this.emAndamento && Number(this.valorAtual) > 0 && Number(this.valorAtual) !== Number(f.valorInicial) && this.mesUltimoReajuste) {
        f.reajustes.push({ id: novoId(), tipo: 'manual', indice: f.indice, vigenciaDesde: this.mesUltimoReajuste,
          valorAnterior: Number(f.valorInicial), valorNovo: Number(this.valorAtual),
          pct: arred2((Number(this.valorAtual) / Number(f.valorInicial) - 1) * 100), pctAplicado: null,
          aplicadoEm: quando, aplicadoPor: app.usuario, observacao: 'Valor informado no cadastro do contrato existente' });
      }
      const nomeInq = inq?.nome || D.porId(this.db.inquilinos, f.inquilinoId)?.nome;
      const ref = this.imovel?.ref;
      if (this.novo) {
        app.store.commit(`Nova locação: ${nomeInq} — Ref. ${ref}`, (d) => {
          if (inq) d.inquilinos.push(inq);
          d.contratos.push({ ...f, criadoEm: quando, criadoPor: app.usuario });
          const im = D.porId(d.imoveis, f.imovelId);
          if (im) im.situacao = 'Alugado';
        });
      } else {
        app.store.commit(`Contrato de ${nomeInq} — Ref. ${ref} alterado`, (d) => {
          Object.assign(D.porId(d.contratos, f.id), f, { atualizadoEm: quando, atualizadoPor: app.usuario });
        });
      }
      if (gerar) {
        this.gerando = true;
        try { await gerarContratoDocx(f.id); } catch (e) { avisar('Erro ao gerar o contrato: ' + e.message, 'erro'); }
        this.gerando = false;
      } else {
        avisar(this.novo ? 'Locação cadastrada.' : 'Contrato atualizado.');
      }
      ir('#/contrato/' + f.id);
    },
  },
  template: `
  <section v-if="form">
    <div class="titulo-pagina">
      <div><a :href="novo ? '#/contratos' : '#/contrato/' + form.id" class="voltar">← Voltar</a><h1>{{ novo ? 'Nova locação' : 'Editar contrato' }}</h1></div>
    </div>

    <div class="cartao">
      <h2>1. Inquilino</h2>
      <div v-if="novo" class="alternador">
        <label><input type="radio" value="existente" v-model="modoInquilino" :disabled="!inquilinos.length"> Já cadastrado</label>
        <label><input type="radio" value="novo" v-model="modoInquilino"> Cadastrar novo inquilino</label>
      </div>
      <InquilinoForm v-if="novo && modoInquilino === 'novo'" :form="novoInq" />
      <div v-else class="form-grid">
        <label class="c4">Inquilino *<select v-model="form.inquilinoId"><option value="">Escolha…</option>
          <option v-for="q in inquilinos" :value="q.id">{{ q.nome }} {{ q.cpfCnpj ? '· ' + fmtCpfCnpj(q.cpfCnpj) : '' }}</option></select></label>
      </div>
    </div>

    <div class="cartao">
      <h2>2. Imóvel e finalidade</h2>
      <div class="form-grid">
        <label class="c4">Imóvel *<select v-model="form.imovelId"><option value="">Escolha…</option>
          <option v-for="i in imoveis" :value="i.id">{{ i.ref }} · {{ i.descricao.slice(0, 90) }}</option></select></label>
        <label class="c2">Unidade / parte locada<input v-model="form.unidade" placeholder="ex.: Loja 2, Apto 101"></label>
        <p v-if="outrosContratos.length" class="dica c6">Este imóvel já tem {{ outrosContratos.length }} contrato(s) ativo(s). Use o campo “Unidade” para diferenciar.</p>
        <label class="c2">Finalidade<select v-model="form.finalidade"><option value="comercial">Comercial (não residencial)</option><option value="residencial">Residencial</option></select></label>
        <label class="c4" v-if="form.finalidade === 'comercial'">Atividade a ser exercida<input v-model="form.atividade" placeholder="ex.: farmácia, escritório de advocacia"></label>
      </div>
    </div>

    <div class="cartao">
      <h2>3. Prazo, valor e reajuste</h2>
      <div class="form-grid">
        <label class="c2">Início *<input v-model="form.dataInicio" type="date"></label>
        <label class="c1">Prazo (meses) *<input v-model.number="form.prazoMeses" type="number" min="1"></label>
        <label class="c1">Término<input :value="fmtData(dataFim)" disabled></label>
        <label class="c2">Data de assinatura<input v-model="form.dataAssinatura" type="date"></label>
        <label class="c2">Aluguel mensal (R$) *<input v-model.number="form.valorInicial" type="number" step="0.01" min="0">
          <small>{{ form.valorInicial ? moedaExtenso(form.valorInicial) : '' }}</small></label>
        <label class="c1">Vencimento (dia)<input v-model.number="form.diaVencimento" type="number" min="1" max="31"></label>
        <label class="c1">Índice<select v-model="form.indice"><option v-for="(info, k) in INDICES" :value="k">{{ k }}</option></select></label>
        <label class="c1">Reajuste a cada<select v-model.number="form.periodicidadeMeses"><option :value="12">12 meses</option></select></label>
        <label class="c1">Controlar pagamentos desde<input v-model="form.controleDesde" type="month"></label>
        <label class="c2">Foro (comarca)<input v-model="form.foro" :placeholder="foroPadrao"></label>
        <label class="c2">Forma de pagamento<input v-model="form.formaPagamento"></label>
        <label class="c2">Dados bancários / chave PIX<input v-model="form.dadosBancarios" placeholder="Banco, agência, conta ou chave PIX"></label>
      </div>
      <div v-if="novo" class="sub-bloco">
        <label class="check"><input type="checkbox" v-model="emAndamento"> Contrato já em andamento (cadastro de locação existente)</label>
        <div v-if="emAndamento" class="form-grid">
          <label class="c2">Aluguel atual (se já reajustado)<input v-model.number="valorAtual" type="number" step="0.01"></label>
          <label class="c2">Mês do último reajuste<input v-model="mesUltimoReajuste" type="month"></label>
          <p class="dica c6">Isso define o valor vigente e o mês do próximo reajuste. Deixe em branco se o valor nunca foi reajustado.</p>
        </div>
      </div>
    </div>

    <div class="cartao">
      <h2>4. Encargos e garantia</h2>
      <div class="checks">
        <span>Por conta do inquilino:</span>
        <label class="check"><input type="checkbox" v-model="form.encargos.iptu"> IPTU e taxas</label>
        <label class="check"><input type="checkbox" v-model="form.encargos.condominio"> Condomínio</label>
        <label class="check"><input type="checkbox" v-model="form.encargos.agua"> Água/esgoto</label>
        <label class="check"><input type="checkbox" v-model="form.encargos.luz"> Energia/gás</label>
        <label class="check"><input type="checkbox" v-model="form.encargos.seguro"> Seguro incêndio</label>
      </div>
      <div class="form-grid">
        <label class="c3">Modalidade de garantia<select v-model="form.garantia.tipo">
          <option v-for="(rot, k) in TIPOS_GARANTIA" :value="k">{{ rot }}</option></select>
          <small>A lei permite só uma modalidade por contrato (art. 37), mas a fiança pode ter vários fiadores.</small></label>
        <label class="c2" v-if="!['nenhuma', 'antecipado'].includes(form.garantia.tipo)">Validade da garantia<input type="date" v-model="form.garantia.vencimento">
          <small>gera alerta 60 dias antes</small></label>
      </div>

      <div v-if="form.garantia.tipo === 'fiador'" class="sub-bloco">
        <div v-for="(f, k) in form.garantia.fiadores" :key="k" class="fiador">
          <div class="cab-cartao"><h3>Fiador {{ k + 1 }}</h3>
            <button v-if="form.garantia.fiadores.length > 1" class="pequeno perigo" @click="form.garantia.fiadores.splice(k, 1)">Remover</button></div>
          <div class="form-grid">
            <label class="c4">Nome completo<input v-model="f.nome"></label>
            <label class="c2">CPF<input v-model="f.cpf" @blur="f.cpf = fmtCpfCnpj(f.cpf)" inputmode="numeric"></label>
            <label class="c2">RG<input v-model="f.rg"></label>
            <label class="c1">Nacionalidade<input v-model="f.nacionalidade"></label>
            <label class="c1">Estado civil<input v-model="f.estadoCivil"></label>
            <label class="c2">Profissão<input v-model="f.profissao"></label>
            <label class="c4">Endereço completo<input v-model="f.endereco"></label>
            <label class="c2">Telefone / e-mail<input v-model="f.telefone"></label>
            <label class="c4">Cônjuge (se casado, também assina — outorga do cônjuge)<input v-model="f.conjugeNome"></label>
            <label class="c2">CPF do cônjuge<input v-model="f.conjugeCpf" @blur="f.conjugeCpf = fmtCpfCnpj(f.conjugeCpf)"></label>
          </div>
        </div>
        <button class="pequeno" @click="form.garantia.fiadores.push(fiadorVazio())">+ Adicionar fiador</button>
      </div>

      <div v-if="form.garantia.tipo === 'caucao'" class="form-grid sub-bloco">
        <label class="c2">Forma da caução<select v-model="form.garantia.caucaoModalidade">
          <option value="dinheiro">Dinheiro (depósito em poupança)</option><option value="cheques">Cheque(s)</option><option value="bens">Bens móveis ou imóveis</option></select></label>
        <label class="c2">Valor (R$)<input v-model.number="form.garantia.caucaoValor" type="number" step="0.01">
          <small>dinheiro: máx. 3 aluguéis = {{ fmtMoeda(form.valorInicial * 3) }}</small></label>
        <label class="c6" v-if="form.garantia.caucaoModalidade !== 'dinheiro'">{{ form.garantia.caucaoModalidade === 'bens' ? 'Descrição dos bens' : 'Cheques (banco, números, valores)' }}<input v-model="form.garantia.caucaoDescricao"></label>
      </div>
      <div v-if="form.garantia.tipo === 'titulo'" class="form-grid sub-bloco">
        <label class="c2">Instituição emissora<input v-model="form.garantia.instituicao"></label>
        <label class="c2">Nº do título<input v-model="form.garantia.numeroTitulo"></label>
        <label class="c2">Valor (R$)<input v-model.number="form.garantia.valorTitulo" type="number" step="0.01"></label>
      </div>
      <div v-if="form.garantia.tipo === 'seguro'" class="form-grid sub-bloco">
        <label class="c3">Seguradora<input v-model="form.garantia.seguradora"></label>
        <label class="c3">Nº da apólice<input v-model="form.garantia.apolice"></label>
      </div>
      <p v-if="form.garantia.tipo === 'antecipado'" class="dica sub-bloco">Sem garantia, a lei permite exigir o aluguel antecipado, até o 6º dia útil do mês a vencer (art. 42). Fora disso, cobrar meses adiantados é vedado (art. 20), exceto em locação para temporada.</p>
    </div>

    <div class="cartao">
      <h2>Multa e juros por atraso</h2>
      <div class="form-grid">
        <label class="c1">Multa (%)<input type="number" step="0.1" v-model.number="form.atraso.multaPct"></label>
        <label class="c1">Juros ao mês (%)<input type="number" step="0.1" v-model.number="form.atraso.jurosMesPct"></label>
        <label class="c2">Juros e correção a partir de<select v-model.number="form.atraso.jurosAposDias">
          <option :value="0">1º dia de atraso</option><option :value="30">atraso maior que 30 dias</option></select></label>
        <label class="c2 check"><input type="checkbox" v-model="form.atraso.correcao"> Correção monetária pelo índice do contrato</label>
      </div>
      <p class="dica">Os contratos atuais da família usam: multa de 10% logo após o vencimento; juros de 1% a.m. e correção só se o atraso passar de 1 mês. Essas regras são usadas para calcular o que cobrar em cada pagamento.</p>
    </div>

    <div class="cartao">
      <h2>5. Cláusulas adicionais e observações</h2>
      <div class="form-grid">
        <label class="c6">Cláusulas adicionais (entram no contrato; uma por linha)<textarea v-model="form.clausulasAdicionais" rows="3" placeholder="ex.: O LOCATÁRIO terá carência de 2 meses de aluguel para adequação do imóvel."></textarea></label>
        <label class="c6">Observações internas (não entram no contrato)<textarea v-model="form.observacoes" rows="2"></textarea></label>
      </div>
    </div>

    <div class="barra-acoes">
      <button @click="salvar(false)" :disabled="gerando">Salvar</button>
      <button class="primario" @click="salvar(true)" :disabled="gerando">{{ gerando ? 'Gerando…' : 'Salvar e gerar contrato (.docx)' }}</button>
    </div>
  </section>
  <section v-else><p class="vazio">Contrato não encontrado.</p></section>`,
};

// ---------------------------------------------------------------------------
export const ContratoDetalhe = {
  components: { Chip, Modal, PagamentoModal, HistoricoModal, VistoriaModal, AditivoModal, Anexos, MoverArquivosModal },
  props: { id: String },
  setup() { return { app, ...helpers }; },
  data() { return { encerrar: null, pagamento: null, ocupado: false, vistoria: null, aditivo: false, historico: false, verTodos: false, moverArquivos: false }; },
  computed: {
    db,
    c() { return D.porId(this.db.contratos, this.id); },
    inq() { return D.porId(this.db.inquilinos, this.c?.inquilinoId); },
    im() { return D.porId(this.db.imoveis, this.c?.imovelId); },
    reajustes() { return [...(this.c.reajustes || [])].sort((a, b) => b.vigenciaDesde.localeCompare(a.vigenciaDesde)); },
    cobrancas() {
      const c = this.c;
      const inicio = c.controleDesde || c.dataInicio.slice(0, 7);
      const fimCtrl = c.status === 'ativo' ? mesAtual() : (c.dataEncerramento || D.fimContrato(c)).slice(0, 7);
      const lista = [];
      for (let ym = fimCtrl; ym >= inicio && lista.length < (this.verTodos ? 600 : 12); ym = somaMeses(ym, -1)) {
        lista.push(...D.cobrancasDoMes({ ...this.db, contratos: [c] }, ym, app.indices));
      }
      return lista;
    },
    garantiaTexto() {
      const g = this.c.garantia || {};
      const fs = (g.fiadores || []).filter((f) => f.nome);
      return { fiador: fs.length ? `${fs.length > 1 ? 'Fiadores' : 'Fiador'}: ${fs.map((f) => f.nome).join(', ')}` : 'Fiador: —',
        antecipado: 'Aluguel antecipado (art. 42)', caucao: `Caução: ${this.fmtMoeda(g.caucaoValor)}`,
        seguro: `Seguro fiança ${g.seguradora || ''}`, titulo: `Título de capitalização ${this.fmtMoeda(g.valorTitulo)}`,
        nenhuma: 'Sem garantia' }[g.tipo] || '—';
    },
    resumoPag() {
      const todos = [];
      const c = this.c;
      const inicio = c.controleDesde || c.dataInicio.slice(0, 7);
      const fim = c.status === 'ativo' ? mesAtual() : (c.dataEncerramento || D.fimContrato(c)).slice(0, 7);
      for (let ym = inicio; ym <= fim; ym = somaMeses(ym, 1)) todos.push(...D.cobrancasDoMes({ ...this.db, contratos: [c] }, ym, app.indices));
      const pagos = todos.filter((x) => x.pagamento);
      return { meses: todos.length, pagos: pagos.length, comAtraso: pagos.filter((x) => x.pagoComAtraso).length,
        aCobrar: todos.reduce((s, x) => s + (x.pagamento ? x.aCobrar : 0), 0), emAberto: todos.filter((x) => x.status === 'atrasado').length };
    },
    garantiaVence() { return D.garantiaVencimento(this.c); },
    multa() {
      if (!this.encerrar?.data) return null;
      return D.multaRescisoria(this.c, this.encerrar.data, this.db.config);
    },
    pastaAnexos() { return pastaDoContrato(this.c); },
    vistorias() { return [...this.c.vistorias].sort((a, b) => b.data.localeCompare(a.data)); },
  },
  methods: {
    async gerar() {
      this.ocupado = true;
      try { await gerarContratoDocx(this.c.id); } catch (e) { avisar('Erro ao gerar: ' + e.message, 'erro'); }
      this.ocupado = false;
    },
    imprimirContrato() { imprimir(contratoBlocos(this.db, this.c), 'Contrato de locação'); },
    async notificacao(r) {
      this.ocupado = true;
      try { await gerarNotificacaoDocx(this.c.id, r.id); } catch (e) { avisar('Erro: ' + e.message, 'erro'); }
      this.ocupado = false;
    },
    imprimirNotificacao(r) { imprimir(notificacaoBlocos(this.db, this.c, r), 'Notificação de reajuste'); },
    async recibo(p) {
      try { await gerarReciboDocx(this.c.id, p.id); } catch (e) { avisar('Erro: ' + e.message, 'erro'); }
    },
    removerReajuste(r) {
      if (!confirm(`Desfazer o reajuste com vigência em ${this.fmtMes(r.vigenciaDesde)}?`)) return;
      const cid = this.c.id;
      app.store.commit('Reajuste desfeito', (d) => {
        const c = D.porId(d.contratos, cid);
        c.reajustes = c.reajustes.filter((x) => x.id !== r.id);
      });
    },
    abrirEncerrar() { this.encerrar = { data: hojeISO(), motivo: '', isentar: false, multaCobrada: null }; },
    confirmarEncerramento() {
      const { data, motivo, isentar } = this.encerrar;
      if (!data) return;
      const cid = this.c.id;
      const imId = this.c.imovelId;
      const multa = isentar ? 0 : (this.encerrar.multaCobrada ?? this.multa?.valor ?? 0);
      app.store.commit(`Contrato encerrado: ${this.inq?.nome} — Ref. ${this.im?.ref}`, (d) => {
        const c = D.porId(d.contratos, cid);
        Object.assign(c, { status: 'encerrado', dataEncerramento: data, motivoEncerramento: motivo, multaRescisoria: multa });
        const outros = d.contratos.some((x) => x.imovelId === imId && x.id !== cid && x.status === 'ativo');
        const im = D.porId(d.imoveis, imId);
        if (im && !outros) im.situacao = 'Vago';
      });
      this.encerrar = null;
      avisar('Contrato encerrado.');
      if (app.modo === 'onedrive') this.moverArquivos = true;
    },
    reativar() {
      const cid = this.c.id;
      app.store.commit('Contrato reativado', (d) => {
        const c = D.porId(d.contratos, cid);
        c.status = 'ativo'; delete c.dataEncerramento;
        const im = D.porId(d.imoveis, c.imovelId); if (im) im.situacao = 'Alugado';
      });
      if (app.modo === 'onedrive') this.moverArquivos = true;
    },
    adicionarAnexos(novos) {
      const cid = this.c.id;
      app.store.commit(`Anexos no contrato de ${this.inq?.nome}: ${novos.map((a) => a.nome).join(', ')}`, (d) => D.porId(d.contratos, cid).anexos.push(...novos));
    },
    removerAnexo(a) {
      const cid = this.c.id;
      app.store.commit(`Anexo removido: ${a.nome}`, (d) => {
        const c = D.porId(d.contratos, cid);
        c.anexos = c.anexos.filter((x) => !(x.webUrl === a.webUrl && x.nome === a.nome));
      });
    },
    async docVistoria(vs) {
      this.ocupado = true;
      try { await gerarVistoriaDocx(this.c.id, vs.id); } catch (e) { avisar('Erro: ' + e.message, 'erro'); }
      this.ocupado = false;
    },
    pdfVistoria(vs) { imprimir(blocosVistoria(this.c, vs), 'Termo de vistoria'); },
    async docAditivo(a) {
      this.ocupado = true;
      try { await gerarAditivoDocx(this.c.id, a.id); } catch (e) { avisar('Erro: ' + e.message, 'erro'); }
      this.ocupado = false;
    },
    pdfAditivo(a) { imprimir(aditivoBlocos(this.db, this.c, a), 'Termo aditivo'); },
    excluir() {
      if (this.db.pagamentos.some((p) => p.contratoId === this.c.id)) {
        avisar('Há pagamentos registrados neste contrato. Encerre o contrato em vez de excluir.', 'erro'); return;
      }
      if (!confirm('Excluir este contrato? Use apenas para cadastros feitos por engano.')) return;
      const cid = this.c.id;
      app.store.commit(`Contrato excluído: ${this.inq?.nome}`, (d) => { d.contratos = d.contratos.filter((x) => x.id !== cid); });
      ir('#/contratos');
    },
  },
  template: `
  <section v-if="c">
    <div class="titulo-pagina">
      <div><a href="#/contratos" class="voltar">← Contratos</a>
        <h1>{{ inq?.nome || 'Inquilino' }} <Chip :status="c.status" /></h1>
        <span class="sub"><a :href="'#/imovel/' + im?.id">{{ nomeImovel(im) }}</a><span v-if="c.unidade"> · {{ c.unidade }}</span></span></div>
      <div class="acoes">
        <button @click="ir('#/contrato/' + c.id + '/editar')">Editar</button>
        <button @click="imprimirContrato">Imprimir / PDF</button>
        <button class="primario" @click="gerar" :disabled="ocupado">Gerar contrato (.docx)</button>
      </div>
    </div>

    <div class="kpis">
      <div class="kpi"><span class="kpi-rotulo">Aluguel vigente</span><strong>{{ fmtMoeda(valorVigente(c)) }}</strong><small>vence todo dia {{ c.diaVencimento }}</small></div>
      <div class="kpi"><span class="kpi-rotulo">Vigência</span><strong>{{ fmtData(c.dataInicio) }}</strong><small>até {{ fmtData(fimContrato(c)) }} ({{ c.prazoMeses }} meses)</small></div>
      <div class="kpi"><span class="kpi-rotulo">Próximo reajuste</span><strong>{{ c.status === 'ativo' ? fmtMes(proximoReajuste(c)) : '—' }}</strong><small>{{ c.indice }}, a cada {{ c.periodicidadeMeses || 12 }} meses</small></div>
      <div class="kpi"><span class="kpi-rotulo">Garantia</span><strong class="menor">{{ garantiaTexto }}</strong><small :class="{ 'texto-ruim': garantiaVence && garantiaVence < hojeISO() }">{{ garantiaVence ? 'vence em ' + fmtData(garantiaVence) : (c.finalidade === 'residencial' ? 'Residencial' : 'Comercial') }}</small></div>
    </div>

    <div class="cartao">
      <div class="cab-cartao"><h2>Pagamentos</h2>
        <div class="linha-botoes"><small>Controle desde {{ fmtMes(c.controleDesde) }}</small>
          <button class="pequeno" @click="historico = true">Lançar histórico de pagamentos</button></div></div>
      <p class="resumo-pag">{{ resumoPag.pagos }} de {{ resumoPag.meses }} meses pagos · {{ resumoPag.comAtraso }} com atraso
        <span v-if="resumoPag.emAberto" class="texto-ruim"> · {{ resumoPag.emAberto }} em aberto</span>
        <span v-if="resumoPag.aCobrar > 0.009" class="texto-ruim"> · multa/juros não cobrados: {{ fmtMoeda(resumoPag.aCobrar) }}</span></p>
      <table class="tabela">
        <thead><tr><th>Competência</th><th>Vencimento</th><th class="num">Valor</th><th>Status</th><th>Pago em</th><th class="num">Valor pago</th><th class="num">Multa/juros devidos</th><th></th></tr></thead>
        <tbody>
          <tr v-for="cob in cobrancas" :key="cob.competencia">
            <td>{{ fmtMes(cob.competencia) }}</td><td>{{ fmtData(cob.vencimento) }}</td><td class="num">{{ fmtMoeda(cob.valor) }}</td>
            <td><Chip :status="cob.status" /></td><td>{{ fmtData(cob.pagamento?.dataPagamento) }}<small v-if="cob.pagoComAtraso"><br>{{ cob.encargos.dias }} dia(s) de atraso</small></td>
            <td class="num">{{ cob.pagamento ? fmtMoeda(cob.pagamento.valorPago) : '' }}</td>
            <td class="num"><template v-if="cob.encargos.total">{{ fmtMoeda(cob.encargos.total) }}<br>
              <small :class="{ 'texto-ruim': cob.aCobrar > 0.009 }">{{ !cob.pagamento ? 'atualizado até hoje' : cob.aCobrar > 0.009 ? 'faltou cobrar ' + fmtMoeda(cob.aCobrar) : 'cobrado' }}</small></template></td>
            <td class="acoes-linha">
              <button v-if="!cob.pagamento" class="pequeno" @click="pagamento = cob">Registrar</button>
              <template v-else><button class="pequeno" @click="pagamento = cob">Editar</button><button class="pequeno" @click="recibo(cob.pagamento)">Recibo</button></template>
            </td>
          </tr>
          <tr v-if="!cobrancas.length"><td colspan="8" class="vazio">Sem cobranças no período. Use "Lançar histórico de pagamentos" para registrar meses anteriores.</td></tr>
        </tbody>
      </table>
      <button v-if="!verTodos && resumoPag.meses > 12" class="pequeno" @click="verTodos = true">Ver todos os {{ resumoPag.meses }} meses</button>
    </div>

    <div class="cartao">
      <div class="cab-cartao"><h2>Reajustes</h2><button class="pequeno" @click="ir('#/reajustes?contrato=' + c.id)">Calcular reajuste</button></div>
      <p v-if="!reajustes.length" class="vazio">Nenhum reajuste aplicado. Valor inicial: {{ fmtMoeda(c.valorInicial) }}.</p>
      <table v-else class="tabela">
        <thead><tr><th>Vigência</th><th>Índice</th><th>Período</th><th class="num">Variação</th><th class="num">De</th><th class="num">Para</th><th></th></tr></thead>
        <tbody><tr v-for="r in reajustes" :key="r.id">
          <td>{{ fmtMes(r.vigenciaDesde) }}</td><td>{{ r.tipo === 'manual' ? 'Informado' : r.indice }}</td>
          <td>{{ r.periodoIni ? fmtMes(r.periodoIni) + ' a ' + fmtMes(r.periodoFim) : '—' }}</td>
          <td class="num">{{ fmtPct(r.pct) }}<small v-if="r.pctAplicado === 0 && r.pct < 0"> (não aplicado)</small></td>
          <td class="num">{{ fmtMoeda(r.valorAnterior) }}</td><td class="num">{{ fmtMoeda(r.valorNovo) }}</td>
          <td class="acoes-linha">
            <template v-if="r.tipo !== 'manual' && r.tipo !== 'aditivo'"><button class="pequeno" @click="notificacao(r)" :disabled="ocupado">Notificação .docx</button>
            <button class="pequeno" @click="imprimirNotificacao(r)">PDF</button></template>
            <button class="pequeno perigo" @click="removerReajuste(r)" title="Desfazer reajuste">✕</button>
          </td></tr></tbody>
      </table>
    </div>

    <div class="cartao">
      <div class="cab-cartao"><h2>Vistorias</h2><div class="linha-botoes">
        <a class="botao pequeno" :href="'#/documentos?tipo=branco_entrada&contrato=' + c.id">Laudo em branco</a>
        <button class="pequeno" @click="vistoria = {}">+ Nova vistoria</button></div></div>
      <p v-if="!vistorias.length" class="vazio">Nenhuma vistoria registrada. Faça a de entrada na entrega das chaves.</p>
      <table v-else class="tabela">
        <thead><tr><th>Data</th><th>Tipo</th><th>Itens</th><th>Fotos</th><th></th></tr></thead>
        <tbody><tr v-for="vs in vistorias" :key="vs.id">
          <td>{{ fmtData(vs.data) }}</td><td>{{ vs.tipo === 'saida' ? 'Saída' : 'Entrada' }}</td>
          <td>{{ vs.ambientes.length }}<small v-if="vs.ambientes.some(a => a.estado === 'Ruim')" class="tag-aviso"> itens em estado ruim</small></td>
          <td>{{ vs.fotos.length }}</td>
          <td class="acoes-linha"><button class="pequeno" @click="vistoria = vs">Editar</button>
            <button class="pequeno" @click="docVistoria(vs)" :disabled="ocupado">.docx</button><button class="pequeno" @click="pdfVistoria(vs)">PDF</button></td>
        </tr></tbody>
      </table>
    </div>

    <div class="cartao">
      <div class="cab-cartao"><h2>Termos aditivos</h2><button class="pequeno" @click="aditivo = true">+ Novo aditivo</button></div>
      <p v-if="!c.aditivos.length" class="vazio">Nenhum aditivo.</p>
      <table v-else class="tabela">
        <thead><tr><th>Nº</th><th>Data</th><th>Alterações</th><th></th></tr></thead>
        <tbody><tr v-for="a in c.aditivos" :key="a.id">
          <td>{{ a.numero }}º</td><td>{{ fmtData(a.data) }}</td>
          <td>{{ [a.prorrogarMeses ? 'prorrogação de ' + a.prorrogarMeses + ' meses' : '', a.novoValor ? 'aluguel ' + fmtMoeda(a.novoValor) + ' desde ' + fmtMes(a.vigenciaValor) : '', a.texto ? 'outras cláusulas' : ''].filter(Boolean).join(' · ') }}</td>
          <td class="acoes-linha"><button class="pequeno" @click="docAditivo(a)" :disabled="ocupado">.docx</button><button class="pequeno" @click="pdfAditivo(a)">PDF</button></td>
        </tr></tbody>
      </table>
    </div>

    <div class="cartao">
      <h2>Contrato assinado e anexos</h2>
      <Anexos :lista="c.anexos" :pasta="pastaAnexos" aceitar="application/pdf,image/*,.doc,.docx"
        :categorias="['Contrato assinado', 'Aditivo assinado', 'Vistoria assinada', 'Notificação assinada', 'Documento do inquilino', 'Garantia', 'Outro']"
        @adicionar="adicionarAnexos" @remover="removerAnexo" />
    </div>

    <div class="cartao" v-if="c.documentos?.length">
      <h2>Documentos gerados</h2>
      <ul class="docs">
        <li v-for="(d, k) in c.documentos" :key="k">
          <a v-if="d.webUrl" :href="d.webUrl" target="_blank" rel="noopener">{{ d.nome }}</a><span v-else>{{ d.nome }}</span>
          <small>{{ d.tipo }} · {{ fmtData(d.criadoEm) }} · {{ d.criadoPor }}</small></li>
      </ul>
    </div>

    <div class="cartao" v-if="c.observacoes || c.clausulasAdicionais">
      <h2>Observações</h2>
      <p class="pre">{{ c.observacoes }}</p>
      <p v-if="c.clausulasAdicionais" class="pre"><b>Cláusulas adicionais:</b> {{ c.clausulasAdicionais }}</p>
    </div>

    <p class="rodape-acoes">
      <button v-if="c.status === 'ativo'" @click="abrirEncerrar">Encerrar / simular rescisão</button>
      <button v-else @click="reativar">Reativar contrato</button>
      <button v-if="app.modo === 'onedrive'" @click="moverArquivos = true">Atualizar pastas</button>
      <button class="perigo" @click="excluir">Excluir</button>
      <small v-if="c.dataEncerramento">Encerrado em {{ fmtData(c.dataEncerramento) }} {{ c.motivoEncerramento ? '— ' + c.motivoEncerramento : '' }}{{ c.multaRescisoria ? ' · multa ' + fmtMoeda(c.multaRescisoria) : '' }}</small>
    </p>

    <Modal v-if="encerrar" titulo="Encerrar contrato" @fechar="encerrar = null">
      <div class="form-grid">
        <label class="c3">Data de entrega das chaves<input type="date" v-model="encerrar.data"></label>
        <label class="c6">Motivo / observação<input v-model="encerrar.motivo"></label>
      </div>
      <div v-if="multa" class="sub-bloco">
        <h3>Multa por devolução antecipada (art. 4º da Lei 8.245/91)</h3>
        <table class="tabela compacta"><tbody>
          <tr><td>Multa contratual cheia</td><td class="num">{{ db.config.multaRescisoriaAlugueis }} × {{ fmtMoeda(multa.aluguel) }} = {{ fmtMoeda(multa.multaCheia) }}</td></tr>
          <tr><td>Prazo restante</td><td class="num">{{ multa.diasRestantes }} de {{ multa.diasTotal }} dias (≈ {{ fmtNum(multa.mesesRestantes, 1) }} meses)</td></tr>
          <tr><td><b>Multa proporcional</b></td><td class="num"><b>{{ fmtMoeda(multa.valor) }}</b></td></tr>
        </tbody></table>
        <div class="form-grid">
          <label class="c3">Multa a cobrar (R$)<input type="number" step="0.01" :placeholder="multa.valor" v-model.number="encerrar.multaCobrada" :disabled="encerrar.isentar"></label>
          <label class="c3 check"><input type="checkbox" v-model="encerrar.isentar"> Isentar (ex.: fim do prazo, acordo, transferência pelo empregador — art. 4º, parágrafo único)</label>
        </div>
      </div>
      <p class="dica">O imóvel volta a ficar “Vago” se não houver outro contrato ativo nele. Pagamentos até o mês de encerramento continuam sendo cobrados. Em seguida, o sistema oferece mover os arquivos do contrato de <code>contratos/Vigentes</code> para <code>contratos/Encerrados</code>. Para só simular, feche esta janela.</p>
      <template #rodape><button @click="encerrar = null">Cancelar</button><button class="primario" @click="confirmarEncerramento">Encerrar</button></template>
    </Modal>
    <PagamentoModal v-if="pagamento" :cobranca="pagamento" @fechar="pagamento = null" />
    <HistoricoModal v-if="historico" :contrato="c" @fechar="historico = false" />
    <MoverArquivosModal v-if="moverArquivos" :contrato="c" @fechar="moverArquivos = false" />
    <VistoriaModal v-if="vistoria" :contrato="c" :vistoria="vistoria.id ? vistoria : null" @fechar="vistoria = null" />
    <AditivoModal v-if="aditivo" :contrato="c" @fechar="aditivo = false" />
  </section>
  <section v-else><p class="vazio">Contrato não encontrado. <a href="#/contratos">Voltar</a></p></section>`,
};
