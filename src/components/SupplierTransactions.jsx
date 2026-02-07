import TransactionPage from './transactions/TransactionPage'

const config = {
  entityType: 'supplier',
  entityTable: 'suppliers',
  entityIdField: 'supplier_id',
  entityNameField: 'supplier_name',
  entityRelationName: 'suppliers',
  transactionTable: 'supplier_transactions',
  routeKey: 'supplierTransactions',
  translationKey: 'supplierTransactions',
  filterByLabelKey: 'common.filterBySupplier',
  primaryColor: 'purple',
  csvFilename: 'supplier-transactions.csv'
}

export default function SupplierTransactions() {
  return <TransactionPage config={config} />
}
