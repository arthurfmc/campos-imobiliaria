// Geração de documentos: contrato de locação, notificação de reajuste e recibo.
// Cada documento é montado como uma lista de blocos neutros, depois convertida
// para .docx (biblioteca docx) ou para HTML de impressão (salvar como PDF).
import {
  fmtMoeda, moedaExtenso, fmtData, fmtDataExtenso, fmtPct, fmtCpfCnpj, fmtMesLongo, fmtMes,
  inteiroExtenso, hojeISO, vencimentoDe, nomeArquivo,
} from './util.js';
import { porId, fimContrato, valorVigente, proprietariosDoImovel } from './db.js';
import { INDICES } from './indices.js';

const DOCX_URL = 'https://cdn.jsdelivr.net/npm/docx@9.5.1/+esm';

const ORDINAIS = ['PRIMEIRA', 'SEGUNDA', 'TERCEIRA', 'QUARTA', 'QUINTA', 'SEXTA', 'SÉTIMA', 'OITAVA',
  'NONA', 'DÉCIMA', 'DÉCIMA PRIMEIRA', 'DÉCIMA SEGUNDA', 'DÉCIMA TERCEIRA', 'DÉCIMA QUARTA',
  'DÉCIMA QUINTA', 'DÉCIMA SEXTA', 'DÉCIMA SÉTIMA', 'DÉCIMA OITAVA', 'DÉCIMA NONA', 'VIGÉSIMA',
  'VIGÉSIMA PRIMEIRA', 'VIGÉSIMA SEGUNDA', 'VIGÉSIMA TERCEIRA', 'VIGÉSIMA QUARTA'];

// ---------- Qualificação das partes ----------
export function enderecoInquilino(q) {
  const l1 = [q.logradouro, q.numero].filter(Boolean).join(', ');
  const partes = [l1, q.complemento, q.bairro, [q.cidade, q.uf].filter(Boolean).join('/'),
    q.cep ? `CEP ${q.cep}` : ''].filter(Boolean);
  return partes.join(', ');
}

export const v = (x, alt = '____________________') => (x && String(x).trim()) || alt;

export function qualificacaoPF(p, { endereco }) {
  const itens = [`**${v(p.nome).toUpperCase()}**`, v(p.nacionalidade, 'brasileiro(a)'), v(p.estadoCivil, 'estado civil ______'),
    v(p.profissao, 'profissão ______'),
    `portador(a) da carteira de identidade nº ${v(p.rg)}${p.orgaoEmissor ? ` ${p.orgaoEmissor}` : ''}`,
    `inscrito(a) no CPF sob o nº ${v(fmtCpfCnpj(p.cpf || p.cpfCnpj))}`,
    `residente e domiciliado(a) em ${v(endereco)}`];
  if (p.email) itens.push(`e-mail ${p.email}`);
  return itens.join(', ');
}

export function qualificacaoInquilino(q) {
  const endereco = enderecoInquilino(q);
  if (q.tipo === 'PJ') {
    return `**${v(q.nome).toUpperCase()}**, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº ${v(fmtCpfCnpj(q.cpfCnpj))}, `
      + `com sede em ${v(endereco)}, neste ato representada por ${v(q.representanteNome)}`
      + `${q.representanteCargo ? `, ${q.representanteCargo}` : ''}, inscrito(a) no CPF sob o nº ${v(fmtCpfCnpj(q.representanteCpf))}`
      + `${q.email ? `, e-mail ${q.email}` : ''}`;
  }
  return qualificacaoPF(q, { endereco });
}

export function qualificacaoProprietario(p) {
  if (p.tipo === 'PJ') {
    return `**${v(p.nome).toUpperCase()}**, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº ${v(fmtCpfCnpj(p.cpf))}, `
      + `com sede em ${v(p.endereco)}, neste ato representada por ${v(p.representante)}, inscrito(a) no CPF sob o nº ${v(fmtCpfCnpj(p.representanteCpf))}`;
  }
  return qualificacaoPF(p, { endereco: p.endereco });
}

// Locadores = proprietários do imóvel do contrato.
export function locadoresDe(db, c) {
  return proprietariosDoImovel(db, porId(db.imoveis, c.imovelId));
}

