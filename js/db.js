// Base de dados (um arquivo JSON no OneDrive) + regras de negócio.
import { clone, hojeISO, mesAtual, somaMeses, somaMesesData, diaMenos1, vencimentoDe, novoId } from './util.js';
import { ConflitoError } from './storage.js';

export const ARQUIVO_DB = 'dados/imobiliaria.json';

export const VERSAO_DB = 2;

export function dbVazio() {
  return {
    versao: VERSAO_DB,
    config: {
      locador: { nome: '', nacionalidade: 'brasileiro', estadoCivil: '', profissao: '', cpf: '', rg: '', endereco: '', email: '', telefone: '' },
      foro: '', multaAtrasoPct: 10, jurosMesPct: 1, jurosAposDias: 30, correcaoMonetaria: true,
      multaRescisoriaAlugueis: 3, naoAplicarIndiceNegativo: true, reajusteAutomatico: false,
    },
    proprietarios: [], imoveis: [], inquilinos: [], contratos: [], pagamentos: [], despesas: [], log: [],
  };
}

const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Migração para a versão 2: cadastro de proprietários (a partir do locador e dos titulares).
// Os ids são derivados dos nomes para que duas pessoas migrando ao mesmo tempo gerem o mesmo resultado.
function migrarV2(db) {
  if (!db.proprietarios) db.proprietarios = [];
  const loc = db.config.locador || {};
  const primeiroNome = slug(loc.nome).split('-')[0];
  const garantir = (titular) => {
    const chave = slug(titular) || 'proprietario';
    const id = `prop-${chave}`;
    if (!db.proprietarios.some((p) => p.id === id)) {
      const ehLocador = loc.nome && (chave === primeiroNome || slug(loc.nome) === chave);
      db.proprietarios.push({ ...proprietarioVazio(), ...(ehLocador ? loc : {}), id, nome: ehLocador ? loc.nome : titular });
    }
    return id;
  };
  for (const i of db.imoveis) {
    if (!i.proprietarios?.length) i.proprietarios = [{ proprietarioId: garantir(i.titular || loc.nome || 'Proprietário'), percentual: 100 }];
  }
  db.versao = VERSAO_DB;
}

export function proprietarioVazio() {
  return { id: '', nome: '', tipo: 'PF', cpf: '', rg: '', nacionalidade: 'brasileiro(a)', estadoCivil: '', profissao: '',
    endereco: '', email: '', telefone: '', banco: '', agencia: '', conta: '', pix: '' };
}

function normalizar(db) {
  const base = dbVazio();
  for (const k of Object.keys(base)) if (db[k] === undefined && k !== 'proprietarios') db[k] = base[k];
  db.config = { ...base.config, ...db.config, locador: { ...base.config.locador, ...db.config?.locador } };
  if ((db.versao || 1) < 2 || !db.proprietarios) migrarV2(db);
  for (const i of db.imoveis) { i.anexos ||= []; i.proprietarios ||= []; }
  for (const q of db.inquilinos) q.ocorrencias ||= [];
  for (const c of db.contratos) {
    c.reajustes ||= []; c.documentos ||= []; c.anexos ||= []; c.aditivos ||= []; c.vistorias ||= [];
    c.garantia = normalizarGarantia(c.garantia);
    c.atraso ||= regrasAtrasoPadrao(db.config, c);
  }
  return db;
}

export function fiadorVazio() {
  return { nome: '', cpf: '', rg: '', nacionalidade: 'brasileiro(a)', estadoCivil: '', profissao: '', endereco: '',
    telefone: '', email: '', conjugeNome: '', conjugeCpf: '' };
}

