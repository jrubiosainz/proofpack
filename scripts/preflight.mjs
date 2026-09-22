import { readAzureConfig, verifyAzureBoundary } from './azure.mjs';

const config = readAzureConfig();
console.log(JSON.stringify(verifyAzureBoundary(config), null, 2));
