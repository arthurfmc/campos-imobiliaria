// Modelos de documentos com campos {assim}.
// O mesmo modelo serve para (1) gerar o texto padrão do sistema e (2) criar o arquivo
// "Modelo - ....docx" no OneDrive, que pode ser editado no Word. Se o modelo editado
// existir na pasta "modelos", ele é usado (preenchido com docxtemplater).
import {
  fmtMoeda, extensoReais, fmtData, fmtDataExtenso, fmtCpfCnpj, inteiroExtenso, hojeISO, fmtNum,
} from './util.js';
import { porId, fimContrato } from './db.js';
import { INDICES } from './indices.js';
import {
  v, qualificacaoPF, qualificacaoInquilino, qualificacaoProprietario, locadoresDe, descricaoImovel, foroDe, cidadeDe,
} from './documentos.js';

const PIZZIP_URL = 'https://cdn.jsdelivr.net/npm/pizzip@3.2.0/+esm';
const DOCXTEMPLATER_URL = 'https://cdn.jsdelivr.net/npm/docxtemplater@3.69.3/+esm';

const pct = (n) => `${fmtNum(n, Number(n) % 1 ? 2 : 0)}% (${inteiroExtenso(Math.trunc(Number(n)))}${Number(n) % 1 ? ' vírgula ' + inteiroExtenso(Math.round((Number(n) % 1) * 100)) : ''} por cento)`;
const nExt = (n) => `${n} (${inteiroExtenso(Number(n))})`;

// ---------------------------------------------------------------------------
// Garantia
// ---------------------------------------------------------------------------
export const TIPOS_GARANTIA = {
  fiador: 'Fiança (um ou mais fiadores)',
  caucao: 'Caução (dinheiro, cheques ou bens)',
  seguro: 'Seguro-fiança',
  titulo: 'Título de capitalização',
  antecipado: 'Sem garantia — aluguel pago antecipadamente (art. 42)',
  nenhuma: 'Sem garantia',
};

function qualificacaoFiador(f) {
  let t = qualificacaoPF({ nome: f.nome, nacionalidade: f.nacionalidade, estadoCivil: f.estadoCivil, profissao: f.profissao, rg: f.rg, cpf: f.cpf, email: f.email }, { endereco: f.endereco });
  if (f.conjugeNome) t += `, e seu cônjuge **${f.conjugeNome.toUpperCase()}**${f.conjugeCpf ? `, inscrito(a) no CPF sob o nº ${fmtCpfCnpj(f.conjugeCpf)}` : ''}, que também assina em anuência`;
  return t;
}