// Garantia: tipo único (a Lei 8.245/91, art. 37, parágrafo único, veda mais de uma modalidade),
// mas com quantos fiadores forem necessários.
export function normalizarGarantia(g) {
  g = { tipo: 'nenhuma', vencimento: '', fiadores: [], caucaoModalidade: 'dinheiro', caucaoValor: 0, caucaoDescricao: '',
    seguradora: '', apolice: '', instituicao: '', numeroTitulo: '', valorTitulo: 0, mesesAntecipados: 0, ...(g || {}) };
  if (!g.fiadores.length && g.fiadorNome) {
    // Formato antigo (um campo de texto): "A e B; C e D" vira uma lista.
    const nomes = g.fiadorNome.split(/;|\s+e\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ])/).map((n) => n.trim()).filter(Boolean);
    g.fiadores = nomes.map((nome, k) => ({ ...fiadorVazio(), nome,
      ...(k === 0 ? { cpf: g.fiadorCpf || '', rg: g.fiadorRg || '', estadoCivil: g.fiadorEstadoCivil || '', profissao: g.fiadorProfissao || '',
        endereco: g.fiadorEndereco || '', nacionalidade: g.fiadorNacionalidade || 'brasileiro(a)', conjugeNome: g.fiadorConjuge || '' } : {}) }));
  }
  for (const k of ['fiadorNome', 'fiadorCpf', 'fiadorRg', 'fiadorEstadoCivil', 'fiadorProfissao', 'fiadorEndereco', 'fiadorNacionalidade', 'fiadorConjuge']) delete g[k];
  g.fiadores = g.fiadores.map((f) => ({ ...fiadorVazio(), ...f }));
  return g;
}

// Regras de atraso de cada contrato (multa, juros, correção).
export function regrasAtrasoPadrao(cfg, c) {
  const vaga = /garagem/i.test(`${c?.atividade} ${c?.unidade}`);
  return { multaPct: Number(cfg.multaAtrasoPct ?? 10), jurosMesPct: vaga ? 0 : Number(cfg.jurosMesPct ?? 1),
    jurosAposDias: Number(cfg.jurosAposDias ?? 30), correcao: vaga ? false : cfg.correcaoMonetaria !== false };
}

const dias = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);

// Encargos de atraso de uma parcela, pela regra do contrato.
// Multa sempre que pago após o vencimento; juros (pro rata) e correção só se o atraso passar de `jurosAposDias`.
export function calcularEncargos(c, valor, vencimento, dataRef, indices) {
  const r = c.atraso || { multaPct: 10, jurosMesPct: 1, jurosAposDias: 30, correcao: true };
  const d = Math.max(0, dias(vencimento, dataRef));
  const vazio = { dias: d, correcao: 0, multa: 0, juros: 0, total: 0, base: valor, regra: r };
  if (!d || !valor) return vazio;
  const longo = d > Number(r.jurosAposDias || 0);
  let fator = 1;
  if (longo && r.correcao && indices?.[c.indice]) {
    const mapa = indices[c.indice];
    for (let ym = vencimento.slice(0, 7); ym < dataRef.slice(0, 7); ym = somaMeses(ym, 1)) {
      if (mapa[ym] !== undefined) fator *= 1 + mapa[ym] / 100;
    }
    fator = Math.max(1, fator);
  }
  const base = valor * fator;
  const correcao = base - valor;
  const multa = base * Number(r.multaPct || 0) / 100;
  const juros = longo ? base * Number(r.jurosMesPct || 0) / 100 / 30 * d : 0;
  const arr = (x) => Math.round(x * 100) / 100;
  return { dias: d, correcao: arr(correcao), multa: arr(multa), juros: arr(juros), total: arr(correcao + multa + juros), base: arr(base), regra: r };
}

// ---------------------------------------------------------------------------
// Store: mantém a cópia local, aplica alterações na hora e salva em segundo plano.
// Cada alteração é uma função determinística; se outra pessoa salvou antes,
// o arquivo é relido e as alterações pendentes são reaplicadas por cima.
// ---------------------------------------------------------------------------
export class Store {
  constructor(storage, usuario, Vue) {
    this.storage = storage;
    this.usuario = usuario;
    this.remoto = null;
    this.etag = null;
    this.pendentes = [];
    this.salvandoPromise = null;
    this.backupFeito = false;
    this.state = Vue.reactive({ db: null, status: 'carregando', erro: '', ultimoSalvo: null, avisos: [] });
  }

  get db() { return this.state.db; }

  async carregar() {
    this.state.status = 'carregando';
    const r = await this.storage.lerJson(ARQUIVO_DB);
    if (r) {
      this.remoto = normalizar(r.data);
      this.etag = r.etag;
    } else {
      this.remoto = dbVazio();
      this.etag = null;
    }
    this.reconstruir();
    this.state.status = this.pendentes.length ? 'pendente' : 'salvo';
  }

