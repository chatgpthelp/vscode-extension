import { validate as uuidValidate } from 'uuid';
import { IAnalytics } from '../../common/analytics/itly';
import { IConfiguration } from '../../common/configuration/configuration';
import { SNYK_WORKSPACE_SCAN_COMMAND } from '../../common/constants/commands';
import { DID_CHANGE_CONFIGURATION_METHOD } from '../../common/constants/languageServer';
import { SNYK_CONTEXT } from '../../common/constants/views';
import { ILog } from '../../common/logger/interfaces';
import { IContextService } from '../../common/services/contextService';
import { IVSCodeCommands } from '../../common/vscode/commands';
import { ILanguageClientAdapter } from '../../common/vscode/languageClient';
import { IVSCodeWindow } from '../../common/vscode/window';
import { IBaseSnykModule } from '../modules/interfaces';

export interface IAuthenticationService {
  initiateLogin(): Promise<void>;

  initiateLogout(): Promise<void>;

  setToken(): Promise<void>;

  updateToken(token: string): Promise<void>;
}

export type OAuthToken = {
  access_token: string;
  expiry: string;
  refresh_token: string;
};

export class AuthenticationService implements IAuthenticationService {
  constructor(
    private readonly contextService: IContextService,
    private readonly baseModule: IBaseSnykModule,
    private readonly configuration: IConfiguration,
    private readonly window: IVSCodeWindow,
    private readonly analytics: IAnalytics,
    private readonly logger: ILog,
    private readonly clientAdapter: ILanguageClientAdapter,
    private commands: IVSCodeCommands,
  ) {}

  async initiateLogin(): Promise<void> {
    this.analytics.logAuthenticateButtonIsClicked();
    await this.contextService.setContext(SNYK_CONTEXT.LOGGEDIN, false);
    await this.contextService.setContext(SNYK_CONTEXT.AUTHENTICATING, true);
  }

  async initiateLogout(): Promise<void> {
    await this.configuration.clearToken();
    await this.contextService.setContext(SNYK_CONTEXT.LOGGEDIN, false);
  }

  async setToken(): Promise<void> {
    const token = await this.window.showInputBox({
      placeHolder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
      password: true,
      validateInput: token => {
        const valid = this.validateToken(token);
        if (!valid) {
          return 'The entered token has an invalid format.';
        }
      },
    });

    if (!token) return;
    await this.configuration.setToken(token);
    return await this.clientAdapter.getLanguageClient().sendNotification(DID_CHANGE_CONFIGURATION_METHOD, {});
  }

  validateToken(token: string) {
    let valid = uuidValidate(token);
    if (valid) return true;

    // try to parse as json (oauth2 token)
    try {
      const oauthToken = JSON.parse(token) as OAuthToken;
      valid =
        oauthToken.access_token.length > 0 &&
        Date.parse(oauthToken.expiry) > Date.now() &&
        oauthToken.refresh_token.length > 0;
      this.logger.debug(`Token ${token} parsed`);
    } catch (e) {
      this.logger.warn(`Token ${token} is not a valid uuid or json string: ${e}`);
    }
    return valid;
  }

  async updateToken(token: string): Promise<void> {
    if (!token) {
      await this.initiateLogout();
    } else {
      if (!this.validateToken(token)) return Promise.reject(new Error('The entered token has an invalid format.'));

      await this.configuration.setToken(token);
      await this.contextService.setContext(SNYK_CONTEXT.AUTHENTICATING, false);
      await this.contextService.setContext(SNYK_CONTEXT.LOGGEDIN, true);

      this.baseModule.loadingBadge.setLoadingBadge(false);
      await this.commands.executeCommand(SNYK_WORKSPACE_SCAN_COMMAND);
    }
  }
}
