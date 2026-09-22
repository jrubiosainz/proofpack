targetScope = 'resourceGroup'

param location string = resourceGroup().location
param accountName string
param deploymentName string = 'proofpack-selector'
param modelName string
param modelVersion string
@allowed(['Standard', 'DataZoneStandard', 'GlobalStandard'])
param modelSku string = 'Standard'
@minValue(1)
@maxValue(10)
param modelCapacity int = 1

@description('Optional account-scoped role assignment. Review it explicitly before enabling.')
param assignOperatorRole bool = false
param operatorPrincipalId string = ''
@allowed(['User', 'ServicePrincipal'])
param operatorPrincipalType string = 'User'

var tags = {
  Product: 'ProofPack'
  Classification: 'SyntheticOnly'
}

resource account 'Microsoft.CognitiveServices/accounts@2025-06-01' = {
  name: accountName
  location: location
  kind: 'AIServices'
  tags: tags
  sku: { name: 'S0' }
  properties: {
    customSubDomainName: accountName
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
  }
}

resource model 'Microsoft.CognitiveServices/accounts/deployments@2025-06-01' = {
  parent: account
  name: deploymentName
  sku: {
    name: modelSku
    capacity: modelCapacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: modelName
      version: modelVersion
    }
    versionUpgradeOption: 'NoAutoUpgrade'
  }
}

// Built-in Cognitive Services OpenAI User role, not a tenant-specific identifier.
resource operatorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (assignOperatorRole) {
  scope: account
  name: guid(account.id, operatorPrincipalId, 'proofpack-inference')
  properties: {
    principalId: operatorPrincipalId
    principalType: operatorPrincipalType
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd')
  }
}

output endpoint string = 'https://${account.name}.openai.azure.com'
output deployment string = model.name
