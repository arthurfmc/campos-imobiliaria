import { app, db, helpers, Chip, avisar, ir } from './comum.js';
import { Anexos } from './anexos.js';
import * as D from '../db.js';
import { clone, novoId } from '../util.js';

export const TIPOS = ['Loja', 'Sala', 'Apartamento', 'Casa', 'Comercial', 'Galpão', 'Lote', 'Terreno', 'Rural', 'Outro'];
export const SITUACOES = ['Alugado', 'Vago', 'Em reforma', 'Uso próprio', 'Indisponível'];

export const nomesProprietarios = (db0, i) => D.proprietariosDoImovel(db0, i).map((x) => x.p.nome.split(' ')[0] + (x.percentual < 100 ? ` ${x.percentual}%` : '')).join(', ');

export const ImoveisLista = {
  components: { Chip },
  props: { query: Object },
  setup() { return { app, ...helpers, TIPOS, SITUACOES, nomesProprietarios }; },
  data() {
    return { busca: '', tipo: '', situacao: '', cidade: '', titular: '', ordem: 'ref' };
  },
  created() {
    if (this.query?.filtro === 'semcontrato') this.situacao = 'semcontrato';
  },
  computed: {
    db,
    linhas() {
      return this.db.imoveis.map((i) => {
        const contratos = this.db.contratos.filter((c) => c.imovelId === i.id && D.contratoAtivo(c));
        return { i, sit: D.situacaoImovel(this.db, i), aluguel: D.aluguelImovel(this.db, i), contratos };
      });
    },
    cidades() { return [...new Set(this.db.imoveis.map((i) => i.cidade).filter(Boolean))].sort(); },
    titulares() { return (this.db.proprietarios || []).map((p) => ({ id: p.id, nome: p.nome })); },
    filtradas() {
      const b = this.busca.trim().toLowerCase();
      let r = this.linhas.filter(({ i, sit, contratos }) =>
        (!b || `${i.ref} ${i.descricao} ${i.endereco} ${i.cidade} ${i.observacoes}`.toLowerCase().includes(b))
        && (!this.tipo || i.tipo === this.tipo)
        && (!this.cidade || i.cidade === this.cidade)
        && (!this.titular || i.proprietarios?.some((x) => x.proprietarioId === this.titular))
        && (!this.situacao || (this.situacao === 'semcontrato' ? i.situacao === 'Alugado' && !contratos.length : sit === this.situacao)));
      const o = this.ordem;
      r = r.slice().sort((a, b2) => (o === 'ref' ? a.i.ref - b2.i.ref
        : o === 'mercado' ? (b2.i.valorMercado || 0) - (a.i.valorMercado || 0)
          : b2.aluguel - a.aluguel));
      return r;
    },
    totais() {
      return this.filtradas.reduce((t, x) => ({
        aluguel: t.aluguel + x.aluguel, mercado: t.mercado + (Number(x.i.valorMercado) || 0),
        declarado: t.declarado + (Number(x.i.valorDeclarado) || 0),
      }), { aluguel: 0, mercado: 0, declarado: 0 });
    },
  },
  template: `
  <section>
    <div class="titulo-pagina">
      <h1>Imóveis</h1>
      <button class="primario" @click="ir('#/imovel/novo')">+ Novo imóvel</button>
    </div>
    <div class="filtros">
      <input v-model="busca" type="search" placeholder="Buscar por endereço, ref., observação…" aria-label="Buscar">
      <select v-model="tipo" aria-label="Tipo"><option value="">Todos os tipos</option><option v-for="t in TIPOS">{{ t }}</option></select>
      <select v-model="situacao" aria-label="Situação">
        <option value="">Todas as situações</option><option v-for="s in SITUACOES">{{ s }}</option>
        <option value="semcontrato">Alugado sem contrato no sistema</option>
      </select>
      <select v-model="cidade" aria-label="Cidade"><option value="">Todas as cidades</option><option v-for="c in cidades">{{ c }}</option></select>
      <select v-model="titular" aria-label="Proprietário"><option value="">Todos os proprietários</option><option v-for="t in titulares" :value="t.id">{{ t.nome }}</option></select>
      <select v-model="ordem" aria-label="Ordenar"><option value="ref">Ordenar por Ref.</option><option value="mercado">Maior valor de mercado</option><option value="aluguel">Maior aluguel</option></select>
    </div>
    <div class="cartao sem-padding">
      <table class="tabela">
        <thead><tr><th>Ref.</th><th>Imóvel</th><th>Tipo</th><th>Cidade</th><th>Proprietário</th><th>Situação</th><th class="num">Aluguel</th><th class="num">Valor de mercado</th></tr></thead>
        <tbody>
          <tr v-for="{ i, sit, aluguel, contratos } in filtradas" :key="i.id" class="clicavel" @click="ir('#/imovel/' + i.id)">
            <td>{{ i.ref }}</td>
            <td class="desc">{{ i.descricao }}<small v-if="i.situacao === 'Alugado' && !contratos.length" class="tag-aviso">sem contrato no sistema</small></td>
            <td>{{ i.tipo }}</td><td>{{ i.cidade }}<span v-if="i.uf">/{{ i.uf }}</span></td><td>{{ nomesProprietarios(db, i) }}</td>
            <td><Chip :status="sit" /></td>
            <td class="num">{{ aluguel ? fmtMoeda(aluguel) : '—' }}</td>
            <td class="num">{{ fmtMoeda(i.valorMercado) }}</td>
          </tr>
          <tr v-if="!filtradas.length"><td colspan="8" class="vazio">Nenhum imóvel encontrado.</td></tr>
        </tbody>
        <tfoot><tr><td colspan="6">{{ filtradas.length }} imóvel(is)</td><td class="num">{{ fmtMoeda(totais.aluguel) }}</td><td class="num">{{ fmtMoeda(totais.mercado) }}</td></tr></tfoot>
      </table>
    </div>
  </section>`,
};

