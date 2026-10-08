import { CONFIG } from './config.js';
import { iniciarAuth } from './auth.js';
import { GraphStorage, MemoryStorage } from './storage.js';
import { Store, ARQUIVO_DB } from './db.js';
import { carregarIndices } from './indices.js';
import { dadosDemo } from './demo.js';
import { app, avisar } from './views/comum.js';
import { executarReajusteAutomatico } from './views/acoes.js';
import Painel from './views/painel.js';
import { ImoveisLista, ImovelDetalhe } from './views/imoveis.js';
import { InquilinosLista, InquilinoDetalhe } from './views/inquilinos.js';
import { ContratosLista, ContratoForm, ContratoDetalhe } from './views/contratos.js';
import { Financeiro } from './views/financeiro.js';
import { Reajustes } from './views/reajustes.js';
import { Configuracoes } from './views/configuracoes.js';

const { createApp, markRaw, reactive } = Vue;

// ---------- Rotas (hash) ----------
const ROTAS = [
  [/^$|^painel$/, Painel],
  [/^imoveis$/, ImoveisLista],
  [/^imovel\/([^/]+)$/, ImovelDetalhe],
  [/^inquilinos$/, InquilinosLista],
  [/^inquilino\/([^/]+)$/, InquilinoDetalhe],
  [/^contratos$/, ContratosLista],
  [/^contrato\/(novo)$/, ContratoForm],
  [/^contrato\/([^/]+)\/editar$/, ContratoForm],
  [/^contrato\/([^/]+)$/, ContratoDetalhe],
  [/^financeiro$/, Financeiro],
  [/^reajustes$/, Reajustes],
  [/^config$/, Configuracoes],
];

const MENU = [
  ['painel', 'Painel', '◧'], ['imoveis', 'Imóveis', '⌂'], ['inquilinos', 'Inquilinos', '☺'],
  ['contratos', 'Contratos', '▤'], ['financeiro', 'Financeiro', '$'], ['reajustes', 'Reajustes', '%'], ['config', 'Configurações', '⚙'],
];

function lerRota() {
  let h = location.hash.replace(/^#\/?/, '');
  if (/(^|&)(code|state|error)=/.test(h)) h = '';      // retorno do login Microsoft
  const [caminho, qs = ''] = h.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs));
  for (const [re, comp] of ROTAS) {
    const m = caminho.match(re);
    if (m) {
      const props = {};
      if (m[1] && comp !== Painel) props.id = decodeURIComponent(m[1]);
      if (comp.props?.query) props.query = query;
      return { comp: markRaw(comp), props, chave: h, secao: caminho.split('/')[0] || 'painel' };
    }
  }
  return { comp: markRaw(Painel), props: {}, chave: 'painel', secao: 'painel' };
}

const estado = reactive({ fase: 'iniciando', erro: '', rota: lerRota(), menuAberto: false, link: '' });
window.addEventListener('hashchange', () => { estado.rota = lerRota(); estado.menuAberto = false; window.scrollTo(0, 0); });

// ---------- Inicialização ----------
const params = new URLSearchParams(location.search);
const ehLocal = ['localhost', '127.0.0.1'].includes(location.hostname);

async function carregarDados() {
  const store = new Store(app.storage, app.usuario, Vue);
  app.store = markRaw(store);
  await store.carregar();
  window.addEventListener('beforeunload', (e) => {
    if (store.pendentes.length) { e.preventDefault(); e.returnValue = ''; }
  });
  estado.fase = 'pronto';
  tentarReajusteAutomatico();
}

let reajusteAutoFeito = false;
function tentarReajusteAutomatico() {
  if (reajusteAutoFeito || estado.fase !== 'pronto' || !app.indices || app.modo === 'demo') return;
  reajusteAutoFeito = true;
  try { executarReajusteAutomatico(); } catch (e) { console.error(e); }
}

async function iniciar() {
  carregarIndices().then((i) => { app.indices = i; tentarReajusteAutomatico(); }).catch((e) => { app.indicesErro = `Não foi possível carregar os índices: ${e.message}`; });
  try {
    if (params.has('demo')) {
      app.modo = 'demo';
      app.usuario = 'Visitante (demonstração)';
      app.storage = markRaw(new MemoryStorage({ [ARQUIVO_DB]: dadosDemo() }));
      app.pasta = await app.storage.conectar();
      return await carregarDados();
    }
    if (params.has('mock') && ehLocal) {
      // Teste local contra um servidor que imita o Microsoft Graph (dev/servidor.mjs).
      app.modo = 'onedrive';
      app.usuario = params.get('mock') || 'Teste';
      app.storage = markRaw(new GraphStorage({ getToken: async () => 'mock', pastaPadrao: CONFIG.pastaOneDrive,
        chaveLocal: 'imob.pasta.mock', graphBase: `${location.origin}/mock-graph` }));
      app.pasta = await app.storage.conectar();
      return await carregarDados();
    }
    if (!CONFIG.clientId) { estado.fase = 'semConfig'; return; }

    app.modo = 'onedrive';
    app.auth = markRaw(await iniciarAuth(CONFIG));
    if (!app.auth.conta()) { estado.fase = 'login'; return; }
    app.usuario = app.auth.nome();
    app.storage = markRaw(new GraphStorage({ getToken: () => app.auth.getToken(), pastaPadrao: CONFIG.pastaOneDrive,
      chaveLocal: `imob.pasta.${app.auth.conta().homeAccountId}` }));
    try {
      app.pasta = await app.storage.conectar();
    } catch (e) {
      if (e.pastaNaoEncontrada) { estado.fase = 'pasta'; estado.erro = e.message; return; }
      throw e;
    }
    await carregarDados();
  } catch (e) {
    console.error(e);
    estado.fase = 'erro';
    estado.erro = e.message || String(e);
  }
}

