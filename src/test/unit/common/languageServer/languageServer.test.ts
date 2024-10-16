/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import assert, { deepStrictEqual, strictEqual } from 'assert';
import { ReplaySubject } from 'rxjs';
import sinon from 'sinon';
import { v4 } from 'uuid';
import { IAuthenticationService } from '../../../../snyk/base/services/authenticationService';
import { IConfiguration } from '../../../../snyk/common/configuration/configuration';
import { ExperimentService } from '../../../../snyk/common/experiment/services/experimentService';
import { LanguageServer } from '../../../../snyk/common/languageServer/languageServer';
import { InitializationOptions } from '../../../../snyk/common/languageServer/settings';
import { DownloadService } from '../../../../snyk/common/services/downloadService';
import { User } from '../../../../snyk/common/user';
import { ILanguageClientAdapter } from '../../../../snyk/common/vscode/languageClient';
import { LanguageClient, LanguageClientOptions, ServerOptions } from '../../../../snyk/common/vscode/types';
import { IVSCodeWorkspace } from '../../../../snyk/common/vscode/workspace';
import { defaultFeaturesConfigurationStub } from '../../mocks/configuration.mock';
import { LoggerMock } from '../../mocks/logger.mock';
import { windowMock } from '../../mocks/window.mock';
import { stubWorkspaceConfiguration } from '../../mocks/workspace.mock';

suite('Language Server', () => {
  const authServiceMock = {} as IAuthenticationService;
  const user = new User(v4(), undefined, new LoggerMock());

  let configurationMock: IConfiguration;
  let languageServer: LanguageServer;
  let downloadServiceMock: DownloadService;
  setup(() => {
    configurationMock = {
      getInsecure(): boolean {
        return true;
      },
      getCliPath(): string | undefined {
        return 'testPath';
      },
      getToken(): Promise<string | undefined> {
        return Promise.resolve('testToken');
      },
      shouldReportEvents: true,
      shouldReportErrors: true,
      getSnykLanguageServerPath(): string {
        return 'testPath';
      },
      getAdditionalCliParameters() {
        return '--all-projects';
      },
      isAutomaticDependencyManagementEnabled() {
        return true;
      },
      getPreviewFeatures() {
        return {
          advisor: false,
          reportFalsePositives: false,
        };
      },
      getFeaturesConfiguration() {
        return defaultFeaturesConfigurationStub;
      },
      severityFilter: {
        critical: true,
        high: true,
        medium: true,
        low: true,
      },
      getTrustedFolders(): string[] {
        return ['/trusted/test/folder'];
      },
      scanningMode: 'auto',
    } as IConfiguration;

    downloadServiceMock = {
      downloadReady$: new ReplaySubject<void>(1),
    } as DownloadService;
  });

  teardown(() => {
    sinon.restore();
  });

  test('LanguageServer adds proxy settings to env of started binary', async () => {
    const expectedProxy = 'http://localhost:8080';
    const lca = sinon.spy({
      create(
        id: string,
        name: string,
        serverOptions: ServerOptions,
        clientOptions: LanguageClientOptions,
      ): LanguageClient {
        return {
          start(): Promise<void> {
            assert.strictEqual(id, 'Snyk LS');
            assert.strictEqual(name, 'Snyk Language Server');
            assert.strictEqual(
              'options' in serverOptions ? serverOptions?.options?.env?.http_proxy : undefined,
              expectedProxy,
            );
            assert.strictEqual(clientOptions.initializationOptions.token, 'testToken');
            return Promise.resolve();
          },
          onNotification(): void {
            return;
          },
          onReady(): Promise<void> {
            return Promise.resolve();
          },
        } as unknown as LanguageClient;
      },
    });

    languageServer = new LanguageServer(
      user,
      configurationMock,
      lca as unknown as ILanguageClientAdapter,
      stubWorkspaceConfiguration('http.proxy', expectedProxy),
      windowMock,
      authServiceMock,
      new LoggerMock(),
      downloadServiceMock,
      new ExperimentService(user, new LoggerMock(), configurationMock),
    );
    downloadServiceMock.downloadReady$.next();
    await languageServer.start();
    sinon.assert.called(lca.create);
    sinon.verify();
  });

  suite('LanguageServer is initialized', () => {
    setup(() => {
      const mockLanguageClient = {
        start: sinon.stub().resolves(),
      };
      const mockLanguageClientAdapter = {
        create: sinon.stub().returns(mockLanguageClient),
        getLanguageClient: sinon.stub().returns(mockLanguageClient),
      };
      languageServer = new LanguageServer(
        user,
        configurationMock,
        mockLanguageClientAdapter,
        {} as IVSCodeWorkspace,
        windowMock,
        authServiceMock,
        new LoggerMock(),
        downloadServiceMock,
        new ExperimentService(user, new LoggerMock(), configurationMock),
      );
    });

    test('LanguageServer should provide correct initialization options', async () => {
      const expectedInitializationOptions: InitializationOptions = {
        activateSnykCodeSecurity: 'false',
        activateSnykCodeQuality: 'false',
        activateSnykOpenSource: 'false',
        activateSnykIac: 'true',
        token: 'testToken',
        cliPath: 'testPath',
        enableTelemetry: 'true',
        sendErrorReports: 'true',
        integrationName: 'VS_CODE',
        integrationVersion: '0.0.0',
        automaticAuthentication: 'false',
        endpoint: undefined,
        organization: undefined,
        additionalParams: '--all-projects',
        manageBinariesAutomatically: 'true',
        deviceId: user.anonymousId,
        filterSeverity: { critical: true, high: true, medium: true, low: true },
        enableTrustedFoldersFeature: 'true',
        trustedFolders: ['/trusted/test/folder'],
        insecure: 'true',
        scanningMode: 'auto',
      };

      deepStrictEqual(await languageServer.getInitializationOptions(), expectedInitializationOptions);
    });

    test('LanguageServer should respect experiment setup for Code', async () => {
      const experimentServiceMock = {
        isUserPartOfExperiment: sinon.stub().resolves(true),
      };
      languageServer = new LanguageServer(
        user,
        configurationMock,
        {} as ILanguageClientAdapter,
        {} as IVSCodeWorkspace,
        windowMock,
        authServiceMock,
        new LoggerMock(),
        downloadServiceMock,
        experimentServiceMock as unknown as ExperimentService,
      );

      const initOptions = await languageServer.getInitializationOptions();

      strictEqual(initOptions.activateSnykCodeQuality, `true`);
      strictEqual(initOptions.activateSnykCodeQuality, `true`);
    });

    ['auto', 'manual'].forEach(expectedScanningMode => {
      test(`scanningMode is set to ${expectedScanningMode}`, async () => {
        configurationMock.scanningMode = expectedScanningMode;
        const options = await languageServer.getInitializationOptions();

        assert.strictEqual(options.scanningMode, expectedScanningMode);
      });
    });
  });
});
