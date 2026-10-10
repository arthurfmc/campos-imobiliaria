// Dados fictícios para o modo demonstração (?demo). Nada aqui é real.
import { dbVazio } from './db.js';
import { hojeISO, mesAtual, somaMeses, somaMesesData, vencimentoDe } from './util.js';

export function dadosDemo() {
  const db = dbVazio();
  const hoje = hojeISO();
  db.config.locador = { nome: 'José da Silva Exemplo', nacionalidade: 'brasileiro', estadoCivil: 'casado', profissao: 'engenheiro aposentado',
    cpf: '529.982.247-25', rg: 'MG-1.234.567', endereco: 'Rua das Flores, 100, Centro, Cidade Exemplo/MG, CEP 39000-000', email: '', telefone: '' };
  db.config.foro = 'Cidade Exemplo - MG';
  const im = (ref, descricao, tipo, cidade, valorMercado, situacao, aluguelPlanilha = 0) => ({
    id: `im${ref}`, ref, descricao, tipo, endereco: '', cidade, uf: 'MG', area: '', unidadeArea: 'm²', titular: 'José',
    matricula: '', cartorio: '', inscricaoIptu: '', valorDeclarado: valorMercado / 5, valorVenal: 0, valorMercado, situacao,
    aluguelPlanilha, declaraAluguel: false, observacoes: '' });
  db.imoveis = [
    im(1, 'LOJA 01, RUA PRINCIPAL, 500 - CENTRO - CIDADE EXEMPLO/MG', 'Loja', 'Cidade Exemplo', 800000, 'Alugado', 5000),
    im(2, 'LOJA 02, RUA PRINCIPAL, 500 - CENTRO - CIDADE EXEMPLO/MG', 'Loja', 'Cidade Exemplo', 650000, 'Alugado', 4200),
    im(3, 'APARTAMENTO 201, RUA DAS ACÁCIAS, 45 - BELO HORIZONTE/MG', 'Apartamento', 'Belo Horizonte', 550000, 'Alugado', 2500),
    im(4, 'LOTE 10, QUADRA 3, BAIRRO NOVO - CIDADE EXEMPLO/MG', 'Lote', 'Cidade Exemplo', 120000, 'Vago'),
    im(5, 'CASA, RUA DO SOL, 12 - CIDADE EXEMPLO/MG', 'Casa', 'Cidade Exemplo', 400000, 'Alugado', 1800),
  ];
  const q = (id, nome, tipo, doc) => ({ id, tipo, nome, cpfCnpj: doc, rg: '', orgaoEmissor: '', nacionalidade: 'brasileiro(a)', estadoCivil: 'casado(a)',
    profissao: 'comerciante', nascimento: '', email: 'contato@exemplo.com', telefone: '(38) 99999-0000', cep: '', logradouro: 'Rua Exemplo',
    numero: '10', complemento: '', bairro: 'Centro', cidade: 'Cidade Exemplo', uf: 'MG', representanteNome: tipo === 'PJ' ? 'Maria Exemplo' : '',
    representanteCpf: '', representanteCargo: tipo === 'PJ' ? 'sócia-administradora' : '', observacoes: '' });
  db.proprietarios = [
    { ...db.config.locador, id: 'prop-jose', tipo: 'PF', banco: 'Banco Exemplo', agencia: '0001', conta: '12345-6', pix: 'jose@exemplo.com' },
    { id: 'prop-filho', tipo: 'PF', nome: 'Pedro Exemplo da Silva', cpf: '111.444.777-35', nacionalidade: 'brasileiro', estadoCivil: 'casado',
      profissao: 'engenheiro', rg: 'MG-7.654.321', endereco: 'Rua B, 20, Cidade Exemplo/MG', email: '', telefone: '', banco: '', agencia: '', conta: '', pix: '' },
  ];
  for (const i of db.imoveis) i.proprietarios = [{ proprietarioId: 'prop-jose', percentual: 100 }];
  db.imoveis[1].proprietarios = [{ proprietarioId: 'prop-jose', percentual: 50 }, { proprietarioId: 'prop-filho', percentual: 50 }];
  db.imoveis[3].situacao = 'Em reforma';
  db.imoveis[3].tipo = 'Casa';
  db.inquilinos = [
    q('q1', 'Farmácia Exemplo Ltda', 'PJ', '11.222.333/0001-81'),
    q('q2', 'Carlos Exemplo Souza', 'PF', '111.444.777-35'),
    q('q3', 'Ana Exemplo Lima', 'PF', '529.982.247-25'),
  ];
  const ct = (id, imovelId, inquilinoId, mesesAtras, valor, indice, finalidade) => {
    const inicio = somaMesesData(hoje.slice(0, 8) + '05', -mesesAtras);
    return { id, imovelId, inquilinoId, unidade: '', finalidade, atividade: finalidade === 'comercial' ? 'farmácia' : '',
      dataInicio: inicio, prazoMeses: 36, dataFim: '', diaVencimento: 10, valorInicial: valor, indice, periodicidadeMeses: 12,
      formaPagamento: 'PIX', dadosBancarios: '', encargos: { iptu: true, condominio: false, agua: true, luz: true, seguro: false },
      garantia: { tipo: 'fiador', fiadores: [{ nome: 'Pedro Fiador Exemplo', cpf: '111.444.777-35', estadoCivil: 'casado', conjugeNome: 'Ana Fiadora Exemplo' }] },
      controleDesde: somaMeses(mesAtual(), -3), dataAssinatura: inicio, clausulasAdicionais: '', observacoes: '',
      status: 'ativo', reajustes: [], documentos: [] };
  };
  db.contratos = [
    ct('c1', 'im1', 'q1', 12, 4800, 'IGP-M', 'comercial'),
    ct('c2', 'im3', 'q2', 7, 2500, 'IPCA', 'residencial'),
    ct('c3', 'im2', 'q3', 25, 3900, 'IGP-M', 'comercial'),
  ];
  db.contratos[2].reajustes.push({ id: 'r1', tipo: 'manual', indice: 'IGP-M', vigenciaDesde: somaMeses(db.contratos[2].dataInicio.slice(0, 7), 12),
    valorAnterior: 3900, valorNovo: 4100, pct: 5.13, pctAplicado: null, observacao: 'exemplo' });
  // Pagamentos dos últimos meses (o mês atual fica em aberto).
  for (const c of db.contratos) {
    for (let k = 3; k >= 1; k--) {
      const ym = somaMeses(mesAtual(), -k);
      if (c.id === 'c2' && k === 1) continue; // um atraso para demonstrar
      db.pagamentos.push({ id: `p${c.id}${k}`, contratoId: c.id, competencia: ym, dataPagamento: vencimentoDe(ym, 9),
        valorPago: c.reajustes.length ? 4100 : c.valorInicial, acrescimos: 0, descontos: 0, forma: 'PIX', observacao: '' });
    }
  }
  db.despesas = [{ id: 'd1', imovelId: 'im4', data: hoje, categoria: 'IPTU', descricao: 'IPTU parcela', valor: 180 }];
  db.log = [{ quando: new Date().toISOString(), quem: 'Demonstração', acao: 'Dados fictícios carregados' }];
  return db;
}