function textoGarantia(g) {
  const venc = g.vencimento ? ` A garantia tem validade até ${fmtData(g.vencimento)}, obrigando-se o LOCATÁRIO a renová-la ou substituí-la antes dessa data, sob pena de infração contratual.` : '';
  const fs = (g.fiadores || []).filter((f) => f.nome);
  switch (g.tipo) {
    case 'fiador': {
      const plural = fs.length > 1;
      return [
        `${plural ? 'Assinam' : 'Assina'} o presente contrato, na qualidade de ${plural ? 'FIADORES e principais pagadores, solidariamente responsáveis entre si e' : 'FIADOR e principal pagador, solidariamente responsável'} com o LOCATÁRIO, ${plural ? 'as pessoas qualificadas' : 'a pessoa qualificada'} no preâmbulo, que ${plural ? 'respondem' : 'responde'} por todas as obrigações deste contrato até a efetiva devolução das chaves e quitação de todos os débitos, ainda que a locação seja prorrogada por prazo indeterminado, nos termos do art. 39 da Lei nº 8.245/1991.${venc}`,
        `Parágrafo primeiro. ${plural ? 'Os FIADORES renunciam' : 'O FIADOR renuncia'} expressamente aos benefícios previstos nos arts. 827, 835 e 838 do Código Civil.`,
        'Parágrafo segundo. Em caso de morte, falência, insolvência ou mudança de domicílio sem aviso de qualquer fiador, o LOCATÁRIO deverá apresentar substituto idôneo em 30 (trinta) dias, nos termos do art. 40 da Lei nº 8.245/1991.',
      ].join('\n');
    }
    case 'caucao': {
      const valor = `${fmtMoeda(g.caucaoValor)} (${extensoReais(g.caucaoValor)})`;
      const desc = {
        dinheiro: `caução em dinheiro no valor de ${valor}, não superior a 3 (três) aluguéis, a ser depositada em caderneta de poupança, revertendo em benefício do LOCATÁRIO as vantagens dela decorrentes por ocasião do levantamento (art. 38, § 2º, da Lei nº 8.245/1991)`,
        cheques: `caução representada por cheque(s) no valor total de ${valor}${g.caucaoDescricao ? ` (${g.caucaoDescricao})` : ''}, que ficará(ão) em poder do LOCADOR até o término da locação`,
        bens: `caução em bens: ${v(g.caucaoDescricao)}, avaliados em ${valor}, devendo a caução ser registrada em cartório (bens móveis) ou averbada à margem da matrícula (imóveis), nos termos do art. 38, § 1º, da Lei nº 8.245/1991`,
      }[g.caucaoModalidade || 'dinheiro'];
      return [`Em garantia do cumprimento das obrigações deste contrato, o LOCATÁRIO presta ${desc}.${venc}`,
        'Parágrafo único. Finda a locação, após a vistoria de saída e a comprovação da quitação de aluguéis e encargos, a caução será restituída ao LOCATÁRIO, deduzidos eventuais débitos.'].join('\n');
    }
    case 'seguro':
      return `A locação é garantida por seguro de fiança locatícia${g.seguradora ? ` contratado junto à ${g.seguradora}` : ''}${g.apolice ? `, apólice nº ${g.apolice}` : ''}${g.vencimento ? `, com vigência até ${fmtData(g.vencimento)}` : ''}, cujo prêmio será pago pelo LOCATÁRIO, que se obriga a mantê-lo vigente durante toda a locação, renovando-o antes do vencimento, sob pena de infração contratual.`;
    case 'titulo':
      return [`Em garantia do cumprimento das obrigações deste contrato, o LOCATÁRIO cede ao LOCADOR, nos termos do art. 37, inciso IV, da Lei nº 8.245/1991, o título de capitalização${g.instituicao ? ` emitido por ${g.instituicao}` : ''}${g.numeroTitulo ? `, nº ${g.numeroTitulo}` : ''}, no valor de ${fmtMoeda(g.valorTitulo)} (${extensoReais(g.valorTitulo)}).${venc}`,
        'Parágrafo único. Havendo inadimplência, o LOCADOR poderá resgatar o título para quitação dos débitos. Finda a locação sem débitos, a cessão será desfeita em favor do LOCATÁRIO.'].join('\n');
    case 'antecipado':
      return 'A presente locação não conta com nenhuma das modalidades de garantia do art. 37 da Lei nº 8.245/1991. Por isso, nos termos do art. 42 da mesma lei, o aluguel e os encargos serão pagos antecipadamente, até o 6º (sexto) dia útil do mês a vencer.';
    default:
      return 'A presente locação é celebrada sem qualquer das modalidades de garantia previstas no art. 37 da Lei nº 8.245/1991.';
  }
}

