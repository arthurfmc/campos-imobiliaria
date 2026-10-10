// Ações que geram documentos e registram no histórico do contrato.
import { app, db, avisar, gerarDocx, CONFIG } from './comum.js';
import * as D from '../db.js';
import {
  contratoBlocos, nomeArquivoContrato, notificacaoBlocos, nomeArquivoNotificacao, reciboBlocos, nomeArquivoRecibo,
  aditivoBlocos, nomeArquivoAditivo, vistoriaBlocos, nomeArquivoVistoria,
} from '../documentos.js';
import { periodoSugerido, calcularReajuste } from '../indices.js';
import { nomeArquivo, somaMeses, mesAtual, hojeISO, novoId, fmtPct } from '../util.js';

export async function gerarContratoDocx(contratoId) {
  const c = D.porId(db().contratos, contratoId);
  const doc = await gerarDocx(contratoBlocos(db(), c), nomeArquivoContrato(db(), c), CONFIG.pastaContratos);
  app.store.commit('Contrato gerado (.docx)', (d) => {
    const cc = D.porId(d.contratos, contratoId);
    (cc.documentos ||= []).unshift({ tipo: 'Contrato', ...doc });
  });
  avisar(doc.webUrl ? 'Contrato gerado e salvo na pasta Contratos do OneDrive.' : 'Contrato gerado.');
}

export async function gerarNotificacaoDocx(contratoId, reajusteId) {
  const c = D.porId(db().contratos, contratoId);
  const r = D.porId(c.reajustes, reajusteId);
  const doc = await gerarDocx(notificacaoBlocos(db(), c, r), nomeArquivoNotificacao(db(), c, r), CONFIG.pastaNotificacoes);
  app.store.commit('Notificação de reajuste gerada', (d) => {
    const cc = D.porId(d.contratos, contratoId);
    (cc.documentos ||= []).unshift({ tipo: 'Notificação de reajuste', ...doc });
    const rr = D.porId(cc.reajustes, reajusteId);
    if (rr) rr.notificadoEm = doc.criadoEm;
  });
  avisar('Notificação gerada.');
}

export async function gerarReciboDocx(contratoId, pagamentoId) {
  const c = D.porId(db().contratos, contratoId);
  const p = D.porId(db().pagamentos, pagamentoId);
  const doc = await gerarDocx(reciboBlocos(db(), c, p), nomeArquivoRecibo(db(), c, p), CONFIG.pastaRecibos);
  avisar(doc.webUrl ? 'Recibo gerado e salvo no OneDrive.' : 'Recibo gerado.');
}

// ---------- Pasta de cada contrato (anexos, vistorias, aditivos) ----------
export function pastaDoContrato(c) {
  const i = D.porId(db().imoveis, c.imovelId);
  const q = D.porId(db().inquilinos, c.inquilinoId);
  return `${CONFIG.pastaContratos}/${nomeArquivo(`Ref ${String(i?.ref ?? '').padStart(2, '0')} - ${q?.nome || 'contrato'}`)}`;
}

// Baixa as fotos (anexos com id) e prepara para entrar no documento.
export async function carregarFotos(anexos) {
  const fotos = [];
  for (const a of anexos.filter((x) => x.imagem && x.id)) {
    try {
      const blob = await app.storage.baixarArquivo(a.id);
      let { largura, altura } = a;
      if (!largura) { const bmp = await createImageBitmap(blob); largura = bmp.width; altura = bmp.height; }
      fotos.push({ data: new Uint8Array(await blob.arrayBuffer()), url: URL.createObjectURL(blob), largura, altura, legenda: a.descricao || a.nome });
    } catch (e) {
      avisar(`Não foi possível incluir a foto ${a.nome}: ${e.message}`, 'erro');
    }
  }
  return fotos;
}

export async function blocosVistoria(c, vs) {
  const entrada = vs.tipo === 'saida' ? (c.vistorias || []).filter((x) => x.tipo === 'entrada').sort((a, b) => b.data.localeCompare(a.data))[0] : null;
  return vistoriaBlocos(db(), c, vs, await carregarFotos(vs.fotos || []), entrada);
}