function blocoLocadores(db, c) {
  const ls = locadoresDe(db, c);
  if (ls.length === 1) return [{ t: 'p', texto: `**LOCADOR:** ${qualificacaoProprietario(ls[0].p)}.` }];
  return [
    { t: 'p', texto: '**LOCADORES** (doravante denominados, em conjunto, simplesmente LOCADOR):' },
    ...ls.map((x, k) => ({ t: 'p', texto: `${String.fromCharCode(97 + k)}) ${qualificacaoProprietario(x.p)}, proprietário(a) de ${fmtPct(x.percentual, x.percentual % 1 ? 2 : 0)} do imóvel;` })),
  ];
}

const assinaturasLocadores = (db, c) => locadoresDe(db, c).map((x) => ({ nome: v(x.p.nome), papel: 'LOCADOR' }));

export function descricaoImovel(i, c) {
  const partes = [i.endereco || i.descricao];
  if (c.unidade) partes.push(`unidade: ${c.unidade}`);
  if (i.area) partes.push(`com área de ${String(i.area).replace('.', ',')} ${i.unidadeArea || 'm²'}`);
  if (i.matricula) partes.push(`registrado sob a matrícula nº ${i.matricula}${i.cartorio ? ` do ${i.cartorio}` : ''}`);
  if (i.inscricaoIptu) partes.push(`inscrição imobiliária nº ${i.inscricaoIptu}`);
  return partes.join(', ');
}

// Foro: o do contrato; senão a cidade do imóvel; senão o padrão das configurações.
export function foroDe(db, c) {
  const i = porId(db.imoveis, c?.imovelId);
  return c?.foro || (i?.cidade ? `${i.cidade} - ${i.uf}` : db.config.foro) || '';
}
export const cidadeDe = (foro) => (foro || '').split(/\s*[-/]\s*/)[0] || '________';

// ---------- Contrato: o texto fica em modelos.js ----------
export function nomeArquivoContrato(db, c) {
  const q = porId(db.inquilinos, c.inquilinoId);
  const i = porId(db.imoveis, c.imovelId);
  return nomeArquivo(`Contrato - Ref ${String(i?.ref ?? '').padStart(2, '0')} - ${q?.nome || 'inquilino'} - ${c.dataInicio}.docx`);
}

// ---------- Notificação de reajuste ----------
export function notificacaoBlocos(db, c, r) {
  const cfg = db.config;
  const q = porId(db.inquilinos, c.inquilinoId) || {};
  const i = porId(db.imoveis, c.imovelId) || {};
  const indice = INDICES[r.indice]?.nome || r.indice;
  const B = [];
  B.push({ t: 'local', texto: `${cidadeDe(cfg.foro)}, ${fmtDataExtenso(r.dataNotificacao || hojeISO())}.` });
  B.push({ t: 'titulo', texto: 'NOTIFICAÇÃO DE REAJUSTE DE ALUGUEL' });
  B.push({ t: 'p', texto: `**Ao(À) Sr(a).:** ${v(q.nome)}${q.cpfCnpj ? ` — CPF/CNPJ ${fmtCpfCnpj(q.cpfCnpj)}` : ''}` });
  B.push({ t: 'p', texto: `**Imóvel locado:** ${i.endereco || i.descricao || '—'}${c.unidade ? ` (${c.unidade})` : ''}` });
  B.push({ t: 'p', texto: 'Prezado(a) Senhor(a),' });
  B.push({ t: 'p', texto: `Em cumprimento à cláusula de reajuste do contrato de locação iniciado em ${fmtData(c.dataInicio)}, comunicamos que o valor do aluguel será reajustado pela variação acumulada do ${indice} no período de ${fmtMesLongo(r.periodoIni)} a ${fmtMesLongo(r.periodoFim)}, conforme demonstrado abaixo:` });
  const negativo = r.pct < 0 && r.pctAplicado === 0;
  B.push({ t: 'tabela', cab: ['Item', 'Valor'], linhas: [
    ['Aluguel atual', fmtMoeda(r.valorAnterior)],
    ['Índice', indice],
    ['Período', `${fmtMes(r.periodoIni)} a ${fmtMes(r.periodoFim)}`],
    ['Variação acumulada', fmtPct(r.pct, 4)],
    ['Percentual aplicado', fmtPct(r.pctAplicado, 4)],
    ['Novo aluguel', fmtMoeda(r.valorNovo)],
    ['Vigência', `a partir do aluguel de ${fmtMesLongo(r.vigenciaDesde)} (vencimento em ${fmtData(vencimentoDe(r.vigenciaDesde, c.diaVencimento))})`],
  ] });
  if (negativo) {
    B.push({ t: 'p', texto: 'Como a variação acumulada do índice no período foi negativa, o valor do aluguel fica mantido, conforme previsto em contrato.' });
  } else {
    B.push({ t: 'p', texto: `Assim, a partir do aluguel de ${fmtMesLongo(r.vigenciaDesde)}, o valor mensal passa a ser de ${moedaExtenso(r.valorNovo)}, permanecendo inalteradas as demais condições do contrato.` });
  }
  if (r.meses?.length) {
    B.push({ t: 'p', texto: `Índices mensais utilizados (fonte: ${INDICES[r.indice]?.fonte || 'oficial'}, via Banco Central do Brasil):` });
    B.push({ t: 'tabela', cab: ['Mês', 'Variação no mês', 'Acumulado'], pequena: true,
      linhas: r.meses.map((m) => [fmtMes(m.mes), fmtPct(m.pct), fmtPct(m.acumulado, 4)]) });
  }
  B.push({ t: 'p', texto: 'Permanecemos à disposição para quaisquer esclarecimentos.' });
  B.push({ t: 'p', texto: 'Atenciosamente,' });
  B.push({ t: 'assinaturas', lista: [
    ...assinaturasLocadores(db, c),
    { nome: `${v(q.nome)}  —  Data: ____/____/______`, papel: 'CIENTE (LOCATÁRIO)' },
  ] });
  return B;
}

