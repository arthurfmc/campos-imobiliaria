// Login com conta Microsoft (MSAL) para acessar o OneDrive pelo Microsoft Graph.
const ESCOPOS = ['User.Read', 'Files.ReadWrite.All'];

export async function iniciarAuth(cfg) {
  const msal = window.msal;
  const redirectUri = location.origin + location.pathname.replace(/index\.html$/, '');
  const pca = new msal.PublicClientApplication({
    auth: { clientId: cfg.clientId, authority: cfg.authority, redirectUri },
    cache: { cacheLocation: 'localStorage' },
  });
  await pca.initialize();
  const resp = await pca.handleRedirectPromise();
  if (resp?.account) pca.setActiveAccount(resp.account);
  else if (!pca.getActiveAccount() && pca.getAllAccounts().length) pca.setActiveAccount(pca.getAllAccounts()[0]);

  const conta = () => pca.getActiveAccount();

  return {
    conta,
    nome: () => conta()?.name || conta()?.username || '',
    login: () => pca.loginRedirect({ scopes: ESCOPOS, prompt: 'select_account' }),
    logout: () => pca.logoutRedirect({ account: conta(), postLogoutRedirectUri: redirectUri }),
    async getToken() {
      const account = conta();
      if (!account) throw new Error('Faça login novamente.');
      try {
        return (await pca.acquireTokenSilent({ scopes: ESCOPOS, account })).accessToken;
      } catch (e) {
        if (e instanceof msal.InteractionRequiredAuthError || e.errorCode === 'no_tokens_found') {
          await pca.acquireTokenRedirect({ scopes: ESCOPOS, account });
        }
        throw e;
      }
    },
  };
}
