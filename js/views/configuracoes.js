import { app, db, helpers, avisar, Modal } from './comum.js';
import { clone, baixarBlob, hojeISO, novoId, docValido } from '../util.js';
import { proprietarioVazio } from '../db.js';

const ProprietarioModal = {
  components: { Modal },
  props: { prop: Object },
  emits: ['fechar'],
  setup() { return helpers; },
  data() { return { f: { ...proprietarioVazio(), ...clone(this.prop) } }; },
  computed: {
    db,
    novo() { return !this.db.proprietarios.some((p) => p.id === this.f.id); },
    emUso() { return this.db.imoveis.filter((i) => i.proprietarios?.some((x) => x.proprietarioId === this.f.id)).map((i) => i.ref); },
  },
  methods: {
    salvar() {
      if (!this.f.nome.trim()) { avisar('Informe o nome.', 'erro'); return; }
      if (this.f.cpf && !docValido(this.f.cpf)) { avisar('CPF/CNPJ inválido.', 'erro'); return; }
      const f = clone(this.f);
      const novo = this.novo;
      app.store.commit(`Proprietário ${f.nome} ${novo ? 'cadastrado' : 'alterado'}`, (d) => {
        if (novo) d.proprietarios.push(f); else Object.assign(d.proprietarios.find((p) => p.id === f.id), f);
      });
      this.$emit('fechar');
    },
    excluir() {
      if (this.emUso.length) { avisar(`Proprietário vinculado aos imóveis Ref. ${this.emUso.join(', ')}.`, 'erro'); return; }
      if (!confirm(`Excluir ${this.f.nome}?`)) return;
      const id = this.f.id;
      app.store.commit(`Proprietário ${this.f.nome} excluído`, (d) => { d.proprietarios = d.proprietarios.filter((p) => p.id !== id); });
      this.$emit('fechar');
    },
  },
  template: `
  <Modal :titulo="novo ? 'Novo proprietário' : f.nome" largo @fechar="$emit('fechar')">
    <div class="form-grid">
      <label class="c4">Nome completo / razão social<input v-model="f.nome"></label>
      <label class="c2">Tipo<select v-model="f.tipo"><option value="PF">Pessoa física</option><option value="PJ">Pessoa jurídica (holding)</option></select></label>
      <label class="c2">{{ f.tipo === 'PJ' ? 'CNPJ' : 'CPF' }}<input v-model="f.cpf" @blur="f.cpf = fmtCpfCnpj(f.cpf)"></label>
      <template v-if="f.tipo === 'PF'">
        <label class="c2">RG<input v-model="f.rg"></label>
        <label class="c2">Nacionalidade<input v-model="f.nacionalidade"></label>
        <label class="c2">Estado civil<input v-model="f.estadoCivil" placeholder="casado(a) em comunhão…"></label>
        <label class="c2">Profissão<input v-model="f.profissao"></label>
      </template>
      <template v-else>
        <label class="c2">Representante legal<input v-model="f.representante"></label>
        <label class="c2">CPF do representante<input v-model="f.representanteCpf"></label>
      </template>
      <label class="c2">Telefone<input v-model="f.telefone"></label>
      <label class="c4">Endereço completo<input v-model="f.endereco"></label>
      <label class="c2">E-mail<input v-model="f.email"></label>
      <h3 class="c6">Dados bancários para repasse</h3>
      <label class="c2">Banco<input v-model="f.banco"></label>
      <label class="c1">Agência<input v-model="f.agencia"></label>
      <label class="c1">Conta<input v-model="f.conta"></label>
      <label class="c2">Chave PIX<input v-model="f.pix"></label>
    </div>
    <p v-if="emUso.length" class="dica">Proprietário dos imóveis Ref. {{ emUso.join(', ') }}.</p>
    <template #rodape>
      <button v-if="!novo" class="perigo" @click="excluir">Excluir</button><span class="espaco"></span>
      <button @click="$emit('fechar')">Cancelar</button><button class="primario" @click="salvar">Salvar</button>
    </template>
  </Modal>`,
};