// ---------------------------------------------------------------------------
// Dados (campos) do contrato
// ---------------------------------------------------------------------------
export function dadosContrato(db, c) {
  const cfg = db.config;
  const q = porId(db.inquilinos, c.inquilinoId) || {};
  const i = porId(db.imoveis, c.imovelId) || {};
  const g = c.garantia || { tipo: 'nenhuma' };
  const comercial = c.finalidade !== 'residencial';
  const locs = locadoresDe(db, c);
  const fs = g.tipo === 'fiador' ? (g.fiadores || []).filter((f) => f.nome) : [];
  const r = c.atraso || { multaPct: cfg.multaAtrasoPct, jurosMesPct: cfg.jurosMesPct, jurosAposDias: 30, correcao: true };
  const per = Number(c.periodicidadeMeses) || 12;
  const e = c.encargos || {};
  const encargos = [];
  if (e.iptu !== false) encargos.push('o Imposto Predial e Territorial Urbano (IPTU) e taxas que incidam ou venham a incidir sobre o imóvel');
  if (e.condominio) encargos.push('as despesas ordinárias de condomínio');
  if (e.agua !== false) encargos.push('o consumo de água e esgoto');
  if (e.luz !== false) encargos.push('o consumo de energia elétrica e gás');
  if (e.seguro) encargos.push('o seguro do imóvel contra incêndio');
  const indice = INDICES[c.indice]?.nome || c.indice;
  const juros = Number(r.jurosMesPct) > 0
    ? ` Caso o atraso ${Number(r.jurosAposDias) > 0 ? `exceda ${nExt(r.jurosAposDias)} dias` : 'ocorra'}, incidirão ainda juros de mora de ${pct(r.jurosMesPct)} ao mês, calculados pro rata die${r.correcao ? `, e correção monetária pelo ${indice}` : ''}.`
    : '';
  const assinaturas = [...locs.map((x) => ({ nome: v(x.p.nome), papel: 'LOCADOR' })), { nome: v(q.nome), papel: 'LOCATÁRIO' }];
  for (const f of fs) {
    assinaturas.push({ nome: f.nome, papel: 'FIADOR' });
    if (f.conjugeNome) assinaturas.push({ nome: f.conjugeNome, papel: 'CÔNJUGE DO FIADOR' });
  }
  assinaturas.push({ nome: 'Nome:                          CPF:', papel: 'TESTEMUNHA 1' }, { nome: 'Nome:                          CPF:', papel: 'TESTEMUNHA 2' });

  const fim = fimContrato(c);
  return {
    tipo_locacao: comercial ? 'NÃO RESIDENCIAL' : 'RESIDENCIAL',
    locadores_rotulo: locs.length > 1 ? 'LOCADORES' : 'LOCADOR',
    locadores_qualificacao: locs.length === 1 ? qualificacaoProprietario(locs[0].p)
      : locs.map((x, k) => `${String.fromCharCode(97 + k)}) ${qualificacaoProprietario(x.p)}, proprietário(a) de ${fmtNum(x.percentual, x.percentual % 1 ? 2 : 0)}% do imóvel`).join(';\n') + ' (doravante denominados, em conjunto, simplesmente LOCADOR)',
    locatario_nome: v(q.nome), locatario_cpf_cnpj: fmtCpfCnpj(q.cpfCnpj), locatario_qualificacao: qualificacaoInquilino(q),
    tem_fiadores: fs.length > 0,
    fiadores_rotulo: fs.length > 1 ? 'FIADORES' : 'FIADOR',
    fiadores_qualificacao: fs.length === 1 ? qualificacaoFiador(fs[0]) : fs.map((f, k) => `${String.fromCharCode(97 + k)}) ${qualificacaoFiador(f)}`).join(';\n'),
    imovel_descricao: descricaoImovel(i, c), imovel_endereco: i.endereco || i.descricao || '', unidade: c.unidade || '',
    destinacao: comercial
      ? `O imóvel destina-se exclusivamente a fins não residenciais, para o exercício da atividade de ${v(c.atividade, 'comércio')}, sendo vedada a alteração de sua destinação sem o consentimento prévio e por escrito do LOCADOR.\nParágrafo único. Cabe ao LOCATÁRIO obter, às suas expensas, todos os alvarás, licenças e autorizações necessários ao exercício de sua atividade, respondendo por eventuais multas e sanções decorrentes de sua falta.`
      : 'O imóvel destina-se exclusivamente à residência do LOCATÁRIO e de sua família, sendo vedada a alteração de sua destinação sem o consentimento prévio e por escrito do LOCADOR.',
    prazo_meses: nExt(Number(c.prazoMeses) || 0), data_inicio: fmtData(c.dataInicio), data_fim: fmtData(fim),
    valor: fmtMoeda(c.valorInicial), valor_extenso: extensoReais(c.valorInicial),
    dia_vencimento: nExt(Number(c.diaVencimento) || 10),
    forma_pagamento: [c.formaPagamento ? `, mediante ${c.formaPagamento}` : '', c.dadosBancarios ? ` (${c.dadosBancarios})` : ''].join(''),
    mora: `O pagamento efetuado após o vencimento sujeitará o LOCATÁRIO à multa moratória de ${pct(r.multaPct)} sobre o valor devido.${juros}`,
    periodicidade: nExt(per), indice, outro_indice: c.indice === 'IGP-M' ? 'IPCA (IBGE)' : 'IGP-M (FGV)',
    indice_negativo: cfg.naoAplicarIndiceNegativo ? 'Caso a variação acumulada do índice no período seja negativa, o valor do aluguel será mantido, sem redução.' : '',
    encargos: encargos.join('; ') || 'as despesas de consumo do imóvel',
    benfeitorias_comercial: comercial ? 'Parágrafo terceiro. A instalação de letreiros, placas e fachadas dependerá de autorização do LOCADOR e das autoridades competentes, devendo ser removida ao final da locação, com a recomposição do imóvel.' : '',
    garantia: textoGarantia(g),
    multa_rescisoria: nExt(Number(cfg.multaRescisoriaAlugueis) || 3),
    clausulas_adicionais: (c.clausulasAdicionais || '').trim(),
    foro: v(foroDe(db, c)), cidade: cidadeDe(foroDe(db, c)),
    data_assinatura: fmtDataExtenso(c.dataAssinatura || hojeISO()),
    assinaturas,
  };
}