export function nomeArquivoNotificacao(db, c, r) {
  const q = porId(db.inquilinos, c.inquilinoId);
  const i = porId(db.imoveis, c.imovelId);
  return nomeArquivo(`Notificação reajuste - Ref ${String(i?.ref ?? '').padStart(2, '0')} - ${q?.nome || ''} - ${r.vigenciaDesde}.docx`);
}

// ---------- Recibo ----------
export function reciboBlocos(db, c, p) {
  const cfg = db.config;
  const q = porId(db.inquilinos, c.inquilinoId) || {};
  const i = porId(db.imoveis, c.imovelId) || {};
  const aluguel = valorVigente(c, p.competencia);
  const B = [];
  B.push({ t: 'titulo', texto: 'RECIBO DE ALUGUEL' });
  B.push({ t: 'direita', texto: `**Valor: ${fmtMoeda(p.valorPago)}**` });
  const locs = locadoresDe(db, c);
  B.push({ t: 'p', texto: `${locs.length > 1 ? 'Recebemos' : 'Recebi'} de **${v(q.nome)}**${q.cpfCnpj ? `, CPF/CNPJ ${fmtCpfCnpj(q.cpfCnpj)}` : ''}, a importância de ${moedaExtenso(p.valorPago)}, referente ao aluguel do mês de ${fmtMesLongo(p.competencia)} do imóvel situado em ${i.endereco || i.descricao}${c.unidade ? ` (${c.unidade})` : ''}.` });
  const linhas = [['Aluguel', fmtMoeda(aluguel)]];
  if (Number(p.acrescimos)) linhas.push(['Multa/juros', fmtMoeda(p.acrescimos)]);
  if (Number(p.descontos)) linhas.push(['Descontos', `- ${fmtMoeda(p.descontos)}`]);
  linhas.push(['Total recebido', fmtMoeda(p.valorPago)]);
  B.push({ t: 'tabela', cab: ['Descrição', 'Valor'], linhas });
  B.push({ t: 'p', texto: `Pagamento realizado em ${fmtData(p.dataPagamento)}${p.forma ? ` (${p.forma})` : ''}. Pelo que ${locs.length > 1 ? 'damos' : 'dou'} plena quitação do valor acima.` });
  B.push({ t: 'local', texto: `${cidadeDe(cfg.foro)}, ${fmtDataExtenso(p.dataPagamento || hojeISO())}.` });
  B.push({ t: 'assinaturas', lista: locs.map((x) => ({ nome: v(x.p.nome), papel: `LOCADOR — ${x.p.tipo === 'PJ' ? 'CNPJ' : 'CPF'} ${v(fmtCpfCnpj(x.p.cpf), '')}` })) });
  return B;
}

