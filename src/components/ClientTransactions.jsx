import TransactionPage from './transactions/TransactionPage'

const config = {
  entityType: 'client',
  entityTable: 'clients',
  entityIdField: 'client_id',
  entityNameField: 'client_name',
  entityRelationName: 'clients',
  transactionTable: 'client_transactions',
  routeKey: 'clientTransactions',
  translationKey: 'clientTransactions',
  filterByLabelKey: 'common.filterByClient',
  primaryColor: 'blue',
  csvFilename: 'client-transactions.csv'
}

export default function ClientTransactions() {
  return <TransactionPage config={config} />
}