// ---------------------------------------------------------------------------
// Modelo do contrato (texto padrão)
// ---------------------------------------------------------------------------
export function modeloContrato() {
  const C = (n, t) => ({ t: 'clausula', texto: `CLÁUSULA ${n} – ${t}` });
  const P = (texto, se) => ({ t: 'p', texto, se });
  return [
    { t: 'titulo', texto: 'CONTRATO DE LOCAÇÃO DE IMÓVEL {tipo_locacao}' },
    P('**{locadores_rotulo}:** {locadores_qualificacao}.'),
    P('**LOCATÁRIO:** {locatario_qualificacao}.'),
    P('**{fiadores_rotulo}:** {fiadores_qualificacao}.', 'tem_fiadores'),
    P('As partes acima identificadas têm, entre si, justo e acertado o presente Contrato de Locação, que se regerá pela Lei nº 8.245, de 18 de outubro de 1991 (Lei do Inquilinato), pelo Código Civil e pelas cláusulas e condições seguintes:'),
    C('PRIMEIRA', 'DO OBJETO'),
    P('O LOCADOR dá em locação ao LOCATÁRIO o imóvel {imovel_descricao}, em perfeito estado de conservação, limpeza e funcionamento, conforme laudo de vistoria que, assinado pelas partes, passa a integrar o presente contrato.'),
    C('SEGUNDA', 'DA DESTINAÇÃO'),
    P('{destinacao}'),
    C('TERCEIRA', 'DO PRAZO'),
    P('O prazo da locação é de {prazo_meses} meses, com início em {data_inicio} e término em {data_fim}, data em que o LOCATÁRIO se obriga a restituir o imóvel livre e desocupado, nas condições em que o recebeu, independentemente de notificação ou interpelação judicial ou extrajudicial.'),
    P('Parágrafo único. Findo o prazo ajustado, se o LOCATÁRIO continuar na posse do imóvel por mais de 30 (trinta) dias sem oposição do LOCADOR, a locação será prorrogada por prazo indeterminado, mantidas as demais cláusulas deste contrato.'),
    C('QUARTA', 'DO ALUGUEL'),
    P('O aluguel mensal é de {valor} ({valor_extenso}), que deverá ser pago até o dia {dia_vencimento} de cada mês{forma_pagamento}.'),
    P('Parágrafo primeiro. {mora}'),
    P('Parágrafo segundo. O recebimento de aluguel ou encargos fora do prazo ou em condições diversas das aqui previstas constituirá mera tolerância do LOCADOR, não importando novação ou alteração das cláusulas deste contrato.'),
    C('QUINTA', 'DO REAJUSTE'),
    P('O aluguel será reajustado a cada {periodicidade} meses, contados do início da locação, pela variação acumulada do {indice} nos 12 (doze) meses anteriores ao mês do reajuste, considerando-se os últimos índices divulgados.'),
    P('Parágrafo primeiro. Na hipótese de extinção, suspensão ou impossibilidade de aplicação do índice acima, será adotado o índice oficial que vier a substituí-lo ou, na sua falta, o {outro_indice}.'),
    P('Parágrafo segundo. {indice_negativo}', 'indice_negativo'),
    P('Parágrafo terceiro. O LOCADOR comunicará ao LOCATÁRIO, por escrito, o novo valor do aluguel e o mês a partir do qual será devido.'),
    C('SEXTA', 'DOS ENCARGOS'),
    P('Além do aluguel, correrão por conta do LOCATÁRIO, durante toda a locação: {encargos}, cujos comprovantes de pagamento deverão ser apresentados ao LOCADOR sempre que solicitados.'),
    P('Parágrafo único. Ao final da locação, o LOCATÁRIO deverá apresentar os comprovantes de quitação de todos os encargos até a data da efetiva entrega das chaves.'),
    C('SÉTIMA', 'DA CONSERVAÇÃO E DAS BENFEITORIAS'),
    P('O LOCATÁRIO obriga-se a conservar o imóvel e a realizar, às suas expensas, os reparos dos danos a que der causa, bem como a cumprir as posturas municipais, sanitárias e de segurança aplicáveis.'),
    P('Parágrafo primeiro. Nenhuma obra, modificação ou benfeitoria poderá ser feita sem autorização prévia e por escrito do LOCADOR.'),
    P('Parágrafo segundo. As benfeitorias, ainda que necessárias ou úteis, incorporar-se-ão ao imóvel, sem direito a indenização ou retenção, nos termos do art. 35 da Lei nº 8.245/1991, podendo o LOCADOR exigir que o imóvel seja restituído no estado original.'),
    P('{benfeitorias_comercial}', 'benfeitorias_comercial'),
    C('OITAVA', 'DA CESSÃO, SUBLOCAÇÃO E EMPRÉSTIMO'),
    P('É vedado ao LOCATÁRIO ceder, sublocar ou emprestar o imóvel, no todo ou em parte, bem como transferir este contrato, sem o consentimento prévio e por escrito do LOCADOR.'),
    C('NONA', 'DA VISTORIA'),
    P('O LOCADOR, ou pessoa por ele autorizada, poderá vistoriar o imóvel mediante combinação prévia de dia e hora com o LOCATÁRIO, bem como mostrá-lo a terceiros interessados na hipótese de venda ou de término da locação.'),
    C('DÉCIMA', 'DA GARANTIA'),
    P('{garantia}'),
    C('DÉCIMA PRIMEIRA', 'DA RESCISÃO E DA MULTA'),
    P('A infração de qualquer cláusula deste contrato sujeitará a parte infratora ao pagamento de multa equivalente a {multa_rescisoria} aluguéis vigentes à época da infração, sem prejuízo da rescisão do contrato e da cobrança de perdas e danos.'),
    P('Parágrafo único. Caso o LOCATÁRIO devolva o imóvel antes do término do prazo contratual, pagará a multa prevista nesta cláusula de forma proporcional ao período de cumprimento do contrato, conforme o art. 4º da Lei nº 8.245/1991, mediante aviso prévio por escrito de, no mínimo, 30 (trinta) dias.'),
    C('DÉCIMA SEGUNDA', 'DA DEVOLUÇÃO DO IMÓVEL'),
    P('Ao término da locação, o LOCATÁRIO restituirá o imóvel nas mesmas condições em que o recebeu, conforme o laudo de vistoria, ressalvado o desgaste natural pelo uso normal, entregando as chaves mediante recibo. A locação somente será considerada encerrada após a vistoria final e a entrega das chaves.'),
    C('DÉCIMA TERCEIRA', 'DAS DISPOSIÇÕES GERAIS'),
    P('As comunicações entre as partes deverão ser feitas por escrito, admitindo-se o envio por e-mail ou aplicativo de mensagens para os contatos informados neste contrato.'),
    P('Em caso de alienação do imóvel, o LOCATÁRIO terá direito de preferência na aquisição, nos termos dos arts. 27 a 34 da Lei nº 8.245/1991.'),
    P('{clausulas_adicionais}', 'clausulas_adicionais'),
    C('DÉCIMA QUARTA', 'DO FORO'),
    P('Fica eleito o foro da comarca de {foro} para dirimir quaisquer questões oriundas deste contrato, com renúncia a qualquer outro, por mais privilegiado que seja.'),
    P('E, por estarem assim justas e contratadas, as partes assinam o presente instrumento em 2 (duas) vias de igual teor e forma, na presença das testemunhas abaixo.'),
    { t: 'local', texto: '{cidade}, {data_assinatura}.' },
    { t: 'assinaturas', loop: 'assinaturas' },
  ];
}

