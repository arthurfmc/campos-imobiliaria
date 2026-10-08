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

const v = (x, alt = '____________________') => (x && String(x).trim()) || alt;

function qualificacaoPF(p, { endereco }) {
  const itens = [`**${v(p.nome).toUpperCase()}**`, v(p.nacionalidade, 'brasileiro(a)'), v(p.estadoCivil, 'estado civil ______'),
    v(p.profissao, 'profissão ______'),
    `portador(a) da carteira de identidade nº ${v(p.rg)}${p.orgaoEmissor ? ` ${p.orgaoEmissor}` : ''}`,
    `inscrito(a) no CPF sob o nº ${v(fmtCpfCnpj(p.cpf || p.cpfCnpj))}`,
    `residente e domiciliado(a) em ${v(endereco)}`];
  if (p.email) itens.push(`e-mail ${p.email}`);
  return itens.join(', ');
}

function qualificacaoInquilino(q) {
  const endereco = enderecoInquilino(q);
  if (q.tipo === 'PJ') {
    return `**${v(q.nome).toUpperCase()}**, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº ${v(fmtCpfCnpj(q.cpfCnpj))}, `
      + `com sede em ${v(endereco)}, neste ato representada por ${v(q.representanteNome)}`
      + `${q.representanteCargo ? `, ${q.representanteCargo}` : ''}, inscrito(a) no CPF sob o nº ${v(fmtCpfCnpj(q.representanteCpf))}`
      + `${q.email ? `, e-mail ${q.email}` : ''}`;
  }
  return qualificacaoPF(q, { endereco });
}