export const Configuracoes = {
  components: { ProprietarioModal },
  setup() { return { app, ...helpers }; },
  data() { return { f: clone(app.store.state.db.config), link: '', conectando: false, logN: 50, prop: null }; },
  computed: {
    db,
    alterado() { return JSON.stringify(this.f) !== JSON.stringify(this.db.config); },
  },
  methods: {
    novoProprietario() { this.prop = { ...proprietarioVazio(), id: novoId() }; },
    imoveisDe(p) { return this.db.imoveis.filter((i) => i.proprietarios?.some((x) => x.proprietarioId === p.id)).length; },
    salvar() {
      const f = clone(this.f);
      app.store.commit('Configurações alteradas', (d) => { d.config = f; });
      avisar('Configurações salvas.');
    },
    exportar() {
      const blob = new Blob([JSON.stringify(this.db, null, 1)], { type: 'application/json' });
      baixarBlob(blob, `imobiliaria-backup-${hojeISO()}.json`);
    },
    async conectarLink() {
      if (!this.link.trim()) return;
      this.conectando = true;
      try {
        app.pasta = await app.storage.conectarPorLink(this.link);
        await app.store.carregar();
        avisar(`Conectado à pasta ${app.pasta.nome}.`);
        this.link = '';
      } catch (e) { avisar(e.message, 'erro'); }
      this.conectando = false;
    },
  },
  template: `
  <section>
    <div class="titulo-pagina"><h1>Configurações</h1><button class="primario" :disabled="!alterado" @click="salvar">Salvar</button></div>

    <div class="cartao">
      <div class="cab-cartao"><h2>Proprietários (locadores nos contratos e recibos)</h2><button class="pequeno" @click="novoProprietario">+ Proprietário</button></div>
      <table class="tabela">
        <thead><tr><th>Nome</th><th>CPF/CNPJ</th><th>Repasse</th><th class="num">Imóveis</th></tr></thead>
        <tbody><tr v-for="p in db.proprietarios" :key="p.id" class="clicavel" @click="prop = p">
          <td>{{ p.nome }}<small v-if="!p.cpf" class="tag-aviso">complete o cadastro (CPF, endereço…)</small></td><td>{{ fmtCpfCnpj(p.cpf) }}</td>
          <td><small>{{ [p.banco, p.pix && 'PIX ' + p.pix].filter(Boolean).join(' · ') || '—' }}</small></td><td class="num">{{ imoveisDe(p) }}</td></tr></tbody>
      </table>
      <p class="dica">O percentual de cada proprietário é definido na ficha de cada imóvel.</p>
    </div>

    <div class="cartao">
      <h2>Padrões dos contratos</h2>
      <div class="form-grid">
        <label class="c2">Foro (comarca)<input v-model="f.foro" placeholder="Três Marias - MG"></label>
        <label class="c1">Multa por atraso (%)<input type="number" step="0.1" v-model.number="f.multaAtrasoPct"></label>
        <label class="c1">Juros ao mês (%)<input type="number" step="0.1" v-model.number="f.jurosMesPct"></label>
        <label class="c2">Multa rescisória (nº de aluguéis)<input type="number" v-model.number="f.multaRescisoriaAlugueis"></label>
        <label class="c6 check"><input type="checkbox" v-model="f.naoAplicarIndiceNegativo"> Quando o índice acumulado for negativo, manter o aluguel (não reduzir)</label>
        <label class="c6 check"><input type="checkbox" v-model="f.reajusteAutomatico"> Aplicar reajustes automaticamente no mês de aniversário, assim que o índice estiver divulgado (as notificações continuam sendo geradas em Reajustes)</label>
      </div>
    </div>

    <div class="cartao">
      <h2>Dados</h2>
      <p>Pasta: <b>{{ app.pasta?.nome }}</b> <a v-if="app.pasta?.webUrl" :href="app.pasta.webUrl" target="_blank" rel="noopener">abrir no OneDrive ↗</a></p>
      <p class="dica">Os dados ficam em <code>dados/imobiliaria.json</code>, com uma cópia de segurança diária em <code>dados/backups/</code>. Contratos, notificações e recibos ficam nas pastas <code>Contratos</code>, <code>Notificacoes</code> e <code>Recibos</code>.</p>
      <div class="linha-botoes"><button @click="exportar">Baixar cópia dos dados (.json)</button></div>
      <div v-if="app.modo === 'onedrive'" class="sub-bloco">
        <h3>Usar outra pasta</h3>
        <p class="dica">Se a pasta não foi encontrada automaticamente, cole aqui o link de compartilhamento da pasta <b>Imobiliaria</b> (OneDrive → Compartilhar → Copiar link).</p>
        <div class="linha-botoes"><input v-model="link" placeholder="https://1drv.ms/f/..." style="flex:1"><button @click="conectarLink" :disabled="conectando">Conectar</button></div>
      </div>
    </div>

    <ProprietarioModal v-if="prop" :prop="prop" @fechar="prop = null" />

    <div class="cartao">
      <h2>Histórico de alterações</h2>
      <table class="tabela compacta">
        <thead><tr><th>Quando</th><th>Quem</th><th>O que</th></tr></thead>
        <tbody><tr v-for="(l, k) in db.log.slice(0, logN)" :key="k">
          <td class="nowrap">{{ new Date(l.quando).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) }}</td><td>{{ l.quem }}</td><td>{{ l.acao }}</td></tr></tbody>
      </table>
      <button v-if="db.log.length > logN" class="pequeno" @click="logN += 100">Ver mais</button>
    </div>
  </section>`,
};