// ---------------------------------------------------------------------------
// Laudo de vistoria (entrada / saída)
// ---------------------------------------------------------------------------
export function dadosVistoria(db, c, vs, entrada = null, emBranco = false) {
  const q = porId(db.inquilinos, c.inquilinoId) || {};
  const i = porId(db.imoveis, c.imovelId) || {};
  const saida = vs.tipo === 'saida';
  const ambientes = (vs.ambientes || []).filter((a) => a.nome).map((a) => ({
    nome: a.nome,
    estado: emBranco ? '' : (a.estado || ''),
    observacao: emBranco ? '' : (a.observacao || ''),
    estado_entrada: entrada?.ambientes?.find((x) => x.nome === a.nome)?.estado || '',
  }));
  const leituras = [['Energia elétrica', vs.leituraEnergia, i.instalacaoEnergia], ['Água', vs.leituraAgua, i.instalacaoAgua], ['Gás', vs.leituraGas, ''], ['Chaves entregues', vs.chaves, '']]
    .map(([item, leitura, instalacao]) => ({ item, leitura: emBranco ? '' : (leitura || ''), instalacao: instalacao || '' }));
  const fotos = (vs.fotos || []).map((f, k) => `${k + 1}. ${f.descricao || f.nome}`).join('\n');
  return {
    tipo_vistoria: saida ? 'SAÍDA' : 'ENTRADA',
    imovel_endereco: `${i.endereco || i.descricao || ''}${c.unidade ? ` (${c.unidade})` : ''}`,
    locadores: locadoresDe(db, c).map((x) => x.p.nome).join(', '),
    locatario_nome: v(q.nome),
    contrato_inicio: fmtData(c.dataInicio),
    data_vistoria: emBranco ? '____/____/________' : fmtData(vs.data),
    vistoriador: emBranco ? '' : (vs.vistoriador || ''),
    leituras, ambientes,
    observacoes: emBranco ? Array(4).fill('_'.repeat(90)).join('\n') : (vs.observacoes || ''),
    declaracao: saida
      ? 'As partes declaram que o imóvel foi vistoriado na devolução e se encontra no estado acima descrito. Eventuais danos além do desgaste natural pelo uso normal serão de responsabilidade do LOCATÁRIO, conforme o contrato de locação.'
      : 'O LOCATÁRIO declara ter vistoriado o imóvel e recebê-lo no estado acima descrito, comprometendo-se a devolvê-lo nas mesmas condições ao final da locação, ressalvado o desgaste natural pelo uso normal. Este laudo é parte integrante do contrato de locação.',
    tem_fotos: !!fotos, lista_fotos: fotos,
    cidade: cidadeDe(foroDe(db, c)),
    data_extenso: emBranco ? '____ de ______________ de ________' : fmtDataExtenso(vs.data || hojeISO()),
    assinaturas: [...locadoresDe(db, c).map((x) => ({ nome: v(x.p.nome), papel: 'LOCADOR' })), { nome: v(q.nome), papel: 'LOCATÁRIO' }],
  };
}