export function nomeArquivoRecibo(db, c, p) {
  const q = porId(db.inquilinos, c.inquilinoId);
  return nomeArquivo(`Recibo - ${q?.nome || ''} - ${p.competencia}.docx`);
}

// ---------- Termo aditivo ----------
function partesBasicas(db, c) {
  const q = porId(db.inquilinos, c.inquilinoId) || {};
  const g = c.garantia || {};
  const B = [...blocoLocadores(db, c), { t: 'p', texto: `**LOCATÁRIO:** ${qualificacaoInquilino(q)}.` }];
  const fs = g.tipo === 'fiador' ? (g.fiadores || []).filter((f) => f.nome) : [];
  if (fs.length) B.push({ t: 'p', texto: `**${fs.length > 1 ? 'FIADORES (ANUENTES)' : 'FIADOR (ANUENTE)'}:** ${fs.map((f) => `${f.nome}${f.cpf ? `, CPF ${fmtCpfCnpj(f.cpf)}` : ''}${f.conjugeNome ? `, e seu cônjuge ${f.conjugeNome}` : ''}`).join('; ')}.` });
  return B;
}

function assinaturasPartes(db, c) {
  const q = porId(db.inquilinos, c.inquilinoId) || {};
  const g = c.garantia || {};
  const lista = [...assinaturasLocadores(db, c), { nome: v(q.nome), papel: 'LOCATÁRIO' }];
  for (const f of (g.tipo === 'fiador' ? g.fiadores || [] : []).filter((x) => x.nome)) {
    lista.push({ nome: f.nome, papel: 'FIADOR' });
    if (f.conjugeNome) lista.push({ nome: f.conjugeNome, papel: 'CÔNJUGE DO FIADOR' });
  }
  return lista;
}

export function aditivoBlocos(db, c, a) {
  const i = porId(db.imoveis, c.imovelId) || {};
  const B = [{ t: 'titulo', texto: `${a.numero}º TERMO ADITIVO AO CONTRATO DE LOCAÇÃO` }, ...partesBasicas(db, c)];
  B.push({ t: 'p', texto: `As partes acima qualificadas, signatárias do contrato de locação do imóvel ${descricaoImovel(i, c)}, iniciado em ${fmtData(c.dataInicio)}, resolvem celebrar o presente Termo Aditivo, mediante as cláusulas seguintes:` });
  const cls = [];
  if (a.prorrogarMeses) {
    cls.push(['DA PRORROGAÇÃO DO PRAZO', `Fica prorrogado o prazo da locação por ${a.prorrogarMeses} (${inteiroExtenso(Number(a.prorrogarMeses))}) meses, passando seu término para ${fmtData(a.novaDataFim)}.`]);
  }
  if (a.novoValor) {
    cls.push(['DO VALOR DO ALUGUEL', `A partir do aluguel de ${fmtMesLongo(a.vigenciaValor)}, o aluguel mensal passa a ser de ${moedaExtenso(a.novoValor)}, mantidos o dia de vencimento e o critério de reajuste do contrato.`]);
  }
  for (const t of (a.texto || '').split(/\n+/).map((x) => x.trim()).filter(Boolean)) cls.push(['DAS ALTERAÇÕES', t]);
  cls.push(['DA RATIFICAÇÃO', 'Ficam ratificadas todas as demais cláusulas e condições do contrato original que não tenham sido expressamente alteradas por este instrumento.']);
  if (c.garantia?.tipo === 'fiador' && c.garantia.fiadores?.some((f) => f.nome)) {
    cls.push(['DA ANUÊNCIA DO FIADOR', 'O FIADOR declara sua expressa anuência a este aditivo, permanecendo solidariamente responsável por todas as obrigações do contrato, inclusive as aqui ajustadas, até a efetiva entrega das chaves.']);
  }
  cls.forEach(([t, txt], k) => { B.push({ t: 'clausula', texto: `CLÁUSULA ${ORDINAIS[k]} – ${t}` }); B.push({ t: 'p', texto: txt }); });
  B.push({ t: 'p', texto: 'E, por estarem justas e acordadas, as partes assinam o presente em 2 (duas) vias de igual teor.' });
  B.push({ t: 'local', texto: `${cidadeDe(foroDe(db, c))}, ${fmtDataExtenso(a.data || hojeISO())}.` });
  B.push({ t: 'assinaturas', lista: assinaturasPartes(db, c) });
  return B;
}

