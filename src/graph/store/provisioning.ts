import { initConfig } from '../../config/settings.js';
import type { GraphStoreConfig } from './GraphStore.js';
import { Neo4jProvisioner } from './Neo4jProvisioner.js';

export async function prepareNeo4jConfig(config: GraphStoreConfig): Promise<GraphStoreConfig> {
  if (config.kind !== 'neo4j') {
    return config;
  }

  const mergedProvisioning = mergeProvisioningConfig(config.provisioning);
  if (!mergedProvisioning.enabled) {
    return { ...config, provisioning: mergedProvisioning };
  }

  const provisioningConfig = { ...config, provisioning: mergedProvisioning };

  const provisioner = new Neo4jProvisioner(provisioningConfig);
  const details = await provisioner.ensure();

  const updated: GraphStoreConfig = {
    ...provisioningConfig,
    uri: details.uri,
    username: details.username,
    password: details.password,
    provisioning: {
      ...provisioningConfig.provisioning,
      databaseId: details.id,
      expiresAt: details.expiresAt,
    },
  };

  await initConfig({ graphStore: updated });
  return updated;
}

export async function destroyProvisionedNeo4j(config: GraphStoreConfig): Promise<void> {
  const mergedProvisioning = mergeProvisioningConfig(config.provisioning);
  if (config.kind !== 'neo4j' || !mergedProvisioning.enabled || !mergedProvisioning.databaseId) {
    return;
  }

  const provisioner = new Neo4jProvisioner({ ...config, provisioning: mergedProvisioning });
  await provisioner.destroy();

  const cleaned: GraphStoreConfig = {
    ...config,
    uri: undefined,
    username: undefined,
    password: undefined,
    provisioning: {
      ...mergedProvisioning,
      databaseId: undefined,
      expiresAt: undefined,
    },
  };

  await initConfig({ graphStore: cleaned });
}

function mergeProvisioningConfig(provisioning: GraphStoreConfig['provisioning']): NonNullable<GraphStoreConfig['provisioning']> {
  const envEnabled = process.env.CODEFLOW_PROVISIONING_API_URL ? true : undefined;
  const retentionEnv = process.env.CODEFLOW_PROVISIONING_RETENTION
    ? Number.parseInt(process.env.CODEFLOW_PROVISIONING_RETENTION, 10)
    : undefined;

  return {
    enabled: provisioning?.enabled ?? envEnabled ?? false,
    apiUrl: provisioning?.apiUrl ?? process.env.CODEFLOW_PROVISIONING_API_URL,
    apiKey: provisioning?.apiKey ?? process.env.CODEFLOW_PROVISIONING_API_KEY,
    retentionDays: provisioning?.retentionDays ?? retentionEnv,
    databaseId: provisioning?.databaseId,
    expiresAt: provisioning?.expiresAt,
  };
}
