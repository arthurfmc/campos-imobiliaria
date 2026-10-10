import { app, db, helpers, Chip, avisar, ir } from './comum.js';
import * as D from '../db.js';
import { clone, novoId, buscarCep, docValido, soDigitos, hojeISO, vencimentoDe } from '../util.js';

export function inquilinoVazio() {
  return { id: novoId(), tipo: 'PF', nome: '', cpfCnpj: '', rg: '', orgaoEmissor: '', nacionalidade: 'brasileiro(a)',
    estadoCivil: '', profissao: '', nascimento: '', email: '', telefone: '', cep: '', logradouro: '', numero: '',
    complemento: '', bairro: '', cidade: '', uf: '', representanteNome: '', representanteCpf: '', representanteCargo: '',
    observacoes: '' };
}

export function validarInquilino(f) {
  if (!f.nome.trim()) return 'Informe o nome do inquilino.';
  if (f.cpfCnpj && !docValido(f.cpfCnpj)) return `${f.tipo === 'PJ' ? 'CNPJ' : 'CPF'} inválido. Confira os números.`;
  return null;
}

// Formulário reutilizado na página do inquilino e na nova locação.
export const InquilinoForm = {
  props: { form: Object },
  setup() { return helpers; },
  data() { return { buscandoCep: false }; },
  computed: {
    docOk() { return !this.form.cpfCnpj || docValido(this.form.cpfCnpj); },
  },
  methods: {
    async cep() {
      if (soDigitos(this.form.cep).length !== 8) return;
      this.buscandoCep = true;
      try {
        const r = await buscarCep(this.form.cep);
        if (r) Object.assign(this.form, { logradouro: r.logradouro || this.form.logradouro, bairro: r.bairro || this.form.bairro, cidade: r.localidade, uf: r.uf });
      } catch { /* sem internet para o CEP: preenche manualmente */ }
      this.buscandoCep = false;
    },
    formatarDoc() { this.form.cpfCnpj = this.fmtCpfCnpj(this.form.cpfCnpj); },
  },
  template: `
  <div class="form-grid">
    <div class="c6 alternador">
      <label><input type="radio" value="PF" v-model="form.tipo"> Pessoa física</label>
      <label><input type="radio" value="PJ" v-model="form.tipo"> Pessoa jurídica (empresa)</label>
    </div>
    <label class="c4">{{ form.tipo === 'PJ' ? 'Razão social' : 'Nome completo' }} *<input v-model="form.nome" required></label>
    <label class="c2">{{ form.tipo === 'PJ' ? 'CNPJ' : 'CPF' }}<input v-model="form.cpfCnpj" @blur="formatarDoc" :class="{ invalido: !docOk }" inputmode="numeric">
      <small v-if="!docOk" class="erro-campo">Número inválido</small></label>
    <template v-if="form.tipo === 'PF'">
      <label class="c2">RG<input v-model="form.rg"></label>
      <label class="c1">Órgão emissor<input v-model="form.orgaoEmissor" placeholder="SSP/MG"></label>
      <label class="c1">Nascimento<input v-model="form.nascimento" type="date"></label>
      <label class="c2">Nacionalidade<input v-model="form.nacionalidade"></label>
      <label class="c2">Estado civil<select v-model="form.estadoCivil"><option value=""></option><option>solteiro(a)</option><option>casado(a)</option><option>divorciado(a)</option><option>viúvo(a)</option><option>em união estável</option></select></label>
      <label class="c2">Profissão<input v-model="form.profissao"></label>
    </template>
    <template v-else>
      <label class="c2">Representante legal<input v-model="form.representanteNome"></label>
      <label class="c2">CPF do representante<input v-model="form.representanteCpf" @blur="form.representanteCpf = fmtCpfCnpj(form.representanteCpf)"></label>
      <label class="c2">Cargo<input v-model="form.representanteCargo" placeholder="sócio-administrador"></label>
    </template>
    <label class="c3">E-mail<input v-model="form.email" type="email"></label>
    <label class="c3">Telefone / WhatsApp<input v-model="form.telefone" @blur="form.telefone = fmtTelefone(form.telefone)" inputmode="tel"></label>
    <label class="c1">CEP<input v-model="form.cep" @blur="cep" inputmode="numeric"><small v-if="buscandoCep">buscando…</small></label>
    <label class="c4">Logradouro<input v-model="form.logradouro"></label>
    <label class="c1">Número<input v-model="form.numero"></label>
    <label class="c2">Complemento<input v-model="form.complemento"></label>
    <label class="c2">Bairro<input v-model="form.bairro"></label>
    <label class="c1">Cidade<input v-model="form.cidade"></label>
    <label class="c1">UF<input v-model="form.uf" maxlength="2"></label>
    <label class="c6">Observações<textarea v-model="form.observacoes" rows="2"></textarea></label>
  </div>`,
};