export const nomeArquivoAditivo = (db, c, a) => {
  const q = porId(db.inquilinos, c.inquilinoId);
  const i = porId(db.imoveis, c.imovelId);
  return nomeArquivo(`Aditivo ${a.numero} - Ref ${String(i?.ref ?? '').padStart(2, '0')} - ${q?.nome || ''} - ${a.data}.docx`);
};

// ---------- Laudo de vistoria: o texto fica em modelos.js ----------
export const nomeArquivoVistoria = (db, c, vs) => {
  const q = porId(db.inquilinos, c.inquilinoId);
  const i = porId(db.imoveis, c.imovelId);
  return nomeArquivo(`Vistoria ${vs.tipo === 'saida' ? 'saída' : 'entrada'} - Ref ${String(i?.ref ?? '').padStart(2, '0')} - ${q?.nome || ''} - ${vs.data}.docx`);
};

// ---------- Conversões ----------
function partesNegrito(texto) {
  return String(texto).split(/(\*\*[^*]+\*\*)/).filter(Boolean)
    .map((s) => (s.startsWith('**') ? { texto: s.slice(2, -2), negrito: true } : { texto: s, negrito: false }));
}

// modelo = true: gera o arquivo-modelo editável, mantendo {campos}, {#condições} e {#repetições}.
export async function paraDocx(blocos, { modelo = false } = {}) {
  const d = await import(DOCX_URL);
  const { Document, Packer, Paragraph, TextRun, AlignmentType, Table, TableRow, TableCell, WidthType, ImageRun } = d;
  const runs = (t, extra = {}) => partesNegrito(t).map((p) => new TextRun({ text: p.texto, bold: p.negrito || extra.bold, size: extra.size }));
  const marca = (texto) => new Paragraph({ children: [new TextRun({ text: texto })] });
  const filhos = [];
  for (const b0 of blocos) {
    let b = b0;
    if (modelo && b.se) filhos.push(marca(`{#${b.se}}`));
    if (modelo && b.t === 'assinaturas') b = { ...b, lista: [{ nome: '{nome}', papel: '{papel}' }] };
    if (modelo && b.t === 'tabela' && b.loop) {
      const l = [...b.linha];
      l[0] = `{#${b.loop}}${l[0]}`; l[l.length - 1] = `${l[l.length - 1]}{/${b.loop}}`;
      b = { ...b, linhas: [l] };
    }
    if (modelo && b.t === 'imagens') continue;
    if (modelo && b.t === 'assinaturas') filhos.push(marca(`{#${b0.loop}}`));
    if (b.t === 'titulo') {
      filhos.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 300, before: 200 },
        children: [new TextRun({ text: b.texto, bold: true, size: 26 })] }));
    } else if (b.t === 'clausula') {
      filhos.push(new Paragraph({ spacing: { before: 240, after: 120 }, keepNext: true,
        children: [new TextRun({ text: b.texto, bold: true })] }));
    } else if (b.t === 'p') {
      for (const linha of (modelo ? [b.texto] : String(b.texto).split('\n'))) {
        filhos.push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { after: 140, line: 300 }, children: runs(linha) }));
      }
    } else if (b.t === 'local' || b.t === 'direita') {
      filhos.push(new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { before: 200, after: 300 }, children: runs(b.texto) }));
    } else if (b.t === 'tabela') {
      const tam = b.pequena ? 18 : 21;
      const linha = (cels, cab) => new TableRow({ children: cels.map((x) => new TableCell({
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        children: [new Paragraph({ children: runs(x, { bold: cab, size: tam }) })] })) });
      filhos.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [linha(b.cab, true), ...b.linhas.map((l) => linha(l, false))] }));
      filhos.push(new Paragraph({ text: '' }));
    } else if (b.t === 'imagens') {
      const celula = (f) => new TableCell({
        width: { size: 50, type: WidthType.PERCENTAGE }, margins: { top: 80, bottom: 80, left: 80, right: 80 },
        children: f ? [
          new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: 'jpg', data: f.data,
            transformation: { width: 280, height: Math.round(280 * (f.altura || 3) / (f.largura || 4)) } })] }),
          new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: f.legenda || '', size: 16 })] }),
        ] : [new Paragraph('')] });
      const linhas = [];
      for (let k = 0; k < b.lista.length; k += 2) linhas.push(new TableRow({ cantSplit: true, children: [celula(b.lista[k]), celula(b.lista[k + 1])] }));
      filhos.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: linhas }));
      filhos.push(new Paragraph({ text: '' }));
    } else if (b.t === 'assinaturas') {
      for (const a of b.lista) {
        filhos.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 600 }, keepNext: true,
          children: [new TextRun('_______________________________________________')] }));
        filhos.push(new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, children: [new TextRun({ text: a.nome })] }));
        filhos.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: a.papel, bold: true, size: 18 })] }));
      }
    }
    if (modelo && b0.t === 'assinaturas') filhos.push(marca(`{/${b0.loop}}`));
    if (modelo && b0.se) filhos.push(marca(`{/${b0.se}}`));
  }
  const doc = new Document({
    styles: { default: { document: { run: { font: 'Arial', size: 22 } } } },
    sections: [{ properties: { page: { margin: { top: 1300, bottom: 1300, left: 1500, right: 1300 } } }, children: filhos }],
  });
  return Packer.toBlob(doc);
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const htmlRuns = (t) => partesNegrito(t).map((p) => (p.negrito ? `<b>${esc(p.texto)}</b>` : esc(p.texto))).join('');