  reconstruir() {
    const db = clone(this.remoto);
    for (const op of this.pendentes) this.aplicar(db, op);
    this.state.db = db;
  }

  aplicar(db, op) {
    try {
      op.fn(db);
      db.log.unshift({ quando: op.quando, quem: op.quem, acao: op.descricao });
      if (db.log.length > 500) db.log.length = 500;
      db.atualizadoEm = op.quando;
      db.atualizadoPor = op.quem;
    } catch (e) {
      this.state.avisos.push(`Não foi possível aplicar "${op.descricao}": ${e.message}`);
    }
  }

  // Registra uma alteração. fn(db) deve ser determinística (gere ids/datas fora dela).
  commit(descricao, fn) {
    const op = { descricao, fn, quando: new Date().toISOString(), quem: this.usuario };
    this.pendentes.push(op);
    this.aplicar(this.state.db, op);
    this.state.status = 'pendente';
    // Erros ficam visíveis em state.status/state.erro; o botão "Tentar de novo" chama salvar().
    return this.salvar().catch(() => {});
  }

  salvar() {
    if (!this.salvandoPromise) {
      this.salvandoPromise = this._salvar().finally(() => { this.salvandoPromise = null; });
    }
    return this.salvandoPromise;
  }

  async _salvar() {
    this.state.status = 'salvando';
    this.state.erro = '';
    for (let tentativa = 0; tentativa < 6; tentativa++) {
      if (!this.pendentes.length) { this.state.status = 'salvo'; return; }
      const lote = this.pendentes.slice();
      const novo = clone(this.remoto);
      for (const op of lote) this.aplicar(novo, op);
      try {
        await this.backupDiario();
        this.etag = await this.storage.gravarJson(ARQUIVO_DB, novo, this.etag);
        this.remoto = novo;
        this.pendentes = this.pendentes.slice(lote.length);
        this.state.ultimoSalvo = new Date().toISOString();
      } catch (e) {
        if (!(e instanceof ConflitoError) && !e.conflito) {
          this.state.status = 'erro';
          this.state.erro = e.message;
          throw e;
        }
        // Outra pessoa salvou: recarrega e reaplica as alterações pendentes.
        const r = await this.storage.lerJson(ARQUIVO_DB);
        this.remoto = r ? normalizar(r.data) : dbVazio();
        this.etag = r ? r.etag : null;
        this.reconstruir();
      }
    }
    // Ao final, se houver novas pendências feitas durante o salvamento, continua.
    if (this.pendentes.length) return this._salvar();
    this.state.status = 'salvo';
  }

  // Uma cópia por dia, feita antes do primeiro salvamento do dia nesta sessão.
  async backupDiario() {
    if (this.backupFeito || !this.etag) return;
    this.backupFeito = true;
    try {
      const nome = `dados/backups/imobiliaria-${hojeISO()}.json`;
      await this.storage.gravarJson(nome, this.remoto, null);
    } catch { /* já existe backup de hoje ou falhou: não bloqueia */ }
  }
}

// ---------------------------------------------------------------------------
// Regras de negócio
// ---------------------------------------------------------------------------
export const porId = (lista, id) => lista.find((x) => x.id === id);

export const contratoAtivo = (c) => c.status === 'ativo';

export function fimContrato(c) {
  if (c.dataFim) return c.dataFim;
  if (!c.dataInicio || !c.prazoMeses) return '';
  return diaMenos1(somaMesesData(c.dataInicio, Number(c.prazoMeses)));
}

// Valor do aluguel vigente em uma competência, considerando os reajustes aplicados.
export function valorVigente(c, ym = mesAtual()) {
  let v = Number(c.valorInicial) || 0;
  const rs = [...(c.reajustes || [])].sort((a, b) => a.vigenciaDesde.localeCompare(b.vigenciaDesde));
  for (const r of rs) if (r.vigenciaDesde <= ym) v = Number(r.valorNovo);
  return v;
}