export function modeloVistoria(saida) {
  return [
    { t: 'titulo', texto: 'LAUDO DE VISTORIA DE {tipo_vistoria}' },
    { t: 'tabela', cab: ['Item', 'Informação'], linhas: [
      ['Imóvel', '{imovel_endereco}'], ['Locador(es)', '{locadores}'], ['Locatário', '{locatario_nome}'],
      ['Contrato', 'iniciado em {contrato_inicio}'], ['Data da vistoria', '{data_vistoria}'], ['Vistoriador', '{vistoriador}'],
    ] },
    { t: 'clausula', texto: 'LEITURAS E CHAVES' },
    { t: 'tabela', cab: ['Item', 'Leitura / quantidade', 'Instalação nº'], loop: 'leituras', linha: ['{item}', '{leitura}', '{instalacao}'] },
    { t: 'clausula', texto: 'ESTADO DO IMÓVEL POR AMBIENTE' },
    saida
      ? { t: 'tabela', cab: ['Ambiente / item', 'Na entrada', 'Na saída', 'Observações'], loop: 'ambientes', linha: ['{nome}', '{estado_entrada}', '{estado}', '{observacao}'] }
      : { t: 'tabela', cab: ['Ambiente / item', 'Estado', 'Observações'], loop: 'ambientes', linha: ['{nome}', '{estado}', '{observacao}'] },
    { t: 'p', texto: 'Legenda: Novo · Bom · Regular · Ruim · Não se aplica.' },
    { t: 'clausula', texto: 'OBSERVAÇÕES' },
    { t: 'p', texto: '{observacoes}' },
    { t: 'p', texto: '{declaracao}' },
    { t: 'clausula', texto: 'REGISTRO FOTOGRÁFICO', se: 'tem_fotos' },
    { t: 'p', texto: '{lista_fotos}', se: 'tem_fotos' },
    { t: 'imagens' },
    { t: 'local', texto: '{cidade}, {data_extenso}.' },
    { t: 'assinaturas', loop: 'assinaturas' },
  ];
}

