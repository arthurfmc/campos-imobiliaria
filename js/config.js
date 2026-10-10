// Configuração do sistema. Veja o README.md para o passo a passo.
export const CONFIG = {
  // "ID do aplicativo (cliente)" do registro no portal do Azure (Microsoft Entra).
  clientId: '17e27b13-460c-4769-a418-ce6d3318d4bd',

  // 'common' = contas pessoais (Outlook/Hotmail/Live) e corporativas.
  // Use 'consumers' se o app foi registrado só para contas pessoais.
  authority: 'https://login.microsoftonline.com/common',

  // Pasta de dados no OneDrive de quem é dono (relativa à raiz do OneDrive).
  // Para quem recebeu a pasta compartilhada, o sistema procura pelo nome automaticamente.
  pastaOneDrive: 'Campos_Patrimonial/Imobiliaria',

  // Subpastas onde os documentos gerados são salvos (dentro da pasta acima).
  pastaContratos: 'contratos/Vigentes',
  pastaEncerrados: 'contratos/Encerrados',
  pastaNotificacoes: 'notificações',
  pastaLaudos: 'laudos',
  pastaModelos: 'modelos',
  pastaRecibos: 'recibos',
};
