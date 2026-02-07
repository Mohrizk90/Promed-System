export default function TableSkeleton({ rows = 5, cols = 6 }) {
  return (
    <div className="card overflow-hidden animate-pulse">
      {/* Header */}
      <div className="bg-gray-100 px-4 py-3 flex gap-4">
        {[...Array(cols)].map((_, i) => (
          <div key={i} className="h-4 bg-gray-300 rounded flex-1" />
        ))}
      </div>
      
      {/* Rows */}
      <div className="divide-y divide-gray-200">
        {[...Array(rows)].map((_, rowIndex) => (
          <div key={rowIndex} className="px-4 py-4 flex items-center gap-4">
            {[...Array(cols)].map((_, colIndex) => (
              <div
                key={colIndex}
                className="h-4 bg-gray-200 rounded flex-1"
                style={{
                  width: colIndex === 0 ? '120px' : undefined,
                  opacity: 1 - rowIndex * 0.1,
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// Card skeleton for grid layouts
export function CardSkeleton() {
  return (
    <div className="card p-6 animate-pulse">
      <div className="h-4 bg-gray-200 rounded w-1/3 mb-3" />
      <div className="h-8 bg-gray-200 rounded w-2/3 mb-2" />
      <div className="h-3 bg-gray-200 rounded w-1/2" />
    </div>
  )
}

// Chart skeleton
export function ChartSkeleton({ height = 300 }) {
  return (
    <div className="card p-6 animate-pulse">
      <div className="h-5 bg-gray-200 rounded w-1/3 mb-4" />
      <div
        className="bg-gray-100 rounded-lg flex items-end justify-around gap-2 p-4"
        style={{ height }}
      >
        {[60, 80, 45, 90, 70, 55, 75].map((h, i) => (
          <div
            key={i}
            className="bg-gray-200 rounded-t flex-1"
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
    </div>
  )
}

// Metric card skeleton
export function MetricSkeleton() {
  return (
    <div className="card p-5 animate-pulse">
      <div className="h-3 bg-gray-200 rounded w-1/2 mb-3" />
      <div className="h-7 bg-gray-200 rounded w-3/4 mb-2" />
      <div className="h-2 bg-gray-200 rounded w-2/3" />
    </div>
  )
}