export const ImovelDetalhe = {
  components: { Chip, Anexos },
  props: { id: String },
  setup() { return { app, ...helpers, TIPOS, SITUACOES }; },
  data() { return { form: null, novo: false }; },
  created() { this.carregar(); },
  watch: { id() { this.carregar(); } },
  computed: {
    db,
    original() { return D.porId(this.db.imoveis, this.id); },
    contratos() {
      return this.db.contratos.filter((c) => c.imovelId === this.id)
        .map((c) => ({ c, inq: D.porId(this.db.inquilinos, c.inquilinoId) }))
        .sort((a, b) => (b.c.dataInicio || '').localeCompare(a.c.dataInicio || ''));
    },
    despesas() { return this.db.despesas.filter((d) => d.imovelId === this.id).sort((a, b) => b.data.localeCompare(a.data)); },
    somaPct() { return (this.form.proprietarios || []).reduce((t, x) => t + (Number(x.percentual) || 0), 0); },
    pastaAnexos() { return `Imoveis/Ref ${String(this.form.ref).padStart(2, '0')}`; },
    alterado() { return this.novo || JSON.stringify(this.form) !== JSON.stringify(this.original); },
  },
  methods: {
    carregar() {
      this.novo = this.id === 'novo';
      if (this.novo) {
        const prox = Math.max(0, ...this.db.imoveis.map((i) => Number(i.ref) || 0)) + 1;
        this.form = { id: novoId(), ref: prox, descricao: '', tipo: 'Loja', endereco: '', cidade: '', uf: 'MG', area: '', unidadeArea: 'm²',
          proprietarios: this.db.proprietarios?.[0] ? [{ proprietarioId: this.db.proprietarios[0].id, percentual: 100 }] : [],
          instalacaoEnergia: '', instalacaoAgua: '', anexos: [],
          matricula: '', cartorio: '', inscricaoIptu: '', valorDeclarado: 0, valorVenal: 0, valorMercado: 0,
          situacao: 'Vago', aluguelPlanilha: 0, declaraAluguel: false, observacoes: '' };
      } else {
        this.form = this.original ? clone(this.original) : null;
      }
    },
    adicionarAnexos(novos) {
      const id = this.form.id;
      app.store.commit(`Anexos no imóvel Ref. ${this.form.ref}: ${novos.map((a) => a.nome).join(', ')}`, (d) => {
        const i = D.porId(d.imoveis, id); (i.anexos ||= []).push(...novos);
      });
      this.form.anexos = [...(this.form.anexos || []), ...novos];
    },
    removerAnexo(a) {
      const id = this.form.id;
      app.store.commit(`Anexo removido do imóvel Ref. ${this.form.ref}: ${a.nome}`, (d) => {
        const i = D.porId(d.imoveis, id); i.anexos = i.anexos.filter((x) => !(x.webUrl === a.webUrl && x.nome === a.nome));
      });
      this.form.anexos = this.form.anexos.filter((x) => !(x.webUrl === a.webUrl && x.nome === a.nome));
    },
    addProprietario() { this.form.proprietarios.push({ proprietarioId: '', percentual: Math.max(0, 100 - this.somaPct) }); },
    salvar() {
      if (!this.form.descricao.trim()) { avisar('Informe a descrição do imóvel.', 'erro'); return; }
      this.form.proprietarios = this.form.proprietarios.filter((x) => x.proprietarioId);
      if (this.form.proprietarios.length && Math.abs(this.somaPct - 100) > 0.01) { avisar(`Os percentuais dos proprietários somam ${this.somaPct}%. Ajuste para 100%.`, 'erro'); return; }
      const f = clone(this.form);
      const quando = new Date().toISOString();
      if (this.novo) {
        app.store.commit(`Imóvel Ref. ${f.ref} cadastrado`, (d) => { d.imoveis.push({ ...f, criadoEm: quando, criadoPor: app.usuario }); });
        avisar('Imóvel cadastrado.');
        ir('#/imovel/' + f.id);
      } else {
        app.store.commit(`Imóvel Ref. ${f.ref} alterado`, (d) => {
          Object.assign(D.porId(d.imoveis, f.id), f, { atualizadoEm: quando, atualizadoPor: app.usuario });
        });
        avisar('Alterações salvas.');
      }
    },
    excluir() {
      if (this.contratos.length) { avisar('Este imóvel tem contratos. Encerre/exclua os contratos antes.', 'erro'); return; }
      if (!confirm(`Excluir o imóvel Ref. ${this.form.ref}? Esta ação não pode ser desfeita.`)) return;
      const id = this.form.id;
      app.store.commit(`Imóvel Ref. ${this.form.ref} excluído`, (d) => {
        d.imoveis = d.imoveis.filter((i) => i.id !== id);
        d.despesas = d.despesas.filter((x) => x.imovelId !== id);
      });
      ir('#/imoveis');
    },
  },
  template: `
  <section v-if="form">
    <div class="titulo-pagina">
      <div><a href="#/imoveis" class="voltar">← Imóveis</a><h1>{{ novo ? 'Novo imóvel' : 'Ref. ' + form.ref }}</h1></div>
      <div class="acoes">
        <button v-if="!novo" @click="ir('#/contrato/novo?imovel=' + form.id)">+ Nova locação</button>
        <button class="primario" :disabled="!alterado" @click="salvar">Salvar</button>
      </div>
    </div>

    <div class="cartao">
      <h2>Identificação</h2>
      <div class="form-grid">
        <label class="c1">Ref.<input v-model.number="form.ref" type="number" min="1"></label>
        <label class="c2">Tipo<select v-model="form.tipo"><option v-for="t in TIPOS">{{ t }}</option></select></label>
        <label class="c4">Situação<select v-model="form.situacao"><option v-for="s in SITUACOES">{{ s }}</option></select></label>
        <label class="c6">Descrição (como consta na escritura/declaração)<textarea v-model="form.descricao" rows="2"></textarea></label>
        <label class="c6">Endereço completo (usado nos contratos; se vazio, usa a descrição)<input v-model="form.endereco" placeholder="Rua, número, complemento, bairro, cidade/UF, CEP"></label>
        <label class="c3">Cidade<input v-model="form.cidade"></label>
        <label class="c1">UF<input v-model="form.uf" maxlength="2"></label>
        <label class="c1">Área<input v-model.number="form.area" type="number" step="0.01"></label>
        <label class="c1">Unidade<select v-model="form.unidadeArea"><option>m²</option><option>ha</option></select></label>
        <label class="c2">Matrícula<input v-model="form.matricula"></label>
        <label class="c2">Cartório<input v-model="form.cartorio" placeholder="Cartório de Registro de Imóveis de…"></label>
        <label class="c2">Inscrição IPTU<input v-model="form.inscricaoIptu"></label>
        <label class="c3">Nº instalação de energia<input v-model="form.instalacaoEnergia" placeholder="ex.: CEMIG / Neoenergia"></label>
        <label class="c3">Nº matrícula/ligação de água<input v-model="form.instalacaoAgua" placeholder="ex.: COPASA / CAESB"></label>
      </div>
    </div>

    <div class="cartao">
      <div class="cab-cartao"><h2>Proprietários</h2><a href="#/config">Cadastro de proprietários →</a></div>
      <table class="tabela compacta">
        <thead><tr><th>Proprietário</th><th class="num">Participação (%)</th><th>Dados para repasse</th><th></th></tr></thead>
        <tbody>
          <tr v-for="(x, k) in form.proprietarios" :key="k">
            <td><select v-model="x.proprietarioId"><option value="">Escolha…</option><option v-for="p in db.proprietarios" :value="p.id">{{ p.nome }}</option></select></td>
            <td class="num"><input v-model.number="x.percentual" type="number" min="0" max="100" step="0.01" style="max-width:110px"></td>
            <td><small>{{ (p => p ? [p.banco, p.agencia && 'ag. ' + p.agencia, p.conta && 'cc ' + p.conta, p.pix && 'PIX ' + p.pix].filter(Boolean).join(' · ') : '')(porId(db.proprietarios, x.proprietarioId)) || '—' }}</small></td>
            <td><button class="pequeno perigo" @click="form.proprietarios.splice(k, 1)" aria-label="Remover">✕</button></td>
          </tr>
        </tbody>
        <tfoot><tr><td><button class="pequeno" @click="addProprietario">+ Proprietário</button></td>
          <td class="num" :class="{ 'texto-ruim': Math.abs(somaPct - 100) > 0.01 }">{{ fmtNum(somaPct) }}%</td><td colspan="2"></td></tr></tfoot>
      </table>
      <p class="dica">Os proprietários entram como LOCADORES nos contratos gerados, com a participação de cada um.</p>
    </div>

    <div class="cartao">
      <h2>Valores</h2>
      <div class="form-grid">
        <label class="c2">Valor declarado (IR)<input v-model.number="form.valorDeclarado" type="number" step="0.01"></label>
        <label class="c2">Valor venal<input v-model.number="form.valorVenal" type="number" step="0.01"></label>
        <label class="c2">Valor de mercado<input v-model.number="form.valorMercado" type="number" step="0.01"></label>
        <label class="c2">Aluguel de referência (planilha)<input v-model.number="form.aluguelPlanilha" type="number" step="0.01"></label>
        <label class="c2 check"><input v-model="form.declaraAluguel" type="checkbox"> Aluguel declarado no IR</label>
        <label class="c6">Observações<textarea v-model="form.observacoes" rows="3"></textarea></label>
      </div>
      <p class="dica" v-if="contratos.some(x => x.c.status === 'ativo')">O aluguel exibido nas listas vem dos contratos ativos; o valor de referência é usado só quando não há contrato cadastrado.</p>
    </div>

    <div class="cartao" v-if="!novo">
      <h2>Contratos</h2>
      <p v-if="!contratos.length" class="vazio">Nenhum contrato cadastrado para este imóvel.</p>
      <table v-else class="tabela">
        <thead><tr><th>Inquilino</th><th>Unidade</th><th>Início</th><th>Fim</th><th class="num">Aluguel</th><th>Status</th></tr></thead>
        <tbody><tr v-for="{ c, inq } in contratos" :key="c.id" class="clicavel" @click="ir('#/contrato/' + c.id)">
          <td>{{ inq?.nome }}</td><td>{{ c.unidade || '—' }}</td><td>{{ fmtData(c.dataInicio) }}</td><td>{{ fmtData(fimContrato(c)) }}</td>
          <td class="num">{{ fmtMoeda(valorVigente(c)) }}</td><td><Chip :status="c.status" /></td>
        </tr></tbody>
      </table>
    </div>

    <div class="cartao" v-if="!novo">
      <h2>Fotos e documentos</h2>
      <Anexos :lista="form.anexos" :pasta="pastaAnexos" :categorias="['Foto', 'Escritura/Matrícula', 'IPTU', 'Planta/Projeto', 'Conta de energia/água', 'Outro']"
        @adicionar="adicionarAnexos" @remover="removerAnexo" />
    </div>

    <div class="cartao" v-if="!novo && despesas.length">
      <h2>Despesas</h2>
      <table class="tabela">
        <thead><tr><th>Data</th><th>Categoria</th><th>Descrição</th><th class="num">Valor</th></tr></thead>
        <tbody><tr v-for="d in despesas" :key="d.id"><td>{{ fmtData(d.data) }}</td><td>{{ d.categoria }}</td><td>{{ d.descricao }}</td><td class="num">{{ fmtMoeda(d.valor) }}</td></tr></tbody>
      </table>
    </div>

    <p v-if="!novo" class="rodape-acoes"><button class="perigo" @click="excluir">Excluir imóvel</button>
      <small v-if="original?.atualizadoPor">Última alteração: {{ original.atualizadoPor }} em {{ fmtData(original.atualizadoEm) }}</small></p>
  </section>
  <section v-else><p class="vazio">Imóvel não encontrado. <a href="#/imoveis">Voltar</a></p></section>`,
};
