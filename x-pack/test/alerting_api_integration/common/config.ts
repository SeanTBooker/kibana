/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */

import path from 'path';
import getPort from 'get-port';
import fs from 'fs';
import { CA_CERT_PATH } from '@kbn/dev-utils';
import { FtrConfigProviderContext } from '@kbn/test/types/ftr';
import { services } from './services';
import { getAllExternalServiceSimulatorPaths } from './fixtures/plugins/actions_simulators/server/plugin';

interface CreateTestConfigOptions {
  license: string;
  disabledPlugins?: string[];
  ssl?: boolean;
  enableActionsProxy: boolean;
  rejectUnauthorized?: boolean;
}

// test.not-enabled is specifically not enabled
const enabledActionTypes = [
  '.email',
  '.index',
  '.pagerduty',
  '.server-log',
  '.servicenow',
  '.jira',
  '.resilient',
  '.slack',
  '.webhook',
  'test.authorization',
  'test.failing',
  'test.index-record',
  'test.noop',
  'test.rate-limit',
  'test.throw',
];

export function createTestConfig(name: string, options: CreateTestConfigOptions) {
  const {
    license = 'trial',
    disabledPlugins = [],
    ssl = false,
    rejectUnauthorized = true,
  } = options;

  return async ({ readConfigFile }: FtrConfigProviderContext) => {
    const xPackApiIntegrationTestsConfig = await readConfigFile(
      require.resolve('../../api_integration/config.ts')
    );
    const servers = {
      ...xPackApiIntegrationTestsConfig.get('servers'),
      elasticsearch: {
        ...xPackApiIntegrationTestsConfig.get('servers.elasticsearch'),
        protocol: ssl ? 'https' : 'http',
      },
    };
    // Find all folders in ./plugins since we treat all them as plugin folder
    const allFiles = fs.readdirSync(path.resolve(__dirname, 'fixtures', 'plugins'));
    const plugins = allFiles.filter((file) =>
      fs.statSync(path.resolve(__dirname, 'fixtures', 'plugins', file)).isDirectory()
    );

    const proxyPort =
      process.env.ALERTING_PROXY_PORT ?? (await getPort({ port: getPort.makeRange(6200, 6300) }));
    const actionsProxyUrl = options.enableActionsProxy
      ? [
          `--xpack.actions.proxyUrl=http://localhost:${proxyPort}`,
          '--xpack.actions.proxyRejectUnauthorizedCertificates=false',
        ]
      : [];

    return {
      testFiles: [require.resolve(`../${name}/tests/`)],
      servers,
      services,
      junit: {
        reportName: 'X-Pack Alerting API Integration Tests',
      },
      esArchiver: xPackApiIntegrationTestsConfig.get('esArchiver'),
      esTestCluster: {
        ...xPackApiIntegrationTestsConfig.get('esTestCluster'),
        license,
        ssl,
        serverArgs: [
          `xpack.license.self_generated.type=${license}`,
          `xpack.security.enabled=${
            !disabledPlugins.includes('security') && ['trial', 'basic'].includes(license)
          }`,
        ],
      },
      kbnTestServer: {
        ...xPackApiIntegrationTestsConfig.get('kbnTestServer'),
        serverArgs: [
          ...xPackApiIntegrationTestsConfig.get('kbnTestServer.serverArgs'),
          '--server.publicBaseUrl=https://localhost:5601',
          `--xpack.actions.allowedHosts=${JSON.stringify(['localhost', 'some.non.existent.com'])}`,
          '--xpack.encryptedSavedObjects.encryptionKey="wuGNaIhoMpk5sO4UBxgr3NyW1sFcLgIf"',
          '--xpack.alerts.invalidateApiKeysTask.interval="15s"',
          `--xpack.actions.enabledActionTypes=${JSON.stringify(enabledActionTypes)}`,
          `--xpack.actions.rejectUnauthorized=${rejectUnauthorized}`,
          ...actionsProxyUrl,

          '--xpack.eventLog.logEntries=true',
          `--xpack.actions.preconfigured=${JSON.stringify({
            'my-slack1': {
              actionTypeId: '.slack',
              name: 'Slack#xyz',
              secrets: {
                webhookUrl: 'https://hooks.slack.com/services/abcd/efgh/ijklmnopqrstuvwxyz',
              },
            },
            'custom-system-abc-connector': {
              actionTypeId: 'system-abc-action-type',
              name: 'SystemABC',
              config: {
                xyzConfig1: 'value1',
                xyzConfig2: 'value2',
                listOfThings: ['a', 'b', 'c', 'd'],
              },
              secrets: {
                xyzSecret1: 'credential1',
                xyzSecret2: 'credential2',
              },
            },
            'preconfigured-es-index-action': {
              actionTypeId: '.index',
              name: 'preconfigured_es_index_action',
              config: {
                index: 'functional-test-actions-index-preconfigured',
                refresh: true,
                executionTimeField: 'timestamp',
              },
            },
            'preconfigured.test.index-record': {
              actionTypeId: 'test.index-record',
              name: 'Test:_Preconfigured_Index_Record',
              config: {
                unencrypted: 'ignored-but-required',
              },
              secrets: {
                encrypted: 'this-is-also-ignored-and-also-required',
              },
            },
          })}`,
          ...disabledPlugins.map((key) => `--xpack.${key}.enabled=false`),
          ...plugins.map(
            (pluginDir) =>
              `--plugin-path=${path.resolve(__dirname, 'fixtures', 'plugins', pluginDir)}`
          ),
          `--server.xsrf.allowlist=${JSON.stringify(getAllExternalServiceSimulatorPaths())}`,
          ...(ssl
            ? [
                `--elasticsearch.hosts=${servers.elasticsearch.protocol}://${servers.elasticsearch.hostname}:${servers.elasticsearch.port}`,
                `--elasticsearch.ssl.certificateAuthorities=${CA_CERT_PATH}`,
              ]
            : []),
        ],
      },
    };
  };
}
