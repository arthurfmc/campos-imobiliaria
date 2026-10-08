// Índices de reajuste (IGP-M e IPCA) via API pública do Banco Central (SGS).
import { somaMeses, difMeses, arred2 } from './util.js';

export const INDICES = {
  'IGP-M': { serie: 189, nome: 'IGP-M (FGV)', fonte: 'FGV' },
  'IPCA': { serie: 433, nome: 'IPCA (IBGE)', fonte: 'IBGE' },
  'INPC': { serie: 188, nome: 'INPC (IBGE)', fonte: 'IBGE' },
  'IGP-DI': { serie: 190, nome: 'IGP-DI (FGV)', fonte: 'FGV' },
  'IPC-Fipe': { serie: 193, nome: 'IPC (FIPE)', fonte: 'FIPE' },
};

const CACHE = 'imob.indices.v2';
const VALIDADE_MS = 6 * 3600 * 1000;

// Retorna { 'IGP-M': { 'AAAA-MM': pct }, 'IPCA': {...}, atualizadoEm }
export async function carregarIndices(forcar = false) {
  let cache = null;
  try { cache = JSON.parse(localStorage.getItem(CACHE)); } catch { /* sem cache */ }
  if (!forcar && cache && Date.now() - cache.ts < VALIDADE_MS) return cache.dados;

  try {
    const dados = { atualizadoEm: new Date().toISOString() };
    await Promise.all(Object.entries(INDICES).map(async ([nome, { serie }]) => {
      const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${serie}/dados?formato=json&dataInicial=01/01/2000`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`Banco Central respondeu ${r.status} para ${nome}`);
      const linhas = await r.json();
      const mapa = {};
      for (const { data, valor } of linhas) {
        const [, m, a] = data.split('/');
        mapa[`${a}-${m}`] = Number(valor);
      }
      dados[nome] = mapa;
    }));
    try { localStorage.setItem(CACHE, JSON.stringify({ ts: Date.now(), dados })); } catch { /* cheio */ }
    return dados;
  } catch (e) {
    if (cache) return { ...cache.dados, aviso: `Usando índices salvos (${e.message})` };
    throw e;
  }
}

export function ultimoMesDisponivel(mapa) {
  const meses = Object.keys(mapa || {}).sort();
  return meses[meses.length - 1] || null;
}

// Variação acumulada entre os meses ini e fim (inclusive).
export function acumulado(mapa, ini, fim) {
  const meses = [];
  const faltando = [];
  let fator = 1;
  const n = difMeses(ini, fim);
  for (let i = 0; i <= n; i++) {
    const mes = somaMeses(ini, i);
    const pct = mapa?.[mes];
    if (pct === undefined) { faltando.push(mes); continue; }
    fator *= 1 + pct / 100;
    meses.push({ mes, pct, acumulado: (fator - 1) * 100 });
  }
  return { meses, faltando, fator, pct: (fator - 1) * 100 };
}

// Calcula o novo valor. Se naoNegativo e o índice for negativo, mantém o valor.
export function calcularReajuste(mapa, valor, ini, fim, naoNegativo = true) {
  const acc = acumulado(mapa, ini, fim);
  const pctAplicado = naoNegativo && acc.pct < 0 ? 0 : acc.pct;
  const novo = arred2(Number(valor) * (1 + pctAplicado / 100));
  return { ...acc, pctAplicado, valorAnterior: Number(valor), valorNovo: novo, diferenca: arred2(novo - valor) };
}

// Período usual: 12 meses anteriores ao mês do reajuste,
// recuando se o índice do último mês ainda não foi divulgado.
export function periodoSugerido(mapa, mesReajuste) {
  let fim = somaMeses(mesReajuste, -1);
  const ultimo = ultimoMesDisponivel(mapa);
  if (ultimo && fim > ultimo) fim = ultimo;
  return { ini: somaMeses(fim, -11), fim };
}
