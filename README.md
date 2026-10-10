# Campos Patrimonial — Gestão de imóveis e aluguéis

Sistema web para controlar os imóveis da família: cadastro dos imóveis, inquilinos, contratos,
pagamentos, despesas, reajustes (IGP-M/IPCA) e geração automática de contratos, notificações de
reajuste e recibos em Word (.docx) ou PDF.

- **Funciona no navegador** (computador e celular), em qualquer lugar.
- **Login com conta Microsoft.** Cada pessoa entra com a própria conta.
- **Os dados ficam no OneDrive**, na pasta `Campos_Patrimonial\Imobiliaria`. O site não guarda dados:
  ele lê e grava direto nessa pasta. Quem não tem acesso à pasta não vê nada.

## Onde ficam os arquivos

```
OneDrive\Campos_Patrimonial\
├── Imobiliaria\                 ← pasta de DADOS (compartilhar com o pai)
│   ├── dados\imobiliaria.json   (base de dados do sistema) e dados\backups\ (cópia diária)
│   ├── contratos\Vigentes\      (contratos em vigor; o sistema gera os novos aqui)
│   ├── contratos\Encerrados\    (contratos antigos)
│   ├── contratos\Originais\     (arquivos como estavam antes da organização)
│   ├── modelos\                 (modelos editáveis no Word: contrato e laudos de vistoria)
│   ├── laudos\                  (laudos/termos de vistoria)
│   ├── certidoes\               (certidões)
│   ├── notificações\            (notificações extrajudiciais e de reajuste)
│   └── recibos\                 (recibos de aluguel)
└── sistema-imobiliaria\         ← CÓDIGO do site (esta pasta, vai para o GitHub)
```

A base inicial é criada a partir da planilha de ativos da família.
Os inquilinos e contratos ainda não existem na planilha. Cadastre-os pelo sistema em **Nova locação**,
marcando “Contrato já em andamento” para locações antigas.

---

## Como colocar no ar (uma vez só, ~20 minutos)

### Passo 1 — Registrar o aplicativo na Microsoft (para o login)

1. Acesse <https://entra.microsoft.com> com a sua conta Microsoft (a do OneDrive).
   - Se aparecer que sua conta não tem diretório, crie uma conta gratuita do Azure em
     <https://azure.microsoft.com/free> com a mesma conta e volte a este passo. Não há custo para isto.
2. Menu **Aplicativos → Registros de aplicativo → Novo registro**.
   - **Nome:** `Campos Patrimonial`
   - **Tipos de conta com suporte:** *Contas em qualquer diretório organizacional e contas pessoais da Microsoft*
   - **URI de redirecionamento:** plataforma **Aplicativo de página única (SPA)** e o endereço do site, por ex.:
     `https://SEU-USUARIO.github.io/campos-imobiliaria/` (com a barra no final)
3. Clique em **Registrar**. Copie o **ID do aplicativo (cliente)**.
4. Abra `js/config.js` e cole o ID em `clientId: '...'`.
5. Em **Autenticação**, adicione também o endereço `http://localhost:8080/` (para testar no computador).
6. Em **Permissões de API → Adicionar permissão → Microsoft Graph → Permissões delegadas**, marque
   `User.Read` e `Files.ReadWrite.All`. No primeiro login, cada pessoa autoriza o acesso.

### Passo 2 — Publicar o site (GitHub Pages, gratuito)

1. Crie uma conta em <https://github.com>, se ainda não tiver.
2. Crie um repositório **público** chamado `campos-imobiliaria`. Ele precisa ser público para o Pages gratuito,
   e isso não expõe dados, porque o código não contém nenhuma informação dos imóveis.
3. Envie o conteúdo desta pasta (`sistema-imobiliaria`) para o repositório. Pode arrastar os arquivos em
   **Add file → Upload files**.
4. Em **Settings → Pages**, escolha *Deploy from a branch*, branch `main`, pasta `/ (root)`.
5. Em 1 a 2 minutos o site estará em `https://SEU-USUARIO.github.io/campos-imobiliaria/`.

### Passo 3 — Dar acesso ao seu pai

1. No OneDrive (site ou Windows Explorer), clique com o botão direito na pasta **Imobiliaria** →
   **Compartilhar** → informe o e-mail da conta Microsoft dele → permissão **Pode editar** → Enviar.
2. Ele abre o link recebido e clica em **Adicionar a Meus arquivos**, que é o recomendado.
3. Ele acessa o endereço do site e entra com a conta Microsoft dele. O sistema encontra a pasta sozinho.
   Se não encontrar, aparece um campo para colar o link de compartilhamento da pasta.

> Seu pai precisa de uma conta Microsoft (Outlook/Hotmail, ou qualquer e-mail cadastrado como conta Microsoft).

---

## Uso