// ---------------------------------------------------------------------------
// Preenchimento do modelo padrão (sem Word) e com modelo editado (docxtemplater)
// ---------------------------------------------------------------------------
const preencherTexto = (t, d) => String(t).replace(/\{([a-z_]+)\}/g, (_, k) => (d[k] === undefined || d[k] === false ? '' : String(d[k])));

export function preencher(blocos, d, fotos = []) {
  const res = [];
  for (const b of blocos) {
    if (b.se && !d[b.se]) continue;
    if (b.t === 'assinaturas') { res.push({ t: 'assinaturas', lista: d[b.loop] || [] }); continue; }
    if (b.t === 'imagens') { if (fotos.length) res.push({ t: 'imagens', lista: fotos }); continue; }
    if (b.t === 'tabela') {
      const linhas = b.loop ? (d[b.loop] || []).map((it) => b.linha.map((cel) => preencherTexto(cel, { ...d, ...it })))
        : b.linhas.map((l) => l.map((cel) => preencherTexto(cel, d)));
      res.push({ ...b, cab: b.cab.map((x) => preencherTexto(x, d)), linhas });
      continue;
    }
    const texto = preencherTexto(b.texto, d);
    if (b.t === 'p' && !texto.trim()) continue;
    res.push({ ...b, texto });
  }
  return res;
}