// Mês do próximo reajuste (aniversário), a partir do início ou do último reajuste.
export function proximoReajuste(c) {
  if (!c.dataInicio) return null;
  const per = Number(c.periodicidadeMeses) || 12;
  // Alterações de valor por aditivo não mudam o aniversário do reajuste anual.
  const ultimo = (c.reajustes || []).filter((r) => r.tipo !== 'aditivo')
    .sort((a, b) => b.vigenciaDesde.localeCompare(a.vigenciaDesde))[0];
  const base = ultimo ? ultimo.vigenciaDesde : c.dataInicio.slice(0, 7);
  let prox = somaMeses(base, per);
  // Se um aditivo já fixou novo valor exatamente no mês do aniversário, o reajuste daquele ano está feito.
  while ((c.reajustes || []).some((r) => r.tipo === 'aditivo' && r.vigenciaDesde === prox)) prox = somaMeses(prox, per);
  return prox;
}

// Cobranças esperadas de uma competência para todos os contratos ativos.
export function cobrancasDoMes(db, ym, indices = null) {
  const res = [];
  const hoje = hojeISO();
  for (const c of db.contratos) {
    if (c.status === 'cancelado') continue;
    const inicio = c.controleDesde || c.dataInicio?.slice(0, 7);
    if (!inicio || ym < inicio) continue;
    if (c.dataInicio && ym < c.dataInicio.slice(0, 7)) continue;
    const fim = c.status === 'encerrado' ? (c.dataEncerramento || fimContrato(c)).slice(0, 7) : null;
    if (fim && ym > fim) continue;
    const pagamento = db.pagamentos.find((p) => p.contratoId === c.id && p.competencia === ym);
    const venc = vencimentoDe(ym, c.diaVencimento);
    const valor = valorVigente(c, ym);
    let status = 'aberto';
    if (pagamento) status = Number(pagamento.valorPago) + (Number(pagamento.descontos) || 0) + 0.009 >= valor ? 'pago' : 'parcial';
    else if (venc < hoje) status = 'atrasado';
    // Encargos devidos: no dia do pagamento (se pago) ou atualizados até hoje (se em aberto).
    const encargos = calcularEncargos(c, valor, venc, pagamento?.dataPagamento || hoje, indices);
    const cobrado = Number(pagamento?.acrescimos) || 0;
    const aCobrar = pagamento ? Math.max(0, Math.round((encargos.total - cobrado - (Number(pagamento.encargosDispensados) || 0)) * 100) / 100) : encargos.total;
    res.push({ contrato: c, competencia: ym, vencimento: venc, valor, pagamento, status, encargos, aCobrar,
      pagoComAtraso: !!pagamento && pagamento.dataPagamento > venc });
  }
  return res.sort((a, b) => a.vencimento.localeCompare(b.vencimento));
}

export function cobrancasEmAtraso(db, indices = null) {
  const hoje = mesAtual();
  const res = [];
  for (const c of db.contratos) {
    if (c.status === 'cancelado') continue;
    const inicio = c.controleDesde || c.dataInicio?.slice(0, 7);
    if (!inicio) continue;
    for (let ym = inicio; ym <= hoje; ym = somaMeses(ym, 1)) {
      for (const cob of cobrancasDoMes({ ...db, contratos: [c] }, ym, indices)) {
        if (cob.status === 'atrasado' || (cob.status === 'parcial' && cob.vencimento < hojeISO())) res.push(cob);
      }
    }
  }
  return res;
}

// Pagamentos feitos com atraso em que a multa/juros cobrados ficaram abaixo do devido.
export function encargosNaoCobrados(db, indices = null) {
  const res = [];
  for (const p of db.pagamentos) {
    const c = porId(db.contratos, p.contratoId);
    if (!c) continue;
    const [cob] = cobrancasDoMes({ ...db, contratos: [c], pagamentos: [p] }, p.competencia, indices);
    if (cob && cob.pagoComAtraso && cob.aCobrar > 0.009) res.push(cob);
  }
  return res.sort((a, b) => b.competencia.localeCompare(a.competencia));
}

export function situacaoImovel(db, imovel) {
  const ativos = db.contratos.filter((c) => c.imovelId === imovel.id && contratoAtivo(c));
  if (ativos.length) return 'Alugado';
  return imovel.situacao || 'Vago';
}