| Tela | O que faz |
|---|---|
| **Painel** | Aluguel mensal, recebido no mês, atrasos, valor de mercado, imóveis vagos ou em reforma, e alertas de reajuste, vencimento de contrato e vencimento de garantia. |
| **Imóveis** | Lista com filtros e ficha completa: endereço, matrícula, IPTU, nº das instalações de energia e água, situação (inclusive "em reforma"), **proprietários com %** e **fotos e documentos** salvos em `Imoveis\Ref XX`. |
| **Inquilinos** | Pessoa física ou jurídica, busca de CEP, validação de CPF/CNPJ, **histórico de pagamentos** e **ocorrências**. |
| **Contratos → Nova locação** | Cadastra inquilino e contrato de uma vez e gera o contrato .docx. Locações antigas entram com "Contrato já em andamento". |
| **Contrato (detalhe)** | Pagamentos, reajustes, **garantia com vencimento** (fiador, caução, seguro-fiança, título de capitalização), **termos aditivos**, **vistorias de entrada e saída com fotos**, **contrato assinado e anexos (PDF)** e **encerramento com cálculo da multa rescisória proporcional** (art. 4º da Lei 8.245/91). |
| **Financeiro** | Aluguéis do mês, registro individual ou em lote, multa/juros/correção calculados pela regra de cada contrato, lista de **multas e juros a cobrar**, recibos, despesas e resumo anual. |
| **Documentos** | Gera contrato e laudos de vistoria de entrada e de saída (preenchidos ou em branco para a visita) e gerencia os **modelos editáveis no Word**. |
| **Histórico** | Por imóvel ou por inquilino: contratos, pagamentos mês a mês, atrasos, multas e juros não recebidos, pontualidade, ocupação, rentabilidade e linha do tempo. Imprime/PDF e exporta planilha (CSV). |
| **Reajustes** | Calculadora com 5 índices (IGP-M, IPCA, INPC, IGP-DI, IPC-Fipe), **aplicação em lote**, reajuste automático opcional e notificações. |
| **Configurações** | **Cadastro de proprietários** (dados pessoais e bancários/Pix para repasse), multas, juros, reajuste automático e histórico de alterações. |

- **Modelos no Word:** em Documentos, clique em "Criar modelo para editar". O arquivo vai para `modelos\` no OneDrive.
  Edite livremente no Word, mantendo os campos entre chaves, como `{locatario_nome}`. Daí em diante, o sistema usa o
  seu modelo. "Restaurar padrão" volta ao texto original.
- **Garantia:** uma modalidade por contrato (art. 37), que pode ser fiança com vários fiadores e cônjuges, caução
  (dinheiro, cheques ou bens), seguro-fiança, título de capitalização, aluguel antecipado (art. 42) ou nenhuma.
- **Encerrar contrato:** ao encerrar (ou reativar), o sistema oferece mover os arquivos do contrato entre
  `contratos\Vigentes` e `contratos\Encerrados`. Em Documentos → "Atualizar pastas", ele confere todas as pastas de uma vez.
- **Planilha de pagamentos:** `Imobiliaria\Pagamentos 2026.xlsx` tem uma linha por contrato e por mês. Preencha a data e o valor
  pagos, e importe em Financeiro → "Importar planilha de pagamentos". Pode reimportar quantas vezes quiser, sem duplicar.
- **Histórico de pagamentos:** no contrato, use "Lançar histórico de pagamentos". O sistema mostra, mês a mês, a multa,
  os juros e a correção devidos pela regra do contrato (por padrão, multa de 10% e, acima de 30 dias de atraso, juros
  de 1% a.m. e correção).
- Os índices vêm da API pública do Banco Central (séries 189 IGP-M e 433 IPCA).
- Você e seu pai podem usar o sistema ao mesmo tempo. Se os dois salvarem juntos, o sistema relê o arquivo
  e reaplica as alterações, sem perder nada. O botão **↻ Atualizar** busca o que a outra pessoa fez.
- **Imprimir / PDF** abre o documento pronto para imprimir ou “Salvar como PDF”.
- Os locadores dos contratos, aditivos, vistorias e recibos são os **proprietários cadastrados no imóvel**, com a
  participação de cada um. Complete os dados de cada proprietário em Configurações antes de gerar documentos.
- Os documentos são modelos baseados na Lei 8.245/91. Revise antes de assinar.
- Cada contrato tem uma pasta própria em `Contratos\Ref XX - Inquilino\`, onde ficam vistorias, aditivos e PDFs assinados.

## Testar no computador

Requer [Node.js](https://nodejs.org). Na pasta `sistema-imobiliaria`:

```bash
node dev/servidor.mjs
```

- <http://localhost:8080/?demo> abre a demonstração com dados fictícios. Nada é salvo.
- <http://localhost:8080/?mock=Teste> abre um OneDrive simulado na pasta `dev/mock-onedrive`, sem login.
- <http://localhost:8080/> faz o login Microsoft de verdade e exige o Passo 1.

## Estrutura do código

Site estático, sem etapa de build. Usa Vue 3, MSAL e docx, carregados de CDN.

- `js/app.js`: rotas, login e inicialização
- `js/db.js`: base de dados, salvamento com controle de conflito e regras (cobranças, reajustes)
- `js/storage.js`: leitura e gravação no OneDrive (Microsoft Graph)
- `js/indices.js`: IGP-M/IPCA e cálculo de reajuste
- `js/documentos.js`: textos do contrato, notificação e recibo, e geração .docx/PDF
- `js/views/`: telas