export async function preencherModeloWord(blobModelo, dados) {
  const [{ default: PizZip }, { default: Docxtemplater }] = await Promise.all([import(PIZZIP_URL), import(DOCXTEMPLATER_URL)]);
  const zip = new PizZip(await blobModelo.arrayBuffer());
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter: () => '' });
  // Negrito com ** não existe no Word: remove os marcadores.
  const limpo = JSON.parse(JSON.stringify(dados, (k, val) => (typeof val === 'string' ? val.replace(/\*\*/g, '') : val)));
  doc.render(limpo);
  return doc.getZip().generate({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

// Lista de modelos editáveis e onde ficam no OneDrive.
export const MODELOS = {
  contrato: { nome: 'Contrato de locação', arquivo: 'Modelo - Contrato de locação.docx', blocos: () => modeloContrato() },
  vistoria_entrada: { nome: 'Laudo de vistoria de entrada', arquivo: 'Modelo - Laudo de vistoria de entrada.docx', blocos: () => modeloVistoria(false) },
  vistoria_saida: { nome: 'Laudo de vistoria de saída (encerramento)', arquivo: 'Modelo - Laudo de vistoria de saída.docx', blocos: () => modeloVistoria(true) },
};

export const CAMPOS_AJUDA = {
  contrato: [
    ['{tipo_locacao}', 'RESIDENCIAL ou NÃO RESIDENCIAL'], ['{locadores_rotulo} / {locadores_qualificacao}', 'Proprietários do imóvel, com qualificação completa'],
    ['{locatario_nome} / {locatario_cpf_cnpj} / {locatario_qualificacao}', 'Inquilino'],
    ['{#tem_fiadores} … {/tem_fiadores}', 'Trecho que só aparece se houver fiadores'], ['{fiadores_rotulo} / {fiadores_qualificacao}', 'Fiadores (um ou mais), com cônjuges'],
    ['{imovel_descricao} / {imovel_endereco} / {unidade}', 'Imóvel'], ['{destinacao}', 'Cláusula de destinação (comercial/residencial)'],
    ['{prazo_meses} / {data_inicio} / {data_fim}', 'Prazo'], ['{valor} / {valor_extenso} / {dia_vencimento} / {forma_pagamento}', 'Aluguel'],
    ['{mora}', 'Multa, juros e correção por atraso (regra do contrato)'], ['{periodicidade} / {indice} / {outro_indice} / {indice_negativo}', 'Reajuste'],
    ['{encargos}', 'Encargos a cargo do inquilino'], ['{garantia}', 'Texto completo da garantia escolhida'],
    ['{multa_rescisoria}', 'Nº de aluguéis da multa por infração'], ['{clausulas_adicionais}', 'Cláusulas adicionais digitadas no sistema'],
    ['{foro} / {cidade} / {data_assinatura}', 'Foro e data'], ['{#assinaturas} {nome} {papel} {/assinaturas}', 'Repete o bloco de assinatura para cada parte'],
  ],
  vistoria: [
    ['{tipo_vistoria}', 'ENTRADA ou SAÍDA'], ['{imovel_endereco} / {locadores} / {locatario_nome} / {contrato_inicio}', 'Identificação'],
    ['{data_vistoria} / {vistoriador}', 'Vistoria'], ['{#leituras} {item} {leitura} {instalacao} {/leituras}', 'Linhas da tabela de leituras e chaves'],
    ['{#ambientes} {nome} {estado} {estado_entrada} {observacao} {/ambientes}', 'Linhas da tabela de ambientes ({estado_entrada} só faz sentido na saída)'],
    ['{observacoes} / {declaracao}', 'Textos'], ['{#tem_fotos} {lista_fotos} {/tem_fotos}', 'Lista das fotos (as imagens entram só no modelo padrão)'],
    ['{cidade} / {data_extenso}', 'Local e data'], ['{#assinaturas} {nome} {papel} {/assinaturas}', 'Assinaturas'],
  ],
};

export const contratoBlocos = (db, c) => preencher(modeloContrato(), dadosContrato(db, c));
export const vistoriaBlocos = (db, c, vs, fotos = [], entrada = null, emBranco = false) =>
  preencher(modeloVistoria(vs.tipo === 'saida'), dadosVistoria(db, c, vs, entrada, emBranco), fotos);
export const chaveModeloVistoria = (vs) => (vs.tipo === 'saida' ? 'vistoria_saida' : 'vistoria_entrada');
