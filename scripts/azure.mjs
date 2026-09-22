import { execFileSync } from 'node:child_process';
import { ROOT } from '../src/files.mjs';
import { validateEndpoint } from '../src/provider.mjs';

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || value.includes('<')) throw new Error(`Set ${name} explicitly; see .env.example.`);
  return value;
}

export function readAzureConfig() {
  if (process.env.PROOFPACK_ALLOW_AZURE !== '1') throw new Error('AZURE_OPT_IN_REQUIRED: set PROOFPACK_ALLOW_AZURE=1 only for an authorized operator run.');
  const config = {
    subscription: requiredEnv('AZURE_SUBSCRIPTION_ID'), tenant: requiredEnv('AZURE_TENANT_ID'),
    resourceGroup: requiredEnv('AZURE_RESOURCE_GROUP'), account: requiredEnv('AZURE_ACCOUNT_NAME'),
    deployment: requiredEnv('AZURE_DEPLOYMENT_NAME'), endpoint: validateEndpoint(requiredEnv('FOUNDRY_ENDPOINT')),
  };
  const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!guid.test(config.subscription) || !guid.test(config.tenant)
    || !/^[a-zA-Z0-9][a-zA-Z0-9_.()-]{0,89}$/.test(config.resourceGroup)
    || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(config.account)
    || !/^[a-zA-Z0-9_-]{1,64}$/.test(config.deployment)
    || config.endpoint !== `https://${config.account}.openai.azure.com`) {
    throw new Error('INVALID_AZURE_CONFIG: use explicit account identifiers and its matching endpoint.');
  }
  return config;
}

export function azure(args, config, { output = 'json' } = {}) {
  let result;
  try {
    result = execFileSync('az', [...args, '--subscription', config.subscription, '--only-show-errors', '--output', output], {
      cwd: ROOT, encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 4 * 1024 * 1024,
    });
  } catch (error) {
    throw new Error(`AZURE_CLI_FAILED: ${args.slice(0, 3).join(' ')} (exit ${error.status ?? error.code}). Check your local login and permissions; raw provider output is not copied to reports.`);
  }
  return output === 'json' ? JSON.parse(result) : result.trim();
}

export function verifyAzureBoundary(config) {
  const selected = azure(['account', 'show', '--query', '{id:id,tenantId:tenantId,state:state}'], config);
  if (selected.id.toLowerCase() !== config.subscription.toLowerCase()
    || selected.tenantId.toLowerCase() !== config.tenant.toLowerCase() || selected.state !== 'Enabled') {
    throw new Error('AZURE_ACCOUNT_MISMATCH: subscription or tenant does not match the authorized environment.');
  }
  const group = azure(['group', 'show', '--name', config.resourceGroup, '--query', '{name:name,tags:tags}'], config);
  if (group.name.toLowerCase() !== config.resourceGroup.toLowerCase() || group.tags?.Product !== 'ProofPack') {
    throw new Error('AZURE_GROUP_MISMATCH: use an explicitly reviewed resource group tagged Product=ProofPack.');
  }
  const account = azure(['cognitiveservices', 'account', 'show', '--resource-group', config.resourceGroup, '--name', config.account,
    '--query', '{name:name,location:location,localAuthDisabled:properties.disableLocalAuth}'], config);
  if (account.name !== config.account || account.localAuthDisabled !== true) {
    throw new Error('AZURE_AUTH_BOUNDARY: the selected account must disable local key authentication.');
  }
  const deployment = azure(['cognitiveservices', 'account', 'deployment', 'show', '--resource-group', config.resourceGroup,
    '--name', config.account, '--deployment-name', config.deployment, '--query', '{sku:sku,model:properties.model}'], config);
  if (!['Standard', 'DataZoneStandard', 'GlobalStandard'].includes(deployment.sku?.name)
    || !Number.isInteger(deployment.sku.capacity) || deployment.sku.capacity < 1 || deployment.sku.capacity > 10) {
    throw new Error('AZURE_CAPACITY_BOUNDARY: only explicitly selected standard deployments of capacity 1-10 are supported.');
  }
  return {
    region: account.location, model: deployment.model, sku: deployment.sku,
    notice: 'No model call was made by this preflight. Deployment region does not by itself guarantee processing residency.',
  };
}

export function operatorToken(config) {
  const token = azure(['account', 'get-access-token', '--resource', 'https://cognitiveservices.azure.com/', '--query', 'accessToken'], config, { output: 'tsv' });
  if (!token) throw new Error('MISSING_OPERATOR_TOKEN');
  return token;
}
