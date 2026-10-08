// Utilitários gerais: datas, moeda, documentos, valor por extenso.

export const novoId = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const clone = (o) => JSON.parse(JSON.stringify(o));

// ---------- Datas ----------
// Datas são guardadas como 'AAAA-MM-DD'; competências como 'AAAA-MM'.

export function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const mesAtual = () => hojeISO().slice(0, 7);

export function somaMeses(ym, n) {
  let [a, m] = ym.slice(0, 7).split('-').map(Number);
  const t = a * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

export function difMeses(ymA, ymB) {
  const [a1, m1] = ymA.split('-').map(Number);
  const [a2, m2] = ymB.split('-').map(Number);
  return (a2 * 12 + m2) - (a1 * 12 + m1);
}

export function ultimoDiaMes(ym) {
  const [a, m] = ym.split('-').map(Number);
  return new Date(a, m, 0).getDate();
}

// Soma meses a uma data completa, preservando o dia quando possível.
export function somaMesesData(iso, n) {
  const ym = somaMeses(iso.slice(0, 7), n);
  const dia = Math.min(Number(iso.slice(8, 10)), ultimoDiaMes(ym));
  return `${ym}-${String(dia).padStart(2, '0')}`;
}

export function diaMenos1(iso) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function vencimentoDe(ym, dia) {
  const d = Math.min(Number(dia) || 10, ultimoDiaMes(ym));
  return `${ym}-${String(d).padStart(2, '0')}`;
}

export function fmtData(iso) {
  if (!iso) return '';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return d ? `${d}/${m}/${a}` : `${m}/${a}`;
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
  'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MESES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export const fmtMes = (ym) => ym ? `${MESES_CURTO[Number(ym.slice(5, 7)) - 1]}/${ym.slice(0, 4)}` : '';
export const fmtMesLongo = (ym) => ym ? `${MESES[Number(ym.slice(5, 7)) - 1]} de ${ym.slice(0, 4)}` : '';
export function fmtDataExtenso(iso) {
  const [a, m, d] = iso.split('-').map(Number);
  return `${d} de ${MESES[m - 1]} de ${a}`;
}

// ---------- Números ----------
const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const fmtMoeda = (v) => fmtBRL.format(Number(v) || 0);
export const fmtNum = (v, casas = 2) =>
  (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
export const fmtPct = (v, casas = 2) => `${fmtNum(v, casas)}%`;
export const arred2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

// ---------- Documentos (CPF/CNPJ) ----------
export const soDigitos = (s) => String(s || '').replace(/\D/g, '');

export function fmtCpfCnpj(s) {
  const d = soDigitos(s);
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return s || '';
}

export function cpfValido(s) {
  const d = soDigitos(s);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  for (const n of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i);
    const dv = (soma * 10) % 11 % 10;
    if (dv !== Number(d[n])) return false;
  }
  return true;
}

export function cnpjValido(s) {
  const d = soDigitos(s);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const calc = (n) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = pesos.reduce((acc, p, i) => acc + p * Number(d[i]), 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

export const docValido = (s) => cpfValido(s) || cnpjValido(s);

export function fmtTelefone(s) {
  const d = soDigitos(s);
  if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
  return s || '';
}

// ---------- Valor por extenso ----------
const UNI = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze',
  'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZ = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CEN = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos',
  'setecentos', 'oitocentos', 'novecentos'];

function ate999(n) {
  if (n === 0) return '';
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100), r = n % 100;
  const partes = [];
  if (c) partes.push(CEN[c]);
  if (r < 20) { if (r) partes.push(UNI[r]); }
  else {
    partes.push(DEZ[Math.floor(r / 10)]);
    if (r % 10) partes.push(UNI[r % 10]);
  }
  return partes.join(' e ');
}

export function inteiroExtenso(n) {
  if (n === 0) return 'zero';
  const grupos = [];
  while (n > 0) { grupos.push(n % 1000); n = Math.floor(n / 1000); }
  const nomes = [['', ''], ['mil', 'mil'], ['milhão', 'milhões'], ['bilhão', 'bilhões']];
  const partes = [];
  for (let i = grupos.length - 1; i >= 0; i--) {
    const g = grupos[i];
    if (!g) continue;
    let txt = (i === 1 && g === 1) ? '' : ate999(g);
    if (i > 0) txt = (txt ? txt + ' ' : '') + (g === 1 ? nomes[i][0] : nomes[i][1]);
    partes.push({ txt, g });
  }
  // "e" antes do último grupo quando ele é < 100 ou centena redonda
  return partes.reduce((acc, p, idx) => {
    if (idx === 0) return p.txt;
    const ultimo = idx === partes.length - 1;
    const usaE = ultimo && (p.g < 100 || p.g % 100 === 0);
    return acc + (usaE ? ' e ' : ' ') + p.txt;
  }, '');
}

export function extensoReais(valor) {
  const v = arred2(Math.abs(Number(valor) || 0));
  const reais = Math.floor(v);
  const cent = Math.round((v - reais) * 100);
  const partes = [];
  if (reais) {
    const ext = inteiroExtenso(reais);
    const de = reais >= 1e6 && reais % 1e6 === 0 ? ' de' : '';
    partes.push(`${ext}${de} ${reais === 1 ? 'real' : 'reais'}`);
  }
  if (cent) partes.push(`${inteiroExtenso(cent)} ${cent === 1 ? 'centavo' : 'centavos'}`);
  return partes.join(' e ') || 'zero reais';
}

export const moedaExtenso = (v) => `${fmtMoeda(v)} (${extensoReais(v)})`;

// ---------- Diversos ----------
export function baixarBlob(blob, nome) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function nomeArquivo(s) {
  return String(s).replace(/[\\/:*?"<>|#%]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120);
}

export async function buscarCep(cep) {
  const d = soDigitos(cep);
  if (d.length !== 8) return null;
  const r = await fetch(`https://viacep.com.br/ws/${d}/json/`);
  if (!r.ok) return null;
  const j = await r.json();
  return j.erro ? null : j;
}

// Reduz fotos (ex.: de celular) antes de enviar: lado maior até `max` px, JPEG.
// Retorna { blob, largura, altura }. Outros tipos de arquivo voltam sem alteração.
export async function prepararImagem(arquivo, max = 1920, qualidade = 0.85) {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(arquivo.type)) return { blob: arquivo, largura: 0, altura: 0 };
  try {
    const bmp = await createImageBitmap(arquivo);
    const escala = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const largura = Math.round(bmp.width * escala);
    const altura = Math.round(bmp.height * escala);
    const canvas = document.createElement('canvas');
    canvas.width = largura; canvas.height = altura;
    canvas.getContext('2d').drawImage(bmp, 0, 0, largura, altura);
    const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', qualidade));
    return { blob: blob || arquivo, largura, altura };
  } catch {
    return { blob: arquivo, largura: 0, altura: 0 };
  }
}

export const ehImagem = (nome) => /\.(jpe?g|png|webp|gif|heic)$/i.test(nome || '');