async function conectarLink() {
  try {
    app.pasta = await app.storage.conectarPorLink(estado.link);
    estado.fase = 'iniciando';
    await carregarDados();
  } catch (e) { estado.erro = e.message; }
}

// ---------- Casca ----------
const Raiz = {
  setup() {
    return { app, estado, MENU, CONFIG, conectarLink,
      entrar: () => app.auth.login(), sair: () => app.auth?.logout(),
      tentarDeNovo: () => app.store.salvar().catch(() => {}),
      recarregar: async () => {
        if (app.store.pendentes.length) { avisar('Aguarde o salvamento terminar.', 'erro'); return; }
        await app.store.carregar(); avisar('Dados atualizados.');
      },
    };
  },
  computed: {
    st() { return app.store?.state; },
    statusTexto() {
      const s = this.st?.status;
      return { salvo: 'Salvo', salvando: 'Salvando…', pendente: 'Salvando…', carregando: 'Carregando…', erro: 'Erro ao salvar' }[s] || '';
    },
  },
  template: `
  <div v-if="estado.fase === 'pronto'" class="layout" :class="{ 'menu-aberto': estado.menuAberto }">
    <aside class="lateral">
      <div class="marca"><span class="logo">CP</span><div><b>Campos Patrimonial</b><small>Gestão de imóveis</small></div></div>
      <nav>
        <a v-for="[k, rotulo, ic] in MENU" :key="k" :href="'#/' + k" :class="{ ativo: estado.rota.secao === k || (k === 'imoveis' && estado.rota.secao === 'imovel') || (k === 'inquilinos' && estado.rota.secao === 'inquilino') || (k === 'contratos' && estado.rota.secao === 'contrato') }">
          <span class="ic" aria-hidden="true">{{ ic }}</span>{{ rotulo }}</a>
      </nav>
      <div class="usuario">
        <small>{{ app.usuario }}</small>
        <small class="pasta" v-if="app.pasta">📁 {{ app.pasta.nome }}</small>
        <button v-if="app.auth" class="link" @click="sair">Sair</button>
        <a v-if="app.modo === 'demo'" href="./">Sair da demonstração</a>
      </div>
    </aside>
    <div class="principal">
      <header class="topo">
        <button class="icone menu-btn" @click="estado.menuAberto = !estado.menuAberto" aria-label="Menu">☰</button>
        <span v-if="app.modo === 'demo'" class="faixa-demo">Demonstração com dados fictícios. Nada é salvo.</span>
        <span class="espaco"></span>
        <span class="status-salvo" :class="st.status">{{ statusTexto }}</span>
        <button v-if="st.status === 'erro'" class="pequeno" @click="tentarDeNovo" :title="st.erro">Tentar de novo</button>
        <button class="pequeno" @click="recarregar" title="Buscar alterações feitas pela outra pessoa">↻ Atualizar</button>
      </header>
      <div v-if="st.erro && st.status === 'erro'" class="aviso-bloco erro">Não foi possível salvar: {{ st.erro }}. Suas alterações continuam nesta tela. Clique em “Tentar de novo”.</div>
      <div v-for="(a, k) in st.avisos" :key="k" class="aviso-bloco">{{ a }} <button class="link" @click="st.avisos.splice(k, 1)">ok</button></div>
      <main><component :is="estado.rota.comp" v-bind="estado.rota.props" :key="estado.rota.chave" /></main>
    </div>
    <div class="fundo-menu" @click="estado.menuAberto = false"></div>
  </div>

  <div v-else class="tela-entrada">
    <div class="caixa-entrada">
      <div class="marca grande"><span class="logo">CP</span><div><b>Campos Patrimonial</b><small>Gestão de imóveis e aluguéis</small></div></div>
      <template v-if="estado.fase === 'iniciando'"><p>Carregando…</p></template>
      <template v-else-if="estado.fase === 'login'">
        <p>Entre com sua conta Microsoft (a mesma do OneDrive) para acessar os dados.</p>
        <button class="primario grande" @click="entrar">Entrar com Microsoft</button>
      </template>
      <template v-else-if="estado.fase === 'semConfig'">
        <p>O sistema ainda não foi conectado ao Microsoft/OneDrive. Preencha o <code>clientId</code> em <code>js/config.js</code> seguindo o README.</p>
        <a class="botao" href="?demo">Ver demonstração com dados fictícios</a>
      </template>
      <template v-else-if="estado.fase === 'pasta'">
        <p>{{ estado.erro }}</p>
        <p class="dica">Peça para o dono da pasta compartilhá-la com você (com permissão de edição) ou cole abaixo o link de compartilhamento da pasta <b>Imobiliaria</b>.</p>
        <input v-model="estado.link" placeholder="https://1drv.ms/f/..." aria-label="Link da pasta">
        <button class="primario" @click="conectarLink">Conectar</button>
        <button class="link" @click="sair">Entrar com outra conta</button>
      </template>
      <template v-else-if="estado.fase === 'erro'">
        <p class="erro-campo">Erro: {{ estado.erro }}</p>
        <button class="primario" onclick="location.reload()">Tentar novamente</button>
        <button v-if="app.auth" class="link" @click="sair">Sair</button>
      </template>
    </div>
  </div>
  <div v-if="app.toast" class="toast" :class="app.toast.tipo" role="status">{{ app.toast.texto }}</div>`,
};

createApp(Raiz).mount('#app');
iniciar();
