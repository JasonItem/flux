interface ChartSeries {
  key: string
  label: string
  values: number[]
  secondary?: boolean
}

interface UsageChartProps {
  labels: string[]
  series: ChartSeries[]
  emptyText?: string
  unit?: string
}

export function UsageChart({
  labels,
  series,
  emptyText = '暂无数据',
  unit,
}: UsageChartProps) {
  const width = 640
  const height = 180
  const padX = 28
  const padY = 18
  const chartW = width - padX * 2
  const chartH = height - padY * 2

  const maxValue = Math.max(
    1,
    ...series.flatMap((item) => item.values),
  )
  const hasData = series.some((item) => item.values.some((value) => value > 0))

  if (!hasData || labels.length === 0) {
    return <div className="usage-chart__empty">{emptyText}</div>
  }

  const groupCount = labels.length
  const groupWidth = chartW / groupCount
  const barGap = 2
  const activeSeries = series.filter((item) => item.values.length === groupCount)
  const barWidth = Math.max(
    2,
    (groupWidth - 8) / Math.max(1, activeSeries.length) - barGap,
  )

  return (
    <div className="usage-chart">
      <svg aria-hidden viewBox={`0 0 ${String(width)} ${String(height)}`}>
        {activeSeries.map((item, seriesIndex) =>
          item.values.map((value, index) => {
            const barH = (value / maxValue) * chartH
            const x =
              padX +
              index * groupWidth +
              (groupWidth - activeSeries.length * (barWidth + barGap)) / 2 +
              seriesIndex * (barWidth + barGap)
            const y = padY + chartH - barH
            return (
              <rect
                className={`usage-chart__bar${item.secondary ? ' is-secondary' : ''}`}
                height={Math.max(barH, value > 0 ? 1 : 0)}
                key={`${item.key}-${String(index)}`}
                rx={2}
                width={barWidth}
                x={x}
                y={y}
              >
                <title>
                  {labels[index]} · {item.label}: {String(value)}
                  {unit ? ` ${unit}` : ''}
                </title>
              </rect>
            )
          }),
        )}
        {labels.map((label, index) => {
          if (groupCount > 14 && index % 2 === 1) return null
          const x = padX + index * groupWidth + groupWidth / 2
          return (
            <text
              className="usage-chart__axis"
              key={label}
              textAnchor="middle"
              x={x}
              y={height - 2}
            >
              {label.slice(5)}
            </text>
          )
        })}
      </svg>
      <div className="usage-legend">
        {series.map((item) => (
          <span key={item.key}>
            <span
              className={`usage-legend__swatch${item.secondary ? ' is-secondary' : ''}`}
            />
            {item.label}
            {unit ? `（${unit}）` : ''}
          </span>
        ))}
      </div>
    </div>
  )
}