export async function gerarVistoriaDocx(contratoId, vistoriaId) {
  const c = D.porId(db().contratos, contratoId);
  const vs = D.porId(c.vistorias, vistoriaId);
  const doc = await gerarDocx(await blocosVistoria(c, vs), nomeArquivoVistoria(db(), c, vs), CONFIG.pastaLaudos);
  app.store.commit(`Termo de vistoria de ${vs.tipo} gerado`, (d) => {
    const cc = D.porId(d.contratos, contratoId);
    (cc.documentos ||= []).unshift({ tipo: `Vistoria de ${vs.tipo === 'saida' ? 'saída' : 'entrada'}`, ...doc });
  });
  avisar('Termo de vistoria gerado.');
}

export async function gerarAditivoDocx(contratoId, aditivoId) {
  const c = D.porId(db().contratos, contratoId);
  const a = D.porId(c.aditivos, aditivoId);
  const doc = await gerarDocx(aditivoBlocos(db(), c, a), nomeArquivoAditivo(db(), c, a), pastaDoContrato(c));
  app.store.commit(`${a.numero}º aditivo gerado`, (d) => {
    const cc = D.porId(d.contratos, contratoId);
    (cc.documentos ||= []).unshift({ tipo: `${a.numero}º termo aditivo`, ...doc });
  });
  avisar('Termo aditivo gerado.');
}

// ---------- Reajustes pendentes, em lote e automáticos ----------
// Contratos ativos com aniversário até `mesesAFrente` meses à frente, com o cálculo sugerido.
export function reajustesPendentes(d, indices, naoNegativo, mesesAFrente = 2) {
  if (!indices) return [];
  const lim = somaMeses(mesAtual(), mesesAFrente);
  return d.contratos.filter(D.contratoAtivo).map((c) => {
    const mes = D.proximoReajuste(c);
    const mapa = indices[c.indice];
    if (!mes || mes > lim || !mapa) return null;
    const per = periodoSugerido(mapa, mes);
    const r = calcularReajuste(mapa, D.valorVigente(c, mes), per.ini, per.fim, naoNegativo);
    return { c, mes, per, r, inq: D.porId(d.inquilinos, c.inquilinoId), im: D.porId(d.imoveis, c.imovelId),
      pronto: mes <= mesAtual() && !r.faltando.length };
  }).filter(Boolean).sort((a, b) => a.mes.localeCompare(b.mes));
}

export function montarReajuste(x, extra = {}) {
  return { id: novoId(), tipo: 'indice', indice: x.c.indice, periodoIni: x.per.ini, periodoFim: x.per.fim,
    pct: x.r.pct, pctAplicado: x.r.pctAplicado, valorAnterior: x.r.valorAnterior, valorNovo: x.r.valorNovo,
    vigenciaDesde: x.mes, meses: x.r.meses, dataNotificacao: hojeISO(),
    aplicadoEm: new Date().toISOString(), aplicadoPor: app.usuario, ...extra };
}

// Aplica vários reajustes numa única alteração; ignora contratos que já têm reajuste naquele mês.
export function aplicarReajustes(itens, automatico = false) {
  const lote = itens.map((x) => ({ cid: x.c.id, reaj: montarReajuste(x, automatico ? { automatico: true } : {}) }));
  if (!lote.length) return [];
  const desc = `${automatico ? 'Reajuste automático' : 'Reajuste em lote'}: ${itens.map((x) => `${x.inq?.nome || 'contrato'} ${fmtPct(x.r.pctAplicado)}`).join('; ')}`;
  app.store.commit(desc, (d) => {
    for (const { cid, reaj } of lote) {
      const c = D.porId(d.contratos, cid);
      if (!c || c.reajustes.some((r) => r.vigenciaDesde === reaj.vigenciaDesde)) continue;
      c.reajustes.push(reaj);
    }
  });
  return lote;
}

export function executarReajusteAutomatico() {
  const d = db();
  if (!d?.config.reajusteAutomatico || !app.indices) return;
  const prontos = reajustesPendentes(d, app.indices, d.config.naoAplicarIndiceNegativo !== false).filter((x) => x.pronto);
  if (prontos.length) {
    aplicarReajustes(prontos, true);
    avisar(`${prontos.length} reajuste(s) aplicado(s) automaticamente. Gere as notificações em Reajustes.`);
  }
}