export function paraHtml(blocos, titulo) {
  const corpo = blocos.map((b) => {
    if (b.t === 'titulo') return `<h1>${esc(b.texto)}</h1>`;
    if (b.t === 'clausula') return `<h2>${esc(b.texto)}</h2>`;
    if (b.t === 'p') return String(b.texto).split('\n').map((l) => `<p>${htmlRuns(l)}</p>`).join('');
    if (b.t === 'local' || b.t === 'direita') return `<p class="dir">${htmlRuns(b.texto)}</p>`;
    if (b.t === 'tabela') {
      return `<table class="${b.pequena ? 'peq' : ''}"><tr>${b.cab.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>${
        b.linhas.map((l) => `<tr>${l.map((c) => `<td>${htmlRuns(c)}</td>`).join('')}</tr>`).join('')}</table>`;
    }
    if (b.t === 'imagens') {
      return `<div class="fotos">${b.lista.map((f) => `<figure><img src="${f.url}" alt=""><figcaption>${esc(f.legenda || '')}</figcaption></figure>`).join('')}</div>`;
    }
    if (b.t === 'assinaturas') {
      return `<div class="assin">${b.lista.map((a) => `<div><span class="linha"></span>${esc(a.nome)}<br><b>${esc(a.papel)}</b></div>`).join('')}</div>`;
    }
    return '';
  }).join('\n');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)}</title>
<style>
  @page { size: A4; margin: 2.2cm 2cm 2.2cm 2.5cm; }
  body { font-family: Arial, sans-serif; font-size: 11pt; line-height: 1.45; color: #000; max-width: 17cm; margin: 0 auto; padding: 1cm 0; }
  h1 { font-size: 13pt; text-align: center; margin: 0.6em 0 1.2em; }
  h2 { font-size: 11pt; margin: 1.2em 0 0.4em; page-break-after: avoid; }
  p { text-align: justify; margin: 0 0 0.6em; }
  p.dir { text-align: right; margin: 1em 0; }
  table { width: 100%; border-collapse: collapse; margin: 0.6em 0 1em; }
  th, td { border: 1px solid #555; padding: 4px 8px; text-align: left; }
  th { background: #eee; }
  table.peq { font-size: 9pt; }
  .assin div { text-align: center; margin-top: 2.6em; page-break-inside: avoid; }
  .assin .linha { display: block; width: 70%; margin: 0 auto 4px; border-top: 1px solid #000; }
  .fotos { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .fotos figure { margin: 0; page-break-inside: avoid; text-align: center; font-size: 8pt; }
  .fotos img { width: 100%; height: auto; border: 1px solid #ccc; }
  @media print { body { padding: 0; } }
</style></head><body>${corpo}</body></html>`;
}

// Aceita os blocos ou uma promessa deles (a janela abre na hora para não ser bloqueada).
export async function imprimir(blocos, titulo) {
  const w = window.open('', '_blank');
  if (!w) { alert('Permita pop-ups deste site para imprimir/salvar em PDF.'); return; }
  w.document.write('<p style="font-family:sans-serif">Preparando documento…</p>');
  const lista = await blocos;
  w.document.open();
  w.document.write(paraHtml(lista, titulo));
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 400);
}