export function aluguelImovel(db, imovel) {
  const ativos = db.contratos.filter((c) => c.imovelId === imovel.id && contratoAtivo(c));
  if (ativos.length) return ativos.reduce((s, c) => s + valorVigente(c), 0);
  return imovel.situacao === 'Alugado' ? Number(imovel.aluguelPlanilha) || 0 : 0;
}

export function nomeImovel(i) {
  if (!i) return '—';
  return `Ref. ${String(i.ref).padStart(2, '0')} · ${i.descricao}`;
}

export function alertas(db) {
  const hoje = mesAtual();
  const lista = [];
  for (const c of db.contratos.filter(contratoAtivo)) {
    const imovel = porId(db.imoveis, c.imovelId);
    const inq = porId(db.inquilinos, c.inquilinoId);
    const rotulo = `${inq?.nome || 'Inquilino'} — Ref. ${imovel?.ref ?? '?'}`;
    const pr = proximoReajuste(c);
    if (pr && pr <= somaMeses(hoje, 2)) {
      lista.push({ tipo: pr < hoje ? 'erro' : 'aviso', texto: `Reajuste ${pr < hoje ? 'atrasado' : 'previsto'} (${c.indice}) em ${pr.slice(5)}/${pr.slice(0, 4)}: ${rotulo}`, link: `#/reajustes?contrato=${c.id}` });
    }
    const gv = garantiaVencimento(c);
    if (gv && gv.slice(0, 7) <= somaMeses(hoje, 2)) {
      lista.push({ tipo: gv < hojeISO() ? 'erro' : 'aviso', texto: `Garantia ${gv < hojeISO() ? 'vencida' : 'vence'} em ${gv.split('-').reverse().join('/')}: ${rotulo}`, link: `#/contrato/${c.id}` });
    }
    const fim = fimContrato(c);
    if (fim && fim.slice(0, 7) <= somaMeses(hoje, 3)) {
      lista.push({ tipo: fim < hojeISO() ? 'erro' : 'aviso', texto: `Contrato ${fim < hojeISO() ? 'vencido' : 'vence'} em ${fim.split('-').reverse().join('/')}: ${rotulo}`, link: `#/contrato/${c.id}` });
    }
  }
  const atrasos = cobrancasEmAtraso(db);
  if (atrasos.length) {
    lista.push({ tipo: 'erro', texto: `${atrasos.length} aluguel(is) em atraso`, link: '#/financeiro' });
  }
  const semContrato = db.imoveis.filter((i) => i.situacao === 'Alugado'
    && !db.contratos.some((c) => c.imovelId === i.id && contratoAtivo(c)));
  if (semContrato.length) {
    lista.push({ tipo: 'info', texto: `${semContrato.length} imóvel(is) marcados como alugados sem contrato cadastrado no sistema`, link: '#/imoveis?filtro=semcontrato' });
  }
  return lista;
}

// Proprietários do imóvel com percentual. Sem cadastro, usa o locador das configurações.
export function proprietariosDoImovel(db, imovel) {
  const lista = (imovel?.proprietarios || [])
    .map((x) => ({ p: porId(db.proprietarios || [], x.proprietarioId), percentual: Number(x.percentual) || 0 }))
    .filter((x) => x.p);
  return lista.length ? lista : [{ p: { ...db.config.locador, id: 'locador' }, percentual: 100 }];
}

// Multa por devolução antecipada (art. 4º da Lei 8.245/91): proporcional ao prazo que falta cumprir.
export function multaRescisoria(c, dataSaida, cfg) {
  const fim = fimContrato(c);
  const ms = (a, b) => (new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000;
  const total = Math.max(1, ms(c.dataInicio, fim) + 1);
  const restante = Math.max(0, ms(dataSaida, fim));
  const aluguel = valorVigente(c, dataSaida.slice(0, 7));
  const multaCheia = (Number(cfg.multaRescisoriaAlugueis) || 0) * aluguel;
  const fator = restante / total;
  return {
    aluguel, multaCheia, diasTotal: total, diasRestantes: restante,
    mesesRestantes: Math.round(restante / 30.4375 * 10) / 10,
    fator, valor: Math.round(multaCheia * fator * 100) / 100,
  };
}

export function garantiaVencimento(c) {
  return c.garantia && c.garantia.tipo !== 'nenhuma' ? (c.garantia.vencimento || '') : '';
}

export { novoId };