function qualificacaoProprietario(p) {
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

function descricaoImovel(i, c) {
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
const cidadeDe = (foro) => (foro || '').split(/\s*[-/]\s*/)[0] || '________';

// ---------- Contrato ----------
export function contratoBlocos(db, c) {
  const cfg = db.config;
  const q = porId(db.inquilinos, c.inquilinoId) || {};
  const i = porId(db.imoveis, c.imovelId) || {};
  const g = c.garantia || { tipo: 'nenhuma' };
  const comercial = c.finalidade !== 'residencial';
  const indice = INDICES[c.indice]?.nome || c.indice;
  const outroIndice = c.indice === 'IGP-M' ? 'IPCA (IBGE)' : 'IGP-M (FGV)';
  const fim = fimContrato(c);
  const prazo = Number(c.prazoMeses) || 0;
  const per = Number(c.periodicidadeMeses) || 12;

  const B = [];
  const clausulas = [];
  const cl = (titulo, ...paragrafos) => clausulas.push({ titulo, paragrafos: paragrafos.filter(Boolean) });

  B.push({ t: 'titulo', texto: `CONTRATO DE LOCAÇÃO DE IMÓVEL ${comercial ? 'NÃO RESIDENCIAL' : 'RESIDENCIAL'}` });
  B.push(...blocoLocadores(db, c));
  B.push({ t: 'p', texto: `**LOCATÁRIO:** ${qualificacaoInquilino(q)}.` });
  if (g.tipo === 'fiador') {
    B.push({ t: 'p', texto: `**FIADOR:** ${qualificacaoPF({
      nome: g.fiadorNome, nacionalidade: g.fiadorNacionalidade, estadoCivil: g.fiadorEstadoCivil,
      profissao: g.fiadorProfissao, rg: g.fiadorRg, cpf: g.fiadorCpf,
    }, { endereco: g.fiadorEndereco })}${g.fiadorConjuge ? `, e seu cônjuge ${g.fiadorConjuge}` : ''}.` });
  }
  B.push({ t: 'p', texto: 'As partes acima identificadas têm, entre si, justo e acertado o presente Contrato de Locação, que se regerá pela Lei nº 8.245, de 18 de outubro de 1991 (Lei do Inquilinato), pelo Código Civil e pelas cláusulas e condições seguintes:' });

  cl('DO OBJETO',
    `O LOCADOR dá em locação ao LOCATÁRIO o imóvel ${descricaoImovel(i, c)}, em perfeito estado de conservação, limpeza e funcionamento, conforme termo de vistoria que, assinado pelas partes, passa a integrar o presente contrato.`);

  cl('DA DESTINAÇÃO',
    comercial
      ? `O imóvel destina-se exclusivamente a fins não residenciais, para o exercício da atividade de ${v(c.atividade, 'comércio')}, sendo vedada a alteração de sua destinação sem o consentimento prévio e por escrito do LOCADOR.`
      : 'O imóvel destina-se exclusivamente à residência do LOCATÁRIO e de sua família, sendo vedada a alteração de sua destinação sem o consentimento prévio e por escrito do LOCADOR.',
    comercial ? 'Parágrafo único. Cabe ao LOCATÁRIO obter, às suas expensas, todos os alvarás, licenças e autorizações necessários ao exercício de sua atividade, respondendo por eventuais multas e sanções decorrentes de sua falta.' : null);

  cl('DO PRAZO',
    `O prazo da locação é de ${prazo} (${inteiroExtenso(prazo)}) meses, com início em ${fmtData(c.dataInicio)} e término em ${fmtData(fim)}, data em que o LOCATÁRIO se obriga a restituir o imóvel livre e desocupado, nas condições em que o recebeu, independentemente de notificação ou interpelação judicial ou extrajudicial.`,
    'Parágrafo único. Findo o prazo ajustado, se o LOCATÁRIO continuar na posse do imóvel por mais de 30 (trinta) dias sem oposição do LOCADOR, a locação será prorrogada por prazo indeterminado, mantidas as demais cláusulas deste contrato.');

  cl('DO ALUGUEL',
    `O aluguel mensal é de ${moedaExtenso(c.valorInicial)}, que deverá ser pago até o dia ${c.diaVencimento} (${inteiroExtenso(Number(c.diaVencimento))}) de cada mês${c.formaPagamento ? `, mediante ${c.formaPagamento}` : ''}${c.dadosBancarios ? ` (${c.dadosBancarios})` : ''}.`,
    `Parágrafo primeiro. O pagamento efetuado após o vencimento sujeitará o LOCATÁRIO à multa moratória de ${cfg.multaAtrasoPct}% (${inteiroExtenso(Number(cfg.multaAtrasoPct))} por cento) sobre o valor devido, acrescida de juros de mora de ${cfg.jurosMesPct}% (${inteiroExtenso(Number(cfg.jurosMesPct))} por cento) ao mês, calculados pro rata die, e de correção monetária pelo índice previsto na cláusula de reajuste.`,
    'Parágrafo segundo. O recebimento de aluguel ou encargos fora do prazo ou em condições diversas das aqui previstas constituirá mera tolerância do LOCADOR, não importando novação ou alteração das cláusulas deste contrato.');

  cl('DO REAJUSTE',
    `O aluguel será reajustado a cada ${per} (${inteiroExtenso(per)}) meses, contados do início da locação, pela variação acumulada do ${indice} nos ${per} (${inteiroExtenso(per)}) meses anteriores ao mês do reajuste, considerando-se os últimos índices divulgados.`,
    `Parágrafo primeiro. Na hipótese de extinção, suspensão ou impossibilidade de aplicação do índice acima, será adotado o índice oficial que vier a substituí-lo ou, na sua falta, o ${outroIndice}.`,
    cfg.naoAplicarIndiceNegativo ? 'Parágrafo segundo. Caso a variação acumulada do índice no período seja negativa, o valor do aluguel será mantido, sem redução.' : null,
    'Parágrafo terceiro. O LOCADOR comunicará ao LOCATÁRIO, por escrito, o novo valor do aluguel e o mês a partir do qual será devido.');

  const encargos = [];
  const e = c.encargos || {};
  if (e.iptu !== false) encargos.push('o Imposto Predial e Territorial Urbano (IPTU) e taxas que incidam ou venham a incidir sobre o imóvel');
  if (e.condominio) encargos.push('as despesas ordinárias de condomínio');
  if (e.agua !== false) encargos.push('o consumo de água e esgoto');
  if (e.luz !== false) encargos.push('o consumo de energia elétrica e gás');
  if (e.seguro) encargos.push('o seguro do imóvel contra incêndio');
  cl('DOS ENCARGOS',
    `Além do aluguel, correrão por conta do LOCATÁRIO, durante toda a locação: ${encargos.join('; ') || 'as despesas de consumo do imóvel'}, cujos comprovantes de pagamento deverão ser apresentados ao LOCADOR sempre que solicitados.`,
    'Parágrafo único. Ao final da locação, o LOCATÁRIO deverá apresentar os comprovantes de quitação de todos os encargos até a data da efetiva entrega das chaves.');

  cl('DA CONSERVAÇÃO E DAS BENFEITORIAS',
    'O LOCATÁRIO obriga-se a conservar o imóvel e a realizar, às suas expensas, os reparos dos danos a que der causa, bem como a cumprir as posturas municipais, sanitárias e de segurança aplicáveis.',
    'Parágrafo primeiro. Nenhuma obra, modificação ou benfeitoria poderá ser feita sem autorização prévia e por escrito do LOCADOR.',
    'Parágrafo segundo. As benfeitorias, ainda que necessárias ou úteis, incorporar-se-ão ao imóvel, sem direito a indenização ou retenção, nos termos do art. 35 da Lei nº 8.245/1991, podendo o LOCADOR exigir que o imóvel seja restituído no estado original.',
    comercial ? 'Parágrafo terceiro. A instalação de letreiros, placas e fachadas dependerá de autorização do LOCADOR e das autoridades competentes, devendo ser removida ao final da locação, com a recomposição do imóvel.' : null);

  cl('DA CESSÃO, SUBLOCAÇÃO E EMPRÉSTIMO',
    'É vedado ao LOCATÁRIO ceder, sublocar ou emprestar o imóvel, no todo ou em parte, bem como transferir este contrato, sem o consentimento prévio e por escrito do LOCADOR.');

  cl('DA VISTORIA',
    'O LOCADOR, ou pessoa por ele autorizada, poderá vistoriar o imóvel mediante combinação prévia de dia e hora com o LOCATÁRIO, bem como mostrá-lo a terceiros interessados na hipótese de venda ou de término da locação.');

  if (g.tipo === 'fiador') {
    cl('DA GARANTIA',
      'Assina o presente contrato, na qualidade de FIADOR e principal pagador, solidariamente responsável com o LOCATÁRIO, a pessoa qualificada no preâmbulo, que responde por todas as obrigações deste contrato até a efetiva devolução das chaves e quitação de todos os débitos, ainda que a locação seja prorrogada por prazo indeterminado, nos termos do art. 39 da Lei nº 8.245/1991.',
      'Parágrafo único. O FIADOR renuncia expressamente aos benefícios previstos nos arts. 827, 835 e 838 do Código Civil.');
  } else if (g.tipo === 'caucao') {
    cl('DA GARANTIA',
      `Em garantia do cumprimento das obrigações deste contrato, o LOCATÁRIO entrega ao LOCADOR caução em dinheiro no valor de ${moedaExtenso(g.caucaoValor)}, não superior a 3 (três) aluguéis, nos termos do art. 38, § 2º, da Lei nº 8.245/1991.`,
      'Parágrafo único. Finda a locação, e após a vistoria de saída e a comprovação da quitação de aluguéis e encargos, a caução será restituída ao LOCATÁRIO, deduzidos eventuais débitos.');
  } else if (g.tipo === 'seguro') {
    cl('DA GARANTIA',
      `A locação é garantida por seguro de fiança locatícia${g.seguradora ? ` contratado junto à ${g.seguradora}` : ''}${g.apolice ? `, apólice nº ${g.apolice}` : ''}${g.vencimento ? `, com vigência até ${fmtData(g.vencimento)}` : ''}, cujo prêmio será pago pelo LOCATÁRIO, que se obriga a mantê-lo vigente durante toda a locação, renovando-o antes do vencimento.`);
  } else if (g.tipo === 'titulo') {
    cl('DA GARANTIA',
      `Em garantia do cumprimento das obrigações deste contrato, o LOCATÁRIO cede ao LOCADOR, nos termos do art. 37, inciso IV, da Lei nº 8.245/1991, o título de capitalização${g.instituicao ? ` emitido por ${g.instituicao}` : ''}${g.numeroTitulo ? `, nº ${g.numeroTitulo}` : ''}, no valor de ${moedaExtenso(g.valorTitulo)}${g.vencimento ? `, com vencimento em ${fmtData(g.vencimento)}` : ''}.`,
      'Parágrafo único. Havendo inadimplência, o LOCADOR poderá resgatar o título para quitação dos débitos. Finda a locação sem débitos, a cessão será desfeita em favor do LOCATÁRIO.');
  } else {
    cl('DA GARANTIA', 'A presente locação é celebrada sem qualquer das modalidades de garantia previstas no art. 37 da Lei nº 8.245/1991.');
  }

  cl('DA RESCISÃO E DA MULTA',
    `A infração de qualquer cláusula deste contrato sujeitará a parte infratora ao pagamento de multa equivalente a ${cfg.multaRescisoriaAlugueis} (${inteiroExtenso(Number(cfg.multaRescisoriaAlugueis))}) aluguéis vigentes à época da infração, sem prejuízo da rescisão do contrato e da cobrança de perdas e danos.`,
    'Parágrafo único. Caso o LOCATÁRIO devolva o imóvel antes do término do prazo contratual, pagará a multa prevista nesta cláusula de forma proporcional ao período de cumprimento do contrato, conforme o art. 4º da Lei nº 8.245/1991, mediante aviso prévio por escrito de, no mínimo, 30 (trinta) dias.');

  cl('DA DEVOLUÇÃO DO IMÓVEL',
    'Ao término da locação, o LOCATÁRIO restituirá o imóvel nas mesmas condições em que o recebeu, conforme o termo de vistoria, ressalvado o desgaste natural pelo uso normal, entregando as chaves mediante recibo. A locação somente será considerada encerrada após a vistoria final e a entrega das chaves.');

  if (c.clausulasAdicionais?.trim()) {
    cl('DISPOSIÇÕES ESPECIAIS', ...c.clausulasAdicionais.split(/\n\s*\n|\n/).map((s) => s.trim()).filter(Boolean));
  }

  cl('DAS DISPOSIÇÕES GERAIS',
    'As comunicações entre as partes deverão ser feitas por escrito, admitindo-se o envio por e-mail ou aplicativo de mensagens para os contatos informados neste contrato.',
    'Em caso de alienação do imóvel, o LOCATÁRIO terá direito de preferência na aquisição, nos termos dos arts. 27 a 34 da Lei nº 8.245/1991.');

  cl('DO FORO',
    `Fica eleito o foro da comarca de ${v(foroDe(db, c))} para dirimir quaisquer questões oriundas deste contrato, com renúncia a qualquer outro, por mais privilegiado que seja.`);

  clausulas.forEach((c2, idx) => {
    B.push({ t: 'clausula', texto: `CLÁUSULA ${ORDINAIS[idx] || idx + 1} – ${c2.titulo}` });
    for (const p of c2.paragrafos) B.push({ t: 'p', texto: p });
  });

  B.push({ t: 'p', texto: 'E, por estarem assim justas e contratadas, as partes assinam o presente instrumento em 2 (duas) vias de igual teor e forma, na presença das testemunhas abaixo.' });
  B.push({ t: 'local', texto: `${cidadeDe(foroDe(db, c))}, ${fmtDataExtenso(c.dataAssinatura || hojeISO())}.` });

  const assin = [...assinaturasLocadores(db, c), { nome: v(q.nome), papel: 'LOCATÁRIO' }];
  if (g.tipo === 'fiador') {
    assin.push({ nome: v(g.fiadorNome), papel: 'FIADOR' });
    if (g.fiadorConjuge) assin.push({ nome: g.fiadorConjuge, papel: 'CÔNJUGE DO FIADOR' });
  }
  assin.push({ nome: 'Nome:                     CPF:', papel: 'TESTEMUNHA 1' });
  assin.push({ nome: 'Nome:                     CPF:', papel: 'TESTEMUNHA 2' });
  B.push({ t: 'assinaturas', lista: assin });
  return B;
}

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
  if (g.tipo === 'fiador' && g.fiadorNome) B.push({ t: 'p', texto: `**FIADOR (ANUENTE):** ${v(g.fiadorNome)}, CPF ${v(fmtCpfCnpj(g.fiadorCpf))}.` });
  return B;
}

function assinaturasPartes(db, c) {
  const q = porId(db.inquilinos, c.inquilinoId) || {};
  const g = c.garantia || {};
  const lista = [...assinaturasLocadores(db, c), { nome: v(q.nome), papel: 'LOCATÁRIO' }];
  if (g.tipo === 'fiador' && g.fiadorNome) lista.push({ nome: g.fiadorNome, papel: 'FIADOR' });
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
  if (c.garantia?.tipo === 'fiador' && c.garantia.fiadorNome) {
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

// ---------- Termo de vistoria ----------
// `fotos`: [{ data: Uint8Array, url, largura, altura, legenda }] já carregadas.
export function vistoriaBlocos(db, c, vs, fotos = [], entrada = null) {
  const q = porId(db.inquilinos, c.inquilinoId) || {};
  const i = porId(db.imoveis, c.imovelId) || {};
  const saida = vs.tipo === 'saida';
  const B = [{ t: 'titulo', texto: `TERMO DE VISTORIA DE ${saida ? 'SAÍDA' : 'ENTRADA'}` }];
  B.push({ t: 'tabela', cab: ['Item', 'Informação'], linhas: [
    ['Imóvel', `${i.endereco || i.descricao}${c.unidade ? ` (${c.unidade})` : ''}`],
    ['Locador(es)', locadoresDe(db, c).map((x) => x.p.nome).join(', ')],
    ['Locatário', q.nome || '—'],
    ['Contrato', `iniciado em ${fmtData(c.dataInicio)}`],
    ['Data da vistoria', fmtData(vs.data)],
    ...(vs.vistoriador ? [['Vistoriador', vs.vistoriador]] : []),
  ] });
  const leituras = [['Energia elétrica', vs.leituraEnergia, i.instalacaoEnergia], ['Água', vs.leituraAgua, i.instalacaoAgua], ['Gás', vs.leituraGas, '']]
    .filter((l) => l[1]);
  if (leituras.length || vs.chaves) {
    B.push({ t: 'clausula', texto: 'LEITURAS E CHAVES' });
    B.push({ t: 'tabela', cab: ['Item', 'Leitura / quantidade', 'Instalação nº'], linhas: [
      ...leituras.map((l) => [l[0], String(l[1]), l[2] || '—']),
      ...(vs.chaves ? [['Chaves entregues', String(vs.chaves), '']] : []),
    ] });
  }
  B.push({ t: 'clausula', texto: 'ESTADO DO IMÓVEL POR AMBIENTE' });
  const comparar = saida && entrada;
  const cab = comparar ? ['Ambiente / item', 'Na entrada', 'Na saída', 'Observações'] : ['Ambiente / item', 'Estado', 'Observações'];
  B.push({ t: 'tabela', cab, linhas: (vs.ambientes || []).filter((a) => a.nome).map((a) => {
    if (comparar) {
      const e = entrada.ambientes?.find((x) => x.nome === a.nome);
      return [a.nome, e?.estado || '—', a.estado || '—', a.observacao || ''];
    }
    return [a.nome, a.estado || '—', a.observacao || ''];
  }) });
  if (vs.observacoes) { B.push({ t: 'clausula', texto: 'OBSERVAÇÕES' }); B.push({ t: 'p', texto: vs.observacoes }); }
  B.push({ t: 'p', texto: saida
    ? 'As partes declaram que o imóvel foi vistoriado na devolução e se encontra no estado acima descrito. Eventuais danos além do desgaste natural pelo uso normal serão de responsabilidade do LOCATÁRIO, conforme o contrato de locação.'
    : 'O LOCATÁRIO declara ter vistoriado o imóvel e recebê-lo no estado acima descrito, comprometendo-se a devolvê-lo nas mesmas condições ao final da locação, ressalvado o desgaste natural pelo uso normal. Este termo é parte integrante do contrato de locação.' });
  if (fotos.length) {
    B.push({ t: 'clausula', texto: `REGISTRO FOTOGRÁFICO (${fotos.length} foto${fotos.length > 1 ? 's' : ''})` });
    B.push({ t: 'imagens', lista: fotos });
  }
  B.push({ t: 'local', texto: `${cidadeDe(foroDe(db, c))}, ${fmtDataExtenso(vs.data || hojeISO())}.` });
  B.push({ t: 'assinaturas', lista: [...assinaturasLocadores(db, c), { nome: v(q.nome), papel: 'LOCATÁRIO' }] });
  return B;
}

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

export async function paraDocx(blocos) {
  const d = await import(DOCX_URL);
  const { Document, Packer, Paragraph, TextRun, AlignmentType, Table, TableRow, TableCell, WidthType, ImageRun } = d;
  const runs = (t, extra = {}) => partesNegrito(t).map((p) => new TextRun({ text: p.texto, bold: p.negrito || extra.bold, size: extra.size }));
  const filhos = [];
  for (const b of blocos) {
    if (b.t === 'titulo') {
      filhos.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 300, before: 200 },
        children: [new TextRun({ text: b.texto, bold: true, size: 26 })] }));
    } else if (b.t === 'clausula') {
      filhos.push(new Paragraph({ spacing: { before: 240, after: 120 }, keepNext: true,
        children: [new TextRun({ text: b.texto, bold: true })] }));
    } else if (b.t === 'p') {
      filhos.push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { after: 140, line: 300 }, children: runs(b.texto) }));
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
    if (b.t === 'p') return `<p>${htmlRuns(b.texto)}</p>`;
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