export const InquilinosLista = {
  components: { Chip },
  setup() { return { app, ...helpers }; },
  data() { return { busca: '', mostrar: 'ativos' }; },
  computed: {
    db,
    linhas() {
      const b = this.busca.trim().toLowerCase();
      return this.db.inquilinos.map((q) => {
        const contratos = this.db.contratos.filter((c) => c.inquilinoId === q.id);
        const ativos = contratos.filter(D.contratoAtivo);
        return { q, ativos, imoveis: ativos.map((c) => D.porId(this.db.imoveis, c.imovelId)?.ref).filter(Boolean),
          aluguel: ativos.reduce((s, c) => s + D.valorVigente(c), 0) };
      }).filter(({ q, ativos }) => {
        if (this.mostrar === 'ativos' && !ativos.length) return false;
        if (this.mostrar === 'sem' && ativos.length) return false;
        return !b || `${q.nome} ${q.cpfCnpj} ${q.email} ${q.telefone}`.toLowerCase().includes(b);
      })
        .sort((a, b2) => a.q.nome.localeCompare(b2.q.nome));
    },
  },
  template: `
  <section>
    <div class="titulo-pagina">
      <h1>Inquilinos</h1>
      <div class="acoes"><button @click="ir('#/inquilino/novo')">+ Cadastrar inquilino</button>
      <button class="primario" @click="ir('#/contrato/novo')">+ Nova locação</button></div>
    </div>
    <div class="filtros">
      <input v-model="busca" type="search" placeholder="Buscar por nome, CPF/CNPJ, e-mail, telefone…" aria-label="Buscar">
      <select v-model="mostrar" aria-label="Mostrar"><option value="ativos">Com contrato ativo</option><option value="sem">Sem contrato ativo</option><option value="todos">Todos</option></select>
    </div>
    <div class="cartao sem-padding">
      <table class="tabela">
        <thead><tr><th>Nome</th><th>CPF/CNPJ</th><th>Contato</th><th>Imóveis (Ref.)</th><th class="num">Aluguel</th></tr></thead>
        <tbody>
          <tr v-for="{ q, imoveis, aluguel } in linhas" :key="q.id" class="clicavel" @click="ir('#/inquilino/' + q.id)">
            <td>{{ q.nome }}</td><td>{{ fmtCpfCnpj(q.cpfCnpj) }}</td><td>{{ q.telefone }}<br><small>{{ q.email }}</small></td>
            <td>{{ imoveis.join(', ') || '—' }}</td><td class="num">{{ aluguel ? fmtMoeda(aluguel) : '—' }}</td>
          </tr>
          <tr v-if="!linhas.length"><td colspan="5" class="vazio">
            Nenhum inquilino {{ mostrar === 'ativos' ? 'com contrato ativo' : '' }}. Use “Nova locação” para cadastrar inquilino e contrato de uma vez.
          </td></tr>
        </tbody>
      </table>
    </div>
  </section>`,
};

export const InquilinoDetalhe = {
  components: { InquilinoForm, Chip },
  props: { id: String },
  setup() { return { app, ...helpers }; },
  data() { return { form: null, novo: false, ocorrencia: { data: '', texto: '' } }; },
  created() { this.carregar(); },
  watch: { id() { this.carregar(); } },
  computed: {
    db,
    original() { return D.porId(this.db.inquilinos, this.id); },
    contratos() {
      return this.db.contratos.filter((c) => c.inquilinoId === this.id)
        .map((c) => ({ c, im: D.porId(this.db.imoveis, c.imovelId) }));
    },
    alterado() { return this.novo || JSON.stringify(this.form) !== JSON.stringify(this.original); },
    pagamentos() {
      const ids = this.contratos.map((x) => x.c.id);
      return this.db.pagamentos.filter((p) => ids.includes(p.contratoId)).sort((a, b) => b.competencia.localeCompare(a.competencia));
    },
    resumo() {
      const atrasados = this.pagamentos.filter((p) => {
        const c = D.porId(this.db.contratos, p.contratoId);
        return c && p.dataPagamento > vencimentoDe(p.competencia, c.diaVencimento);
      }).length;
      return { total: this.pagamentos.reduce((s, p) => s + Number(p.valorPago), 0), qtd: this.pagamentos.length, atrasados,
        emAberto: D.cobrancasEmAtraso(this.db).filter((x) => x.contrato.inquilinoId === this.id).length };
    },
    ocorrencias() { return [...(this.original?.ocorrencias || [])].sort((a, b) => b.data.localeCompare(a.data)); },
  },
  methods: {
    carregar() {
      this.novo = this.id === 'novo';
      this.form = this.novo ? inquilinoVazio() : (this.original ? clone(this.original) : null);
      this.ocorrencia = { data: hojeISO(), texto: '' };
    },
    addOcorrencia() {
      if (!this.ocorrencia.texto.trim()) return;
      const o = { id: novoId(), ...this.ocorrencia, por: app.usuario };
      const id = this.id;
      app.store.commit(`Ocorrência registrada para ${this.form.nome}`, (d) => { (D.porId(d.inquilinos, id).ocorrencias ||= []).push(o); });
      (this.form.ocorrencias ||= []).push(o);
      this.ocorrencia = { data: hojeISO(), texto: '' };
    },
    salvar() {
      const erro = validarInquilino(this.form);
      if (erro) { avisar(erro, 'erro'); return; }
      const f = clone(this.form);
      const quando = new Date().toISOString();
      if (this.novo) {
        app.store.commit(`Inquilino ${f.nome} cadastrado`, (d) => d.inquilinos.push({ ...f, criadoEm: quando, criadoPor: app.usuario }));
        avisar('Inquilino cadastrado.');
        ir('#/inquilino/' + f.id);
      } else {
        app.store.commit(`Inquilino ${f.nome} alterado`, (d) => Object.assign(D.porId(d.inquilinos, f.id), f, { atualizadoEm: quando, atualizadoPor: app.usuario }));
        avisar('Alterações salvas.');
      }
    },
    excluir() {
      if (this.contratos.length) { avisar('Este inquilino tem contratos registrados e não pode ser excluído.', 'erro'); return; }
      if (!confirm(`Excluir o cadastro de ${this.form.nome}?`)) return;
      const id = this.form.id;
      app.store.commit(`Inquilino ${this.form.nome} excluído`, (d) => { d.inquilinos = d.inquilinos.filter((q) => q.id !== id); });
      ir('#/inquilinos');
    },
  },
  template: `
  <section v-if="form">
    <div class="titulo-pagina">
      <div><a href="#/inquilinos" class="voltar">← Inquilinos</a><h1>{{ novo ? 'Novo inquilino' : form.nome }}</h1></div>
      <div class="acoes">
        <button v-if="!novo" @click="ir('#/historico?inquilino=' + form.id)">Histórico completo</button>
        <button v-if="!novo" @click="ir('#/contrato/novo?inquilino=' + form.id)">+ Nova locação</button>
        <button class="primario" :disabled="!alterado" @click="salvar">Salvar</button>
      </div>
    </div>
    <div class="cartao"><InquilinoForm :form="form" /></div>
    <div class="cartao" v-if="!novo">
      <h2>Contratos</h2>
      <p v-if="!contratos.length" class="vazio">Nenhum contrato.</p>
      <table v-else class="tabela">
        <thead><tr><th>Imóvel</th><th>Início</th><th>Fim</th><th class="num">Aluguel</th><th>Status</th></tr></thead>
        <tbody><tr v-for="{ c, im } in contratos" :key="c.id" class="clicavel" @click="ir('#/contrato/' + c.id)">
          <td>{{ nomeImovel(im) }}</td><td>{{ fmtData(c.dataInicio) }}</td><td>{{ fmtData(fimContrato(c)) }}</td>
          <td class="num">{{ fmtMoeda(valorVigente(c)) }}</td><td><Chip :status="c.status" /></td></tr></tbody>
      </table>
    </div>
    <div class="cartao" v-if="!novo && contratos.length">
      <h2>Histórico de pagamentos</h2>
      <div class="kpis compactos">
        <div class="kpi"><span class="kpi-rotulo">Total pago</span><strong>{{ fmtMoeda(resumo.total) }}</strong><small>{{ resumo.qtd }} pagamento(s)</small></div>
        <div class="kpi" :class="{ ruim: resumo.atrasados }"><span class="kpi-rotulo">Pagos com atraso</span><strong>{{ resumo.atrasados }}</strong></div>
        <div class="kpi" :class="{ ruim: resumo.emAberto }"><span class="kpi-rotulo">Em atraso agora</span><strong>{{ resumo.emAberto }}</strong></div>
      </div>
      <table v-if="pagamentos.length" class="tabela compacta">
        <thead><tr><th>Competência</th><th>Pago em</th><th class="num">Valor</th><th>Forma</th></tr></thead>
        <tbody><tr v-for="p in pagamentos.slice(0, 24)" :key="p.id"><td>{{ fmtMes(p.competencia) }}</td><td>{{ fmtData(p.dataPagamento) }}</td>
          <td class="num">{{ fmtMoeda(p.valorPago) }}</td><td>{{ p.forma }}</td></tr></tbody>
      </table>
    </div>
    <div class="cartao" v-if="!novo">
      <h2>Ocorrências e anotações</h2>
      <div class="form-grid">
        <label class="c1">Data<input type="date" v-model="ocorrencia.data"></label>
        <label class="c4">Descrição<input v-model="ocorrencia.texto" placeholder="ex.: Ligou avisando atraso; reclamou de infiltração…" @keyup.enter="addOcorrencia"></label>
        <div class="c1" style="justify-content:flex-end"><button @click="addOcorrencia">Registrar</button></div>
      </div>
      <ul class="docs" v-if="ocorrencias.length">
        <li v-for="o in ocorrencias" :key="o.id"><span>{{ o.texto }}</span><small>{{ fmtData(o.data) }} · {{ o.por }}</small></li>
      </ul>
    </div>
    <p v-if="!novo" class="rodape-acoes"><button class="perigo" @click="excluir">Excluir inquilino</button></p>
  </section>
  <section v-else><p class="vazio">Inquilino não encontrado. <a href="#/inquilinos">Voltar</a></p></section>`,
};
